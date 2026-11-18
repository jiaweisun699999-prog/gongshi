import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const file = process.env.HUPING_DB
  ? resolve(process.env.HUPING_DB)
  : fileURLToPath(new URL("./.huping-data/reviews.sqlite", import.meta.url));
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 3000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS setup (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_hash TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reviews (
    author INTEGER NOT NULL REFERENCES users(id),
    recipient INTEGER NOT NULL REFERENCES users(id),
    draft TEXT,
    submitted TEXT,
    PRIMARY KEY (author, recipient),
    CHECK (author <> recipient)
  );
  CREATE INDEX IF NOT EXISTS reviews_recipient ON reviews(recipient);
  CREATE TABLE IF NOT EXISTS reports (
    recipient INTEGER PRIMARY KEY REFERENCES users(id),
    revision TEXT NOT NULL,
    payload TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS review_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author INTEGER NOT NULL REFERENCES users(id),
    recipient INTEGER NOT NULL REFERENCES users(id),
    payload TEXT NOT NULL,
    submitted_at TEXT,
    submission_id TEXT NOT NULL,
    UNIQUE (author, submission_id),
    CHECK (author <> recipient)
  );
  CREATE INDEX IF NOT EXISTS review_history_recipient ON review_history(recipient, id);
  CREATE INDEX IF NOT EXISTS review_history_author ON review_history(author, recipient, id);
`);

// Preserve each surviving legacy submission once. Its original timestamp is unknown.
db.exec("BEGIN IMMEDIATE");
try {
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 1").get()) {
    db.exec(`INSERT INTO review_history (author, recipient, payload, submission_id)
      SELECT author, recipient, submitted, 'legacy:' || author || ':' || recipient
      FROM reviews WHERE submitted IS NOT NULL`);
    db.prepare("INSERT INTO schema_migrations VALUES (1)").run();
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const hash = value => createHash("sha256").update(value).digest("hex");
export const sessionLifetime = 60 * 60 * 24;
export const adminSessionLifetime = 60 * 60 * 2;
const parse = value => value ? JSON.parse(value) : null;
const dummySalt = randomBytes(16).toString("hex");
const dummyHash = scryptSync("invalid account", dummySalt, 64);
const validToken = token => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

function passwordHash(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new ApiError(400, "密码需要 12 到 128 个字符。");
  }
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}

function displayName(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value || value.length > 40) throw new ApiError(400, "显示名称需要 1 到 40 个字符。");
  return value;
}

function userObject(row) {
  return row ? { id: row.id, username: row.username, name: row.display_name, role: row.role, active: Boolean(row.active) } : null;
}

function getUser(id) {
  return db.prepare("SELECT id, username, display_name, role, active FROM users WHERE id = ?").get(id);
}

function insertUser(input, role) {
  const username = typeof input?.username === "string" ? input.username.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9_.-]{2,31}$/.test(username)) {
    throw new ApiError(400, "登录名以英文字母开头，使用 3 到 32 个字母、数字、点、连字符或下划线。");
  }
  if (db.prepare("SELECT id FROM users WHERE username = ?").get(username)) throw new ApiError(409, "该登录名已存在。");
  const result = db.prepare("INSERT INTO users (username, display_name, password, role) VALUES (?, ?, ?, ?)")
    .run(username, displayName(input.name), passwordHash(input.password), role);
  return userObject(getUser(result.lastInsertRowid));
}

export function needsSetup() {
  return !db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
}

export function canLogin() {
  return Boolean(db.prepare("SELECT 1 FROM users WHERE active = 1 LIMIT 1").get());
}

export function issueSetupToken() {
  if (!needsSetup()) throw new ApiError(409, "管理员已设置。");
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT OR REPLACE INTO setup (id, token_hash, expires) VALUES (1, ?, ?)").run(hash(token), Date.now() + sessionLifetime * 1000);
  return token;
}

export function createAdmin(input) {
  const token = input?.token;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!needsSetup()) throw new ApiError(409, "管理员已设置，请直接登录。");
    const setup = db.prepare("SELECT token_hash, expires FROM setup WHERE id = 1").get();
    if (!validToken(token) || !setup || setup.expires <= Date.now()
      || !timingSafeEqual(Buffer.from(hash(token), "hex"), Buffer.from(setup.token_hash, "hex"))) {
      throw new ApiError(403, "初始化链接无效或已过期。");
    }
    const user = insertUser(input, "admin");
    db.prepare("DELETE FROM setup").run();
    db.exec("COMMIT");
    return user;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function authenticate(input) {
  const username = typeof input?.username === "string" ? input.username.trim().toLowerCase() : "";
  const password = input?.password;
  if (username.length > 32 || typeof password !== "string" || password.length > 128) {
    throw new ApiError(401, "登录名或密码不正确。");
  }
  const row = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
  const [salt, digest] = row?.password.split(":") ?? [dummySalt, null];
  const valid = timingSafeEqual(scryptSync(password, salt, 64), digest ? Buffer.from(digest, "hex") : dummyHash);
  if (!row || !valid) throw new ApiError(401, "登录名或密码不正确。");
  return userObject(row);
}

const sessionHash = (token, scope) => hash(scope === "admin" ? "admin:" + token : token);

export function createSession(userId, scope = "member") {
  const token = randomBytes(32).toString("base64url");
  const lifetime = scope === "admin" ? adminSessionLifetime : sessionLifetime;
  db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(sessionHash(token, scope), userId, Date.now() + lifetime * 1000);
  return token;
}

export function sessionUser(token, scope = "member") {
  if (!validToken(token)) return null;
  const row = db.prepare(`SELECT users.id, username, display_name, role, active
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ? AND expires > ? AND active = 1`).get(sessionHash(token, scope), Date.now());
  if (scope === "admin" && row?.role !== "admin") return null;
  return userObject(row);
}

export function endSession(token, scope = "member") {
  if (validToken(token)) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token, scope));
}

export function members(currentId) {
  return db.prepare("SELECT id, display_name AS name FROM users WHERE active = 1 AND role = 'member' AND id <> ? ORDER BY id").all(currentId);
}

export function memberPage(currentId, search, requestedPage) {
  const query = String(search ?? "").trim().slice(0, 80).toLowerCase();
  const pageSize = 20;
  const filter = "active = 1 AND role = 'member' AND id <> ? AND (instr(lower(display_name), ?) > 0 OR instr(username, ?) > 0)";
  const total = db.prepare("SELECT count(*) AS total FROM users WHERE " + filter).get(currentId, query, query).total;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const parsed = Number(requestedPage);
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, pages) : 1;
  const rows = db.prepare("SELECT id, display_name AS name FROM users WHERE " + filter + " ORDER BY id LIMIT ? OFFSET ?")
    .all(currentId, query, query, pageSize, (page - 1) * pageSize);
  return { members: rows, total, page, pageSize, pages };
}

export function allUsers() {
  return db.prepare("SELECT id, username, display_name, role, active FROM users ORDER BY id").all().map(userObject);
}

export function adminMemberPage(search, requestedPage) {
  const query = String(search ?? "").trim().slice(0, 80).toLowerCase();
  const pageSize = 20;
  const filter = "role = 'member' AND (instr(lower(display_name), ?) > 0 OR instr(username, ?) > 0)";
  const total = db.prepare("SELECT count(*) AS total FROM users WHERE " + filter).get(query, query).total;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const parsed = Number(requestedPage);
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, pages) : 1;
  const rows = db.prepare("SELECT id, username, display_name, role, active FROM users WHERE " + filter + " ORDER BY id LIMIT ? OFFSET ?")
    .all(query, query, pageSize, (page - 1) * pageSize);
  return { members: rows.map(userObject), total, page, pageSize, pages };
}

export const addMember = input => insertUser(input, "member");

export function updateMember(id, input) {
  const existing = getUser(id);
  if (!existing || existing.role !== "member") throw new ApiError(404, "未找到可管理的同事账号。");
  if (typeof input?.active !== "boolean" || typeof input.password !== "string") {
    throw new ApiError(400, "请填写有效的账号状态和密码。");
  }
  const name = displayName(input.name);
  const password = input.password ? passwordHash(input.password) : null;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET display_name = ?, active = ?, password = COALESCE(?, password) WHERE id = ?")
      .run(name, Number(input.active), password, id);
    if (password || !input.active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return userObject(getUser(id));
}

export const ratingDimensions = {
  sync: "信息同步",
  followUp: "交付跟进",
  resolution: "问题解决",
  support: "协作支持",
};

export const profileAreas = {
  style: "工作风格",
  ability: "协作能力",
  conduct: "职业行为",
};

export function reviewText(review) {
  if (!review) return "";
  const observations = Object.entries(profileAreas).flatMap(([key, label]) => {
    const value = review.profileNotes?.[key];
    return value ? [label + "：" + value] : [];
  });
  return [review.note, ...observations].filter(Boolean).join("\n");
}

export function reviewEntry(author, recipient) {
  const row = db.prepare("SELECT draft FROM reviews JOIN users ON users.id = reviews.recipient WHERE author = ? AND recipient = ? AND users.role = 'member'").get(author, recipient);
  const latest = db.prepare(`SELECT h.id, h.payload, h.submitted_at FROM review_history h
    JOIN users ON users.id = h.recipient WHERE author = ? AND recipient = ? AND users.role = 'member' ORDER BY h.id DESC LIMIT 1`).get(author, recipient);
  const count = db.prepare("SELECT count(*) AS n FROM review_history WHERE author = ? AND recipient = ?").get(author, recipient).n;
  return { draft: parse(row?.draft), submitted: latest ? { ...parse(latest.payload), id: latest.id, submittedAt: latest.submitted_at } : null, count };
}

export function outgoing(author) {
  const rows = db.prepare(`SELECT recipient FROM reviews WHERE author = ? AND draft IS NOT NULL
    UNION SELECT recipient FROM review_history WHERE author = ?`).all(author, author);
  return Object.fromEntries(rows.filter(row => getUser(row.recipient)?.role === "member")
    .map(row => [row.recipient, reviewEntry(author, row.recipient)]));
}

function visibleReview(row) {
  const review = parse(row.payload);
  return {
    id: row.id, submittedAt: row.submitted_at, note: review.note, vote: review.vote ?? null,
    observations: Object.entries(profileAreas).flatMap(([key, label]) => {
      const value = review.profileNotes?.[key];
      return value ? [{ label, value }] : [];
    }),
    ratings: Object.entries(ratingDimensions).flatMap(([key, label]) => {
      const value = review.ratings?.[key];
      return value ? [{ label, value }] : [];
    }),
  };
}

export function reviewHistory(author, recipient, requestedPage) {
  const target = getUser(recipient);
  if (!target || target.role !== "member" || author === recipient) throw new ApiError(404, "未找到这位同事。");
  const total = db.prepare("SELECT count(*) AS n FROM review_history WHERE author = ? AND recipient = ?").get(author, recipient).n;
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const parsed = Number(requestedPage);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, pages) : 1;
  const items = db.prepare("SELECT id, payload, submitted_at FROM review_history WHERE author = ? AND recipient = ? ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(author, recipient, pageSize, (page - 1) * pageSize).map(visibleReview);
  return { items, total, page, pages };
}

export function submittedReview(author, recipient, id) {
  const row = db.prepare("SELECT id, payload, submitted_at FROM review_history WHERE author = ? AND recipient = ? AND id = ?").get(author, recipient, id);
  if (!row) throw new ApiError(404, "未找到你提交的这条反馈。");
  return { ...parse(row.payload), id: row.id, submittedAt: row.submitted_at };
}

export function saveReview(author, recipient, input) {
  const target = getUser(recipient);
  if (!target?.active || target.role !== "member" || author === recipient) throw new ApiError(404, "请选择一位有效的同事。");
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (note.length > 1200 || !["draft", "submit"].includes(input?.kind)) throw new ApiError(400, "反馈内容格式不正确。");
  const draft = input.kind === "draft";
  const vote = ["up", "down"].includes(input.vote) ? input.vote : null;
  if (!draft && !vote) throw new ApiError(400, "请在提交前确认点赞或点踩。");
  const ratings = {};
  for (const dimension of Object.keys(ratingDimensions)) {
    const value = input.ratings?.[dimension];
    if (["1", "2", "3", "4", "5", "unobserved"].includes(value)) ratings[dimension] = value;
  }
  const profileNotes = {};
  for (const key of Object.keys(profileAreas)) {
    const value = typeof input.profileNotes?.[key] === "string" ? input.profileNotes[key].trim() : "";
    if (value.length > 400) throw new ApiError(400, "每项补充观察最多 400 字。");
    if (value) profileNotes[key] = value;
  }
  const review = { note, profileNotes, ratings, vote };
  if (!reviewText(review) && !(draft && vote) && !Object.values(ratings).some(value => draft || value !== "unobserved")) {
    throw new ApiError(400, draft ? "请先选择一个选项或填写文字。" : "请写文字反馈，或至少给一个维度打分。");
  }
  if (draft) {
    db.prepare(`INSERT INTO reviews (author, recipient, draft) VALUES (?, ?, ?)
      ON CONFLICT (author, recipient) DO UPDATE SET draft = excluded.draft`).run(author, recipient, JSON.stringify(review));
  } else {
    const submissionId = input.submissionId ?? randomBytes(24).toString("hex");
    if (typeof submissionId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(submissionId)) throw new ApiError(400, "提交标识格式不正确。");
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT recipient, payload FROM review_history WHERE author = ? AND submission_id = ?").get(author, submissionId);
      if (existing) {
        const previous = parse(existing.payload);
        delete previous.analysis;
        if (existing.recipient !== recipient || JSON.stringify(previous) !== JSON.stringify(review)) {
          throw new ApiError(409, "这次提交已保存，请重新开始一份反馈。");
        }
      } else {
        db.prepare("INSERT INTO review_history (author, recipient, payload, submitted_at, submission_id) VALUES (?, ?, ?, ?, ?)")
          .run(author, recipient, JSON.stringify(review), new Date().toISOString(), submissionId);
        db.prepare("UPDATE reviews SET draft = NULL WHERE author = ? AND recipient = ?").run(author, recipient);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return reviewEntry(author, recipient);
}

export function saveReviewAnalysis(author, recipient, id, text, analysis) {
  const submitted = submittedReview(author, recipient, id);
  if (reviewText(submitted) !== text) throw new ApiError(409, "反馈已更新，请重新分析最新内容。");
  delete submitted.id;
  delete submitted.submittedAt;
  db.prepare("UPDATE review_history SET payload = ? WHERE id = ? AND author = ? AND recipient = ?")
    .run(JSON.stringify({ ...submitted, analysis }), id, author, recipient);
}

export const minimumReportSources = 2;

export function reportSnapshot(recipient) {
  const history = db.prepare("SELECT id, author, payload, submitted_at FROM review_history WHERE recipient = ? ORDER BY id").all(recipient);
  const received = history.map(row => ({ author: row.author, review: parse(row.payload) }));
  const written = received.flatMap(row => {
    const note = reviewText(row.review);
    return note ? [{ author: row.author, note }] : [];
  });
  // A source represents one colleague, including all of their separate observations.
  const grouped = new Map();
  for (const row of written) grouped.set(row.author, [...(grouped.get(row.author) ?? []), row.note]);
  const text = [...grouped].sort(([a], [b]) => a - b).map(([author, notes]) => ({ author, note: notes.join("\n\n") }));
  const scores = Object.entries(ratingDimensions).map(([key, label]) => {
    const numbers = received.map(row => Number(row.review.ratings[key])).filter(value => Number.isInteger(value) && value >= 1 && value <= 5);
    const count = numbers.length;
    const raters = new Set(received.filter(row => { const value = Number(row.review.ratings[key]); return Number.isInteger(value) && value >= 1 && value <= 5; }).map(row => row.author)).size;
    return { label, count, raters, average: raters < minimumReportSources ? null : Math.round(numbers.reduce((sum, value) => sum + value, 0) / count * 10) / 10 };
  });
  const revision = hash(JSON.stringify([3, text]));
  const stored = db.prepare("SELECT revision, payload, generated_at FROM reports WHERE recipient = ?").get(recipient);
  const report = text.length >= minimumReportSources && stored
    ? { ...parse(stored.payload), generatedAt: stored.generated_at }
    : null;
  const reviews = history.toReversed().map(visibleReview);
  const votes = received.map(({ review }) => review.vote).filter(vote => vote === "up" || vote === "down");
  const positive = votes.filter(vote => vote === "up").length;
  const approval = { count: votes.length, rate: votes.length ? Math.round(positive * 1000 / votes.length) / 10 : null };
  return {
    revision,
    notes: text.map(row => row.note),
    overview: {
      count: text.length, reviewCount: received.length, textReviewCount: written.length, minimum: minimumReportSources, scores, report, reviews, approval,
      stale: Boolean(report && stored.revision !== revision),
    },
  };
}

export function colleagueCard(viewer, recipient) {
  const member = getUser(recipient);
  if (!member?.active || member.role !== "member" || viewer === recipient) throw new ApiError(404, "未找到可查看的同事。");
  const { count, report, stale, approval } = reportSnapshot(recipient).overview;
  const profileReady = !stale && Array.isArray(report?.profile);
  return {
    id: member.id,
    name: member.display_name,
    approval,
    profileReady,
    eligible: count >= minimumReportSources,
    profile: profileReady ? report.profile.map(({ area, detail, tags }) => ({ area, detail, tags })) : [],
  };
}

export function saveReport(recipient, revision, report) {
  db.prepare(`INSERT INTO reports VALUES (?, ?, ?, ?)
    ON CONFLICT (recipient) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, generated_at = excluded.generated_at`)
    .run(recipient, revision, JSON.stringify(report), new Date().toISOString());
}
