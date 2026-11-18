import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

if (!process.argv.includes("--scenario")) {
  test("review history preserves legacy data, separate submissions, ownership and independent sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "gongshi-history-"));
    try {
      const result = spawnSync(process.env.GONGSHI_TEST_NODE || process.execPath, [fileURLToPath(import.meta.url), "--scenario"], {
        env: { ...process.env, HUPING_DB: join(directory, "reviews.sqlite") }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
} else {
  // Create the old schema before loading the application, including a surviving
  // submission, its analysis, and an unfinished draft for the same colleague.
  const legacy = new DatabaseSync(process.env.HUPING_DB);
  legacy.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE reviews (author INTEGER NOT NULL REFERENCES users(id), recipient INTEGER NOT NULL REFERENCES users(id),
      draft TEXT, submitted TEXT, PRIMARY KEY(author, recipient));
    INSERT INTO users VALUES (1,'one','One','unused','member',1), (2,'two','Two','unused','member',1),
      (3,'recipient','Recipient','unused','member',1), (4,'another','Another','unused','member',1),
      (5,'admin','Admin','unused','admin',1);
  `);
  const first = { note: "第一次合作提前同步了变更", profileNotes: {}, ratings: { sync: "5" }, vote: "up", analysis: { summary: "保留的旧分析" } };
  const draft = { ...first, note: "还没写完的草稿" };
  legacy.prepare("INSERT INTO reviews VALUES (1, 3, ?, ?)").run(JSON.stringify(draft), JSON.stringify(first));
  legacy.close();

  const data = await import("../data.mjs");
  const old = data.reviewEntry(1, 3);
  assert.equal(old.count, 1);
  assert.equal(old.submitted.note, first.note);
  assert.equal(old.submitted.analysis.summary, first.analysis.summary);
  assert.equal(old.submitted.submittedAt, null);
  assert.equal(old.draft.note, draft.note);

  const second = { kind: "submit", note: "第二次合作没有及时说明延期", vote: "down", ratings: { sync: "1" }, submissionId: "second-submission-id" };
  let entry = data.saveReview(1, 3, second);
  const secondId = entry.submitted.id;
  assert.equal(entry.count, 2);
  assert.equal(entry.draft, null);
  assert.ok(entry.submitted.submittedAt);
  assert.equal(data.saveReview(1, 3, second).count, 2, "a network retry must not append twice");
  assert.throws(() => data.saveReview(1, 3, { ...second, note: "different payload" }), error => error.status === 409);
  data.saveReview(1, 3, { kind: "draft", note: "下一次合作的草稿" });
  data.saveReview(1, 3, second);
  assert.equal(data.reviewEntry(1, 3).draft.note, "下一次合作的草稿", "a retry must not clear a newer draft");

  let snapshot = data.reportSnapshot(3);
  assert.equal(snapshot.overview.count, 1, "two submissions from one person are one independent source");
  assert.equal(snapshot.overview.reviewCount, 2);
  assert.equal(snapshot.overview.report, null);
  assert.equal(snapshot.overview.scores[0].average, null);
  assert.deepEqual(snapshot.overview.approval, { count: 2, rate: 50 });
  assert.ok(snapshot.notes[0].includes(first.note) && snapshot.notes[0].includes(second.note));

  entry = data.saveReview(1, 3, { ...second, note: "第三次合作跟进了问题", vote: "up", submissionId: "third-submission-id" });
  data.saveReviewAnalysis(1, 3, secondId, second.note, { summary: "第二条的延迟分析" });
  assert.equal(data.submittedReview(1, 3, secondId).analysis.summary, "第二条的延迟分析");
  assert.equal(entry.submitted.analysis, undefined);
  assert.equal(data.reviewEntry(1, 3).submitted.analysis, undefined, "an older analysis must not attach to a newer review");
  assert.throws(() => data.submittedReview(2, 3, secondId), error => error.status === 404);
  assert.equal(data.reviewHistory(2, 3, 1).total, 0);
  assert.throws(() => data.saveReview(1, 5, second), error => error.status === 404);

  data.saveReview(2, 3, { kind: "submit", note: "讨论时主动说明了方案的取舍", vote: "up", ratings: { sync: "3" } });
  snapshot = data.reportSnapshot(3);
  assert.equal(snapshot.overview.count, 2);
  assert.equal(snapshot.overview.reviewCount, 4);
  assert.equal(snapshot.notes.length, 2);
  assert.equal(snapshot.overview.scores[0].average, 2.5);
  assert.equal(snapshot.overview.approval.rate, 75);
  assert.ok(snapshot.overview.reviews.every(review => !("author" in review)));
  assert.deepEqual(snapshot.overview.reviews.map(review => review.note).toReversed(), [first.note, second.note, "第三次合作跟进了问题", "讨论时主动说明了方案的取舍"]);

  data.saveReport(3, snapshot.revision, { summary: "cached", profile: [] });
  assert.equal(data.reportSnapshot(3).overview.stale, false);
  data.saveReview(1, 3, { kind: "submit", note: "新的观察应使报告待更新", vote: "up" });
  assert.equal(data.reportSnapshot(3).overview.stale, true);

  for (let i = 0; i < 21; i++) data.saveReview(1, 4, { kind: "submit", note: "合作记录 " + i, vote: "up" });
  const page = data.reviewHistory(1, 4, 1);
  assert.equal(page.items.length, 20);
  assert.equal(page.items[0].note, "合作记录 20");
  assert.equal(data.reviewHistory(1, 4, 2).items.length, 1);
  assert.equal(data.outgoing(1)[3].count, 4);

  const reopened = await import("../data.mjs?restart");
  assert.equal(reopened.reviewEntry(1, 3).count, 4, "restarting must not import legacy rows again");
  assert.equal(reopened.reviewHistory(1, 4, 2).total, 21);
}
