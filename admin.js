const login = document.querySelector("#admin-login");
const loginTitle = document.querySelector("#admin-login-title");
const loginForm = document.querySelector("#admin-login-form");
const loginStatus = login.querySelector(".auth-status");
const workspace = document.querySelector("#admin-workspace");
const controls = document.querySelector(".admin-controls");
const logout = document.querySelector(".admin-logout");
const memberForm = document.querySelector("#member-form");
const memberStatus = memberForm.querySelector(".account-status");
const memberList = document.querySelector(".member-list");
const listStatus = document.querySelector(".member-list-status");
const memberSearch = document.querySelector(".member-search input");
const memberPager = document.querySelector(".member-pager");
const memberPrev = document.querySelector(".member-prev");
const memberNext = document.querySelector(".member-next");
const memberPageLabel = document.querySelector(".member-page");
const cancelEdit = memberForm.querySelector(".member-cancel");
const setupToken = /^#setup=([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1];
const sessionChanges = typeof BroadcastChannel === "function" ? new BroadcastChannel("huping-admin-session") : null;
if (setupToken) history.replaceState(null, "", "/admin");

let admin = null;
let setupMode = false;
let editedId = null;
let saving = false;
let memberPage = 1;
let listRequest = 0;
let searchTimer;

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch("/api/admin" + path, {
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && admin) showLogin(false, "管理员会话已结束，请重新登录。");
    throw new Error(data.error || "本地服务暂时无法完成请求。");
  }
  return data;
}

const visibility = loginForm.querySelector(".password-visibility");
function showPassword(shown) {
  loginForm.elements.password.type = shown ? "text" : "password";
  visibility.setAttribute("aria-pressed", String(shown));
  visibility.setAttribute("aria-label", shown ? "隐藏密码" : "显示密码");
}
visibility.addEventListener("click", () => showPassword(loginForm.elements.password.type === "password"));

function showLogin(needsSetup, message = "") {
  ++listRequest;
  clearTimeout(searchTimer);
  admin = null;
  setupMode = Boolean(needsSetup && setupToken);
  loginTitle.textContent = setupMode ? "设置管理员账号" : "管理员登录";
  login.querySelector(".auth-description").textContent = setupMode
    ? "设置管理员登录名和密码。密码至少 12 字符。"
    : needsSetup
      ? "尚未设置管理员，请通过一次性初始化链接开通。"
      : "请输入管理员账号和密码。";
  loginForm.reset();
  showPassword(false);
  loginForm.querySelector(".setup-name").hidden = !setupMode;
  loginForm.elements.name.required = setupMode;
  loginForm.elements.password.minLength = setupMode ? 12 : 1;
  loginForm.elements.password.autocomplete = setupMode ? "new-password" : "current-password";
  loginForm.querySelector('button[type="submit"]').textContent = setupMode ? "创建并登录" : "登录后台";
  loginForm.hidden = needsSetup && !setupMode;
  loginStatus.textContent = message;
  memberForm.reset();
  memberList.replaceChildren();
  memberSearch.value = "";
  listStatus.textContent = "";
  memberPager.hidden = true;
  memberList.removeAttribute("aria-busy");
  memberPage = 1;
  workspace.hidden = true;
  controls.hidden = true;
  login.hidden = false;
  document.title = loginTitle.textContent + " · 同事互评";
}

function editMember(member) {
  editedId = member?.id ?? null;
  memberForm.reset();
  document.querySelector("#member-form-title").textContent = member ? "编辑同事账号" : "创建同事账号";
  memberForm.elements.name.value = member?.name ?? "";
  memberForm.elements.username.value = member?.username ?? "";
  memberForm.elements.username.disabled = Boolean(member);
  memberForm.elements.password.required = !member;
  memberForm.querySelector(".member-password-label").textContent = member
    ? "重置密码（留空保留原密码）"
    : "初始密码（至少 12 字符）";
  memberForm.querySelector(".member-active").hidden = !member;
  memberForm.elements.active.checked = member?.active ?? true;
  memberForm.querySelector('[type="submit"]').textContent = member ? "保存变更" : "创建账号";
  cancelEdit.hidden = !member;
  memberStatus.textContent = "";
}

async function loadMembers(page = memberPage) {
  const sequence = ++listRequest;
  listStatus.textContent = "正在查找账号…";
  memberList.replaceChildren();
  memberList.setAttribute("aria-busy", "true");
  memberPager.hidden = true;
  memberPrev.disabled = true;
  memberNext.disabled = true;
  try {
    const result = await request("/members?" + new URLSearchParams({ q: memberSearch.value.trim(), page }));
    if (sequence !== listRequest || !admin) return;
    memberPage = result.page;
    listStatus.textContent = result.total
      ? "共 " + result.total + " 个账号"
      : memberSearch.value.trim() ? "没有找到匹配的账号。" : "还没有同事账号。";
    memberList.replaceChildren(...result.members.map(member => {
      const row = document.createElement("div");
      const identity = document.createElement("span");
      const title = document.createElement("strong");
      const description = document.createElement("small");
      title.textContent = member.name;
      description.textContent = member.username + " · " + (member.active ? "启用中" : "已停用");
      identity.append(title, description);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "glass scene-action";
      edit.textContent = "编辑";
      edit.setAttribute("aria-label", "编辑 " + member.name);
      edit.addEventListener("click", () => {
        if (saving) return;
        editMember(member);
        memberForm.elements.name.focus();
      });
      row.append(identity, edit);
      return row;
    }));
    memberList.scrollTop = 0;
    memberPager.hidden = result.pages <= 1;
    memberPageLabel.textContent = result.page + " / " + result.pages;
    memberPrev.disabled = result.page <= 1;
    memberNext.disabled = result.page >= result.pages;
  } catch (error) {
    if (sequence === listRequest) listStatus.textContent = error.message;
  } finally {
    if (sequence === listRequest) memberList.removeAttribute("aria-busy");
  }
}

memberSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  ++listRequest;
  memberPrev.disabled = true;
  memberNext.disabled = true;
  searchTimer = setTimeout(() => loadMembers(1), 200);
});
memberPrev.addEventListener("click", () => loadMembers(memberPage - 1));
memberNext.addEventListener("click", () => loadMembers(memberPage + 1));

function showWorkspace(user) {
  admin = user;
  loginForm.reset();
  showPassword(false);
  login.hidden = true;
  workspace.hidden = false;
  controls.querySelector(".account-name").textContent = user.name;
  controls.hidden = false;
  document.title = "账号管理 · 同事互评";
  editMember();
  memberPage = 1;
  memberSearch.value = "";
  listStatus.textContent = "正在读取账号…";
  loadMembers();
}

request("/session").then(state => {
  if (state.user) showWorkspace(state.user);
  else showLogin(state.setup);
}).catch(error => showLogin(false, error.message));

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  loginStatus.textContent = setupMode ? "正在创建管理员账号…" : "正在登录后台…";
  try {
    const body = Object.fromEntries(new FormData(loginForm));
    if (setupMode) body.token = setupToken;
    const result = await request(setupMode ? "/session/setup" : "/session/login", { method: "POST", body });
    sessionChanges?.postMessage("changed");
    showWorkspace(result.user);
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

logout.addEventListener("click", async () => {
  logout.disabled = true;
  try {
    await request("/session/logout", { method: "POST", body: {} });
    sessionChanges?.postMessage("changed");
    showLogin(false);
    loginForm.elements.username.focus();
  } catch (error) {
    memberStatus.textContent = error.message;
  } finally {
    logout.disabled = false;
  }
});

cancelEdit.addEventListener("click", () => { if (!saving) editMember(); });
memberForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (saving) return;
  const button = event.submitter;
  const editing = editedId;
  const body = Object.fromEntries(new FormData(memberForm));
  if (editing) body.active = memberForm.elements.active.checked;
  saving = true;
  button.disabled = true;
  try {
    await request("/members" + (editing ? "/" + editing : ""), { method: editing ? "PATCH" : "POST", body });
    editMember();
    memberStatus.textContent = editing ? "账号已更新。" : "账号已创建，可以登录。";
    await loadMembers();
  } catch (error) {
    memberStatus.textContent = error.message;
  } finally {
    saving = false;
    button.disabled = false;
  }
});

sessionChanges?.addEventListener("message", event => {
  if (event.data === "changed") location.reload();
});
window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
