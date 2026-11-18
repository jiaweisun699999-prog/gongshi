const rooms = {
  living: { title: "客厅" },
  bedroom: {
    title: "看见优势，也找到方向",
    description: [
      ["AI 汇总", "同事的反馈，梳理你的协作特点、优势和建议。"],
      ["逐条评价", "也能展开看原文，了解每一份真实感受。"],
    ],
    action: "查看我的反馈", panel: "我的反馈",
  },
  meeting: {
    title: "把合作感受，写成反馈",
    description: [
      ["文字互评", "记录具体的行为与影响，让反馈有据可循。"],
      ["赞或踩", "由你最终确认，AI 帮你整理工作风格、能力和表现。"],
    ],
    action: "写一份反馈",
  },
  yard: {
    title: "认识同事，让合作更顺",
    description: [
      ["同事卡片", "汇总工作风格、协作能力和职业行为。"],
      ["好评率", "结合实际票数，帮助你了解同事的合作口碑。"],
    ],
    action: "浏览同事卡片", panel: "同事广场",
  },
};

const house = document.querySelector(".house");
const scenes = Array.from(document.querySelectorAll("[data-scene]"));
const navigation = Array.from(document.querySelectorAll(".room-nav [data-go]"));
const home = document.querySelector(".home-intro");
const roomCopy = document.querySelector(".room-copy");
const roomTitle = document.querySelector(".room-caption h1");
const roomDescription = roomCopy.querySelector(".room-description");
const roomAction = document.querySelector(".open-room");
const roomActionText = roomAction.querySelector("span");
const dialog = document.querySelector("#room-dialog");
const dialogTitle = document.querySelector("#dialog-title");
const closeDialog = dialog.querySelector(".close-dialog");
const sections = Array.from(dialog.querySelectorAll("[data-content]"));
const fullscreen = document.querySelector(".fullscreen-toggle");
const status = document.querySelector("#room-status");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

let activeRoom = "living";
let sceneTimer;

function showRoom(id, transition = true) {
  if (!Object.hasOwn(rooms, id) || id === activeRoom) return;

  const previousRoom = activeRoom;
  activeRoom = id;
  house.dataset.room = id;
  clearTimeout(sceneTimer);

  const animateScene = transition && !reduceMotion.matches;
  for (const scene of scenes) {
    scene.classList.toggle("is-current", scene.dataset.scene === id);
    scene.classList.toggle("is-outgoing", animateScene && scene.dataset.scene === previousRoom);
  }
  if (animateScene) {
    sceneTimer = setTimeout(() => {
      scenes.find(scene => scene.dataset.scene === previousRoom).classList.remove("is-outgoing");
    }, 925);
  }
  for (const link of navigation) {
    if (link.dataset.go === id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  home.hidden = id !== "living";
  roomCopy.hidden = id === "living";
  if (id === "living") {
    if (dialog.open) dialog.close();
    return;
  }

  const room = rooms[id];
  dialog.dataset.room = id;
  roomTitle.textContent = room.title;
  roomDescription.replaceChildren(...room.description.flatMap(([keyword, text]) => {
    const label = document.createElement("dt");
    const description = document.createElement("dd");
    label.textContent = keyword;
    description.textContent = text;
    return [label, description];
  }));
  roomActionText.textContent = room.action;
  dialogTitle.textContent = room.panel || room.action;
  for (const section of sections) section.hidden = section.dataset.content !== id;
}

function showRoomFromHash(transition = true) {
  const id = window.location.hash.slice(1);
  showRoom(Object.hasOwn(rooms, id) ? id : "living", transition);
}

function openDialog() {
  if (!account.user) return;
  if (!dialog.open) dialog.showModal();
  if (activeRoom === "bedroom") refreshReport();
  if (activeRoom === "meeting") refreshPeers();
  if (activeRoom === "yard") refreshDirectory();
}

for (const link of document.querySelectorAll("[data-go]")) {
  link.addEventListener("click", event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const id = link.dataset.go;
    if (window.location.hash !== link.hash) history.pushState(null, "", link.hash);
    showRoom(id);
  });
}

window.addEventListener("hashchange", () => showRoomFromHash());
window.addEventListener("popstate", () => showRoomFromHash());
showRoomFromHash(false);

roomAction.addEventListener("click", openDialog);
closeDialog.addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  const target = activeRoom === "living" ? navigation[0] : roomAction;
  target.focus({ preventScroll: true });
});
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (outside) dialog.close();
});

function updateFullscreen() {
  const isFullscreen = Boolean(document.fullscreenElement);
  const label = isFullscreen ? "退出全屏" : "全屏显示";
  fullscreen.setAttribute("aria-label", label);
  fullscreen.title = label;
  fullscreen.querySelector("use").setAttribute("href", isFullscreen ? "#icon-exit-fullscreen" : "#icon-fullscreen");
}

if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
  fullscreen.hidden = false;
  updateFullscreen();
  fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      status.textContent = "当前窗口不支持切换全屏。";
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreen);
}

const buttonRebounds = new WeakMap();
for (const control of document.querySelectorAll(".glass")) {
  control.addEventListener("pointermove", event => {
    if (!finePointer.matches || reduceMotion.matches) return;
    const bounds = control.getBoundingClientRect();
    control.style.setProperty("--highlight-x", (event.clientX - bounds.left) / bounds.width * 100 + "%");
    control.style.setProperty("--highlight-y", (event.clientY - bounds.top) / bounds.height * 100 + "%");
  }, { passive: true });
  control.addEventListener("pointerleave", () => {
    control.style.removeProperty("--highlight-x");
    control.style.removeProperty("--highlight-y");
  });
  control.addEventListener("click", () => {
    if (reduceMotion.matches || !control.animate) return;
    buttonRebounds.get(control)?.cancel();
    buttonRebounds.set(control, control.animate([
      { scale: ".93", offset: 0, easing: "cubic-bezier(.16,.87,.31,1)" },
      { scale: "1.044", offset: .38, easing: "ease-in-out" },
      { scale: ".991", offset: .72, easing: "ease-out" },
      { scale: "1", offset: 1 },
    ], { duration: 740 }));
  });
}

let cameraFrame = 0;
house.addEventListener("pointermove", event => {
  if (!finePointer.matches || reduceMotion.matches) return;
  cancelAnimationFrame(cameraFrame);
  cameraFrame = requestAnimationFrame(() => {
    const bounds = house.getBoundingClientRect();
    house.style.setProperty("--camera-x", (0.5 - (event.clientX - bounds.left) / bounds.width) * 13 + "px");
    house.style.setProperty("--camera-y", (0.5 - (event.clientY - bounds.top) / bounds.height) * 10 + "px");
  });
}, { passive: true });

house.addEventListener("pointerleave", () => {
  cancelAnimationFrame(cameraFrame);
  house.style.removeProperty("--camera-x");
  house.style.removeProperty("--camera-y");
});

const feedback = document.querySelector(".feedback");
const peer = feedback.elements.peer;
const peerSearch = feedback.querySelector("#peer-search");
const peerPicker = feedback.querySelector(".peer-picker");
const peerPopup = feedback.querySelector(".peer-popup");
const peerResults = feedback.querySelector(".peer-results");
const peerStatus = feedback.querySelector(".peer-status");
const peerMore = feedback.querySelector(".peer-more");
const note = feedback.elements.note;
const feedbackStatus = feedback.querySelector(".feedback-status");
const ratingFields = Array.from(feedback.querySelectorAll("[data-rating]"));
const profileFields = Array.from(feedback.querySelectorAll("[data-profile-note]"));
const voteFields = Array.from(feedback.querySelectorAll('input[name="vote"]'));
const analysisPanel = dialog.querySelector(".review-analysis");
const analysisStatus = analysisPanel.querySelector(".analysis-status");
const analysisResult = analysisPanel.querySelector(".analysis-result");
const analysisSummary = analysisPanel.querySelector(".analysis-summary");
const analysisObservations = analysisPanel.querySelector(".analysis-observations");
const analysisFollowUp = analysisPanel.querySelector(".analysis-follow-up");
const retryAnalysis = analysisPanel.querySelector(".analysis-retry");
const sentReviews = dialog.querySelector(".sent-reviews");
const sentCount = sentReviews.querySelector(".sent-count");
const sentStatus = sentReviews.querySelector(".sent-status");
const sentList = sentReviews.querySelector(".sent-list");
const sentPager = sentReviews.querySelector(".sent-pager");
const sentPrev = sentReviews.querySelector(".sent-prev");
const sentNext = sentReviews.querySelector(".sent-next");
const sentPageLabel = sentReviews.querySelector(".sent-page");
let sentPage = 1;
let sentRequest = 0;
const frequencyOptions = document.querySelector("#feedback-frequency-options").content;
const ratingValues = new Set(Array.from(frequencyOptions.querySelectorAll("option"), option => option.value));
for (const field of ratingFields) field.append(frequencyOptions.cloneNode(true));

const edits = new Map();
const analysisJobs = new Map();
const submissionIds = new Map();
let savingReview = false;
let reviews = {};

function readReview() {
  return {
    ratings: Object.fromEntries(ratingFields.map(field => [field.name, field.value])),
    note: note.value,
    profileNotes: Object.fromEntries(profileFields.map(field => [field.name, field.value])),
    vote: feedback.elements.vote.value,
  };
}

function writtenParts(review) {
  return [review?.note, ...profileFields.map(field => review?.profileNotes?.[field.name])]
    .map(value => value?.trim() || "");
}

const textKey = review => JSON.stringify(writtenParts(review));
const hasWrittenFeedback = review => writtenParts(review).some(Boolean);

function showAnalysis() {
  const submitted = reviews[peer.value]?.submitted;
  analysisPanel.hidden = !hasWrittenFeedback(submitted);
  if (analysisPanel.hidden) return;

  const job = analysisJobs.get(peer.value);
  const currentJob = job?.reviewId === submitted.id ? job : null;
  const analysis = submitted.analysis;
  analysisStatus.hidden = Boolean(analysis);
  analysisStatus.textContent = currentJob?.pending
    ? "正在整理已提交的文字反馈…"
    : currentJob?.error || "这份反馈还没有生成分析。";
  retryAnalysis.hidden = Boolean(analysis || currentJob?.pending);
  analysisResult.hidden = !analysis;
  if (!analysis) return;

  analysisSummary.textContent = analysis.summary;
  const cards = analysis.observations.map(observation => {
    const card = document.createElement("article");
    const heading = document.createElement("h4");
    heading.textContent = observation.dimension;
    card.append(heading);
    for (const [label, value] of [
      ["观察到的行为", observation.behavior],
      ["带来的影响", observation.impact],
      ["协作建议", observation.suggestion],
    ]) {
      if (!value) continue;
      const line = document.createElement("p");
      const title = document.createElement("strong");
      title.textContent = label;
      line.append(title, document.createTextNode(value));
      card.append(line);
    }
    return card;
  });
  analysisObservations.replaceChildren(...cards);
  analysisFollowUp.hidden = !analysis.followUp;
  analysisFollowUp.textContent = analysis.followUp ? "可以补充 · " + analysis.followUp : "";
}

async function analyzeSubmitted(peerId) {
  const submitted = reviews[peerId]?.submitted;
  if (!hasWrittenFeedback(submitted) || submitted.analysis) return;
  const key = textKey(submitted);
  const previous = analysisJobs.get(peerId);
  if (previous?.pending && previous.reviewId === submitted.id) return;

  const job = { key, reviewId: submitted.id, pending: true };
  analysisJobs.set(peerId, job);
  showAnalysis();

  try {
    const data = await account.request("/api/reviews/analyze", {
      method: "POST",
      body: { recipient: Number(peerId), reviewId: submitted.id },
    });
    const latest = reviews[peerId];
    if (analysisJobs.get(peerId) !== job || latest?.submitted?.id !== data.reviewId) return;
    reviews[peerId] = { ...latest, submitted: { ...latest.submitted, analysis: data.analysis } };
  } catch (error) {
    job.error = error instanceof TypeError ? "无法连接本地分析服务，请在本地预览打开后重试。" : error.message;
  } finally {
    job.pending = false;
    showAnalysis();
  }
}

function showPeerReview() {
  const saved = reviews[peer.value];
  const review = edits.get(peer.value) ?? saved?.draft;
  for (const field of ratingFields) {
    const value = review?.ratings?.[field.name];
    field.value = ratingValues.has(value) ? value : "";
  }
  note.value = typeof review?.note === "string" ? review.note : "";
  for (const field of profileFields) field.value = review?.profileNotes?.[field.name] ?? "";
  for (const field of voteFields) field.checked = review?.vote === field.value;
  feedbackStatus.textContent = saved?.count
    ? "你已给 TA 留下 " + saved.count + " 份反馈。这次提交会新增一份，之前的都会保留。"
    : "";
  showAnalysis();
  refreshSentReviews();
}

async function refreshSentReviews(page = 1) {
  const sequence = ++sentRequest;
  const recipient = peer.value;
  const count = reviews[recipient]?.count ?? 0;
  sentReviews.hidden = !count;
  sentList.replaceChildren();
  sentPager.hidden = true;
  if (!count) return;
  sentCount.textContent = "（" + count + " 份）";
  sentStatus.textContent = "正在读取历次反馈…";
  sentPrev.disabled = sentNext.disabled = true;
  try {
    const data = await account.request("/api/reviews/" + recipient + "/history?page=" + page);
    if (sequence !== sentRequest || recipient !== peer.value) return;
    sentPage = data.page;
    sentCount.textContent = "（" + data.total + " 份）";
    sentStatus.textContent = "每次提交独立保存，按最近提交的顺序显示。";
    sentList.replaceChildren(...data.items.map((review, index) => reviewDetails(review, (data.page - 1) * 20 + index)));
    sentPager.hidden = data.pages <= 1;
    sentPageLabel.textContent = data.page + " / " + data.pages;
    sentPrev.disabled = data.page <= 1;
    sentNext.disabled = data.page >= data.pages;
  } catch (error) {
    if (sequence === sentRequest) sentStatus.textContent = error.message;
  }
}

sentPrev.addEventListener("click", () => refreshSentReviews(sentPage - 1));
sentNext.addEventListener("click", () => refreshSentReviews(sentPage + 1));

let selectedPeer = peer.value;
showPeerReview();
retryAnalysis.addEventListener("click", () => analyzeSubmitted(peer.value));
feedback.addEventListener("input", event => {
  if (event.target === peerSearch) return;
  if (peer.value && selectedPeer) edits.set(selectedPeer, readReview());
  feedbackStatus.textContent = "";
});
feedback.addEventListener("submit", async event => {
  event.preventDefault();
  if (savingReview) return;
  if (!peer.value) {
    feedbackStatus.textContent = "请先选择一位要评价的同事。";
    peerSearch.focus();
    return;
  }

  const draftOnly = event.submitter?.value === "draft";
  const review = readReview();
  review.note = review.note.trim();
  if (!draftOnly && !review.vote) {
    feedbackStatus.textContent = "请在提交前确认点赞或点踩。";
    voteFields[0].focus();
    return;
  }
  const hasRating = Object.values(review.ratings).some(value => value && (draftOnly || value !== "unobserved"));
  if (!hasWrittenFeedback(review) && !hasRating && !(draftOnly && review.vote)) {
    feedbackStatus.textContent = draftOnly
      ? "请先选择一个选项或填写文字。"
      : "请至少给一个维度打分，或写一条文字反馈。";
    return;
  }

  const recipient = peer.value;
  const signature = JSON.stringify(review);
  if (!draftOnly && submissionIds.get(recipient)?.signature !== signature) {
    submissionIds.set(recipient, { signature, id: crypto.randomUUID() });
  }
  savingReview = true;
  const submitButtons = Array.from(feedback.querySelectorAll('button[type="submit"]'));
  submitButtons.forEach(button => { button.disabled = true; });
  try {
    const { entry } = await account.request("/api/reviews/" + recipient, {
      method: "PUT",
      body: { ...review, kind: draftOnly ? "draft" : "submit", ...(!draftOnly ? { submissionId: submissionIds.get(recipient).id } : {}) },
    });
    reviews[recipient] = entry;
    const current = edits.get(recipient);
    if (current && textKey(current) === textKey(review) && current.vote === review.vote
      && JSON.stringify(current.ratings) === JSON.stringify(review.ratings)) edits.delete(recipient);
    if (!draftOnly) submissionIds.delete(recipient);
    if (peer.value === recipient) {
      showPeerReview();
      feedbackStatus.textContent = draftOnly ? "草稿已保存到你的账号。" : "新的反馈已提交，之前的评价也都保留。你可以继续写下一份。";
    }
    showAnalysis();
    if (!draftOnly && hasWrittenFeedback(entry.submitted) && !entry.submitted.analysis) {
      analyzeSubmitted(recipient);
      if (peer.value === recipient) analysisPanel.scrollIntoView({ block: "nearest" });
    }
  } catch (error) {
    if (peer.value === recipient) feedbackStatus.textContent = error.message;
  } finally {
    savingReview = false;
    submitButtons.forEach(button => { button.disabled = false; });
  }
});

let peerRequest = 0;
let chosenPeer = null;
let peerSearchRequest = 0;
let peerSearchTimer;
let peerPage = 0;
let peerQuery = "";
let peerOptions = [];
let activePeerOption = -1;
let searchingPeers = false;

function closePeerPicker() {
  peerPopup.hidden = true;
  peerSearch.setAttribute("aria-expanded", "false");
  peerSearch.removeAttribute("aria-activedescendant");
  activePeerOption = -1;
}

function choosePeer(member) {
  ++peerRequest;
  chosenPeer = member;
  peer.value = String(member.id);
  selectedPeer = peer.value;
  peerSearch.value = member.name;
  showPeerReview();
  closePeerPicker();
  peerSearch.focus();
}

function highlightPeer(index) {
  activePeerOption = index;
  const options = Array.from(peerResults.children);
  options.forEach((option, i) => option.setAttribute("aria-selected", String(i === index)));
  if (options[index]) {
    peerSearch.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  }
}

async function searchPeers(query, page = 1) {
  const sequence = ++peerSearchRequest;
  searchingPeers = true;
  peerMore.setAttribute("aria-disabled", "true");
  peerStatus.textContent = "正在查找同事…";
  if (page === 1) {
    peerOptions = [];
    peerResults.replaceChildren();
    peerMore.hidden = true;
    highlightPeer(-1);
  }
  try {
    const data = await account.request("/api/members?" + new URLSearchParams({ q: query, page }));
    if (sequence !== peerSearchRequest) return;
    peerQuery = query;
    peerPage = data.page;
    peerOptions.push(...data.members);
    peerResults.replaceChildren(...peerOptions.map(member => {
      const option = document.createElement("div");
      option.id = "peer-option-" + member.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = member.name;
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => choosePeer(member));
      return option;
    }));
    highlightPeer(-1);
    peerStatus.textContent = data.total ? "找到 " + data.total + " 位同事，已显示 " + peerOptions.length + " 位。" : "没有找到这位同事。";
    if (data.page >= data.pages && document.activeElement === peerMore) peerSearch.focus();
    peerMore.hidden = data.page >= data.pages;
  } catch (error) {
    if (sequence === peerSearchRequest) {
      peerStatus.textContent = error.message;
      peerMore.hidden = true;
    }
  } finally {
    if (sequence === peerSearchRequest) {
      searchingPeers = false;
      peerMore.setAttribute("aria-disabled", "false");
    }
  }
}

function openPeerPicker() {
  if (!peerPopup.hidden) return;
  peerPopup.hidden = false;
  peerSearch.setAttribute("aria-expanded", "true");
  const query = chosenPeer && peerSearch.value === chosenPeer.name ? "" : peerSearch.value.trim();
  searchPeers(query);
}

peerSearch.addEventListener("focus", openPeerPicker);
peerSearch.addEventListener("click", openPeerPicker);
peerSearch.addEventListener("input", () => {
  clearTimeout(peerSearchTimer);
  ++peerSearchRequest;
  peer.value = "";
  peerPopup.hidden = false;
  peerSearch.setAttribute("aria-expanded", "true");
  peerResults.replaceChildren();
  peerOptions = [];
  highlightPeer(-1);
  peerMore.hidden = true;
  peerStatus.textContent = "正在查找同事…";
  feedbackStatus.textContent = "";
  peerSearchTimer = setTimeout(() => searchPeers(peerSearch.value.trim()), 200);
});
peerSearch.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openPeerPicker();
    if (peerOptions.length) {
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlightPeer((activePeerOption + step + peerOptions.length) % peerOptions.length);
    }
  } else if (event.key === "Enter" && !peerPopup.hidden) {
    event.preventDefault();
    if (peerOptions[activePeerOption]) choosePeer(peerOptions[activePeerOption]);
  } else if (event.key === "Escape" && !peerPopup.hidden) {
    event.preventDefault();
    closePeerPicker();
  }
});
peerMore.addEventListener("click", () => { if (!searchingPeers) searchPeers(peerQuery, peerPage + 1); });
peerPicker.addEventListener("focusout", event => {
  if (!peerPicker.contains(event.relatedTarget)) closePeerPicker();
});
document.addEventListener("pointerdown", event => {
  if (!peerPicker.contains(event.target)) closePeerPicker();
});
dialog.addEventListener("close", closePeerPicker);

async function refreshPeers() {
  const sequence = ++peerRequest;
  try {
    const result = await account.request("/api/reviews/mine");
    if (sequence !== peerRequest) return;
    reviews = result.reviews;
    if (selectedPeer) {
      try {
        const { member } = await account.request("/api/members/" + selectedPeer);
        if (sequence !== peerRequest) return;
        chosenPeer = member;
        peer.value = String(member.id);
        peerSearch.value = member.name;
      } catch {
        if (sequence !== peerRequest) return;
        chosenPeer = null;
        peer.value = "";
        peerSearch.value = "";
        selectedPeer = "";
      }
    }
    showPeerReview();
  } catch (error) {
    if (sequence === peerRequest) feedbackStatus.textContent = error.message;
  }
}

const colleagues = dialog.querySelector(".colleagues");
const colleaguesStatus = dialog.querySelector(".colleagues-status");
const directoryAreas = [
  ["工作风格", "性格 · 工作风格"],
  ["协作能力", "能力 · 协作表现"],
  ["职业行为", "品格 · 职业行为"],
];
let directoryRequest = 0;
const directorySearch = dialog.querySelector(".directory-search input");
const directoryPager = dialog.querySelector(".directory-pager");
const directoryPrev = dialog.querySelector(".directory-prev");
const directoryNext = dialog.querySelector(".directory-next");
const directoryPageLabel = dialog.querySelector(".directory-page");
let directoryPage = 1;
let directoryTimer;

function colleagueDetails(member) {
  let card = member;
  let loading = false;
  const entry = document.createElement("details");
  entry.className = "colleague-card";
  const summary = document.createElement("summary");
  const initial = document.createElement("span");
  initial.className = "initial";
  initial.setAttribute("aria-hidden", "true");
  initial.textContent = Array.from(member.name)[0];
  const identity = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = member.name;
  const rate = document.createElement("small");
  identity.append(name, rate);
  summary.append(initial, identity);
  const body = document.createElement("div");
  body.className = "colleague-summary";
  const status = document.createElement("p");
  status.className = "profile-state";
  status.setAttribute("role", "status");
  const observations = document.createElement("div");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "glass scene-action";
  retry.textContent = "重试汇总";
  retry.hidden = true;
  body.append(status, observations, retry);
  entry.append(summary, body);

  function render() {
    rate.textContent = card.approval.count
      ? "好评率 " + card.approval.rate + "% · " + card.approval.count + " 票"
      : "好评率 · 暂无投票";
    status.textContent = card.eligible ? "" : "至少两位同事提交文字反馈后，才能汇总工作表现。";
    status.hidden = !status.textContent;
    observations.replaceChildren(...directoryAreas.map(([area, label]) => {
      const content = card.profile.find(item => item.area === area);
      const section = document.createElement("section");
      section.className = "colleague-profile";
      const heading = document.createElement("h4");
      heading.textContent = label;
      const detail = document.createElement("p");
      detail.textContent = content?.detail || "暂无足够的共同观察。";
      if (!content) detail.className = "profile-empty";
      section.append(heading, detail);
      if (content?.tags.length) {
        const tags = document.createElement("div");
        tags.className = "profile-tags";
        for (const text of content.tags) {
          const tag = document.createElement("span");
          tag.textContent = text;
          tags.append(tag);
        }
        section.append(tags);
      }
      return section;
    }));
  }

  async function loadProfile() {
    if (!card.eligible || card.profileReady || loading) return;
    loading = true;
    retry.hidden = true;
    status.hidden = false;
    status.textContent = "正在汇总这位同事的工作表现…";
    try {
      const result = await account.request("/api/directory/" + card.id + "/profile", { method: "POST", body: {} });
      card = result.card;
      render();
      if (card.eligible && !card.profileReady) {
        status.hidden = false;
        status.textContent = "反馈刚刚更新，可以重新汇总。";
        retry.hidden = false;
      }
    } catch (error) {
      status.textContent = error.message;
      retry.hidden = false;
    } finally {
      loading = false;
    }
  }

  render();
  entry.addEventListener("toggle", () => { if (entry.open) loadProfile(); });
  retry.addEventListener("click", loadProfile);
  return entry;
}

async function refreshDirectory(page = 1) {
  const sequence = ++directoryRequest;
  colleaguesStatus.textContent = "正在读取同事汇总…";
  colleagues.replaceChildren();
  colleagues.setAttribute("aria-busy", "true");
  directoryPrev.disabled = true;
  directoryNext.disabled = true;
  directoryPager.hidden = true;
  try {
    const data = await account.request("/api/directory?" + new URLSearchParams({ q: directorySearch.value.trim(), page }));
    if (sequence !== directoryRequest) return;
    directoryPage = data.page;
    colleaguesStatus.textContent = data.total
      ? "共 " + data.total + " 位同事 · 好评率按确认的赞踩计算"
      : directorySearch.value.trim() ? "没有找到这位同事，换个名字试试。" : "暂无同事账号。";
    colleagues.replaceChildren(...data.members.map(colleagueDetails));
    colleagues.scrollTop = 0;
    directoryPager.hidden = data.pages <= 1;
    directoryPageLabel.textContent = data.page + " / " + data.pages;
    directoryPrev.disabled = data.page <= 1;
    directoryNext.disabled = data.page >= data.pages;
  } catch (error) {
    if (sequence === directoryRequest) colleaguesStatus.textContent = error.message;
  } finally {
    if (sequence === directoryRequest) colleagues.removeAttribute("aria-busy");
  }
}

directorySearch.addEventListener("input", () => {
  clearTimeout(directoryTimer);
  ++directoryRequest;
  directoryPrev.disabled = true;
  directoryNext.disabled = true;
  directoryTimer = setTimeout(() => refreshDirectory(), 200);
});
directoryPrev.addEventListener("click", () => refreshDirectory(directoryPage - 1));
directoryNext.addEventListener("click", () => refreshDirectory(directoryPage + 1));

const reportStatus = dialog.querySelector(".report-status");
const reportButton = dialog.querySelector(".report-generate");
const reportBody = dialog.querySelector(".report-body");
const reportSummary = dialog.querySelector(".report-summary");
const reportGroups = dialog.querySelector(".report-groups");
const reportRatings = dialog.querySelector(".report-ratings");
const receivedReviews = dialog.querySelector(".received-reviews");
const receivedCount = receivedReviews.querySelector(".received-count");
const receivedList = receivedReviews.querySelector(".received-list");
let generatingReport = false;
let renderedReviews;

function renderReceivedReviews(reviews) {
  const signature = JSON.stringify(reviews);
  if (renderedReviews === signature) return;
  renderedReviews = signature;
  receivedReviews.hidden = reviews.length === 0;
  receivedCount.textContent = reviews.length + " 条";

  receivedList.replaceChildren(...reviews.map(reviewDetails));
}

function reviewDetails(review, index) {
  const entry = document.createElement("details");
  const summary = document.createElement("summary");
  const name = document.createElement("strong");
  const type = document.createElement("small");
  name.textContent = "评价 " + (index + 1);
  const date = document.createElement("time");
  if (review.submittedAt) {
    date.dateTime = review.submittedAt;
    date.textContent = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(review.submittedAt));
  } else date.textContent = "历史反馈 · 时间未记录";
  name.append(date);
  const hasText = review.note || review.observations?.length;
  const reviewType = review.ratings.length ? hasText ? "文字和量表" : "量表评价" : "文字反馈";
  type.textContent = [review.vote === "up" ? "赞" : review.vote === "down" ? "踩" : "", reviewType].filter(Boolean).join(" · ");
  summary.append(name, type);
  entry.append(summary);

  const body = document.createElement("div");
  body.className = "received-review-body";
  if (review.note) {
    const note = document.createElement("p");
    note.className = "received-note";
    note.textContent = review.note;
    body.append(note);
  }
  for (const item of review.observations ?? []) {
    const paragraph = document.createElement("p");
    paragraph.className = "received-note";
    paragraph.textContent = item.label + "：" + item.value;
    body.append(paragraph);
  }
  if (review.ratings.length) {
    const ratings = document.createElement("dl");
    ratings.className = "received-ratings";
    for (const rating of review.ratings) {
      const label = document.createElement("dt");
      const value = document.createElement("dd");
      label.textContent = rating.label;
      value.textContent = rating.value === "unobserved" ? "未观察到" : rating.value + " / 5";
      ratings.append(label, value);
    }
    body.append(ratings);
  }
  entry.append(body);
  return entry;
}

function renderReport(data) {
  const { count, minimum, scores, report, stale, reviews } = data;
  const receivedText = "已收到 " + (data.reviewCount ?? reviews?.length ?? count) + " 份反馈，其中 " + count + " 位同事提供了文字反馈。";
  const eligible = count >= minimum;
  reportButton.hidden = !eligible || Boolean(report && !stale);
  reportButton.textContent = report ? "更新报告" : "生成报告";
  reportStatus.textContent = !eligible
    ? receivedText + "至少 " + minimum + " 位同事提交文字后可生成汇总。"
    : !report
      ? receivedText
      : stale
        ? receivedText + "当前显示上一版报告，可以更新汇总。"
        : receivedText + "文字反馈已按维度汇总，仅你可见。";
  reportBody.hidden = !report;
  if (report) {
    reportSummary.textContent = report.summary;
    reportGroups.replaceChildren(...[
      ["按维度汇总", report.dimensions, "暂无能对应到原文的维度。"],
      ["协作特点", report.traits, "暂未发现多位同事共同提到的特点。"],
      ["做得好的地方", report.strengths, "暂未提取到具体的优势。"],
      ["改进建议", report.improvements, "暂未提取到有反馈依据的改进建议。"],
    ].map(([title, items, empty]) => {
      const group = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = title;
      group.append(heading);
      if (!items.length) {
        const message = document.createElement("p");
        message.className = "report-context";
        message.textContent = empty;
        group.append(message);
      }
      for (const item of items) {
        const card = document.createElement("article");
        const label = document.createElement("h4");
        const detail = document.createElement("p");
        const context = document.createElement("small");
        label.textContent = item.dimension || item.title;
        context.textContent = item.count === 1 ? "一位同事提及" : item.count + " 位同事提及";
        detail.textContent = item.detail;
        card.append(label, context, detail);
        if (item.differences) {
          const differences = document.createElement("p");
          differences.className = "report-context";
          differences.textContent = "不同场景的观察 · " + item.differences;
          card.append(differences);
        }
        group.append(card);
      }
      return group;
    }));
  }
  reportRatings.hidden = !scores.some(score => score.count);
  reportRatings.querySelector("dl").replaceChildren(...scores.map(score => {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    const value = document.createElement("dd");
    label.textContent = score.label;
    value.textContent = score.average === null ? "样本不足" : score.average.toFixed(1) + " / 5 · " + score.count + " 份";
    row.append(label, value);
    return row;
  }));
  renderReceivedReviews(reviews ?? []);
}

async function generateReport() {
  if (generatingReport) return;
  generatingReport = true;
  reportButton.disabled = true;
  reportStatus.textContent = "GPT 正在汇总同事的文字反馈…";
  try {
    renderReport(await account.request("/api/report/generate", { method: "POST", body: {} }));
  } catch (error) {
    reportStatus.textContent = error.message;
  } finally {
    generatingReport = false;
    reportButton.disabled = false;
  }
}

async function refreshReport() {
  if (generatingReport) return;
  reportStatus.textContent = "正在读取你的报告…";
  try {
    const data = await account.request("/api/report");
    if (generatingReport) return;
    renderReport(data);
    if (dialog.open && activeRoom === "bedroom" && !data.report && data.count >= data.minimum) generateReport();
  } catch (error) {
    reportStatus.textContent = error.message;
  }
}

reportButton.addEventListener("click", generateReport);
