const account = (() => {
  const house = document.querySelector(".house");
  const auth = document.querySelector("#auth-page");
  const authForm = document.querySelector("#auth-form");
  const authStatus = auth.querySelector(".auth-status");
  const visibility = authForm.querySelector(".password-visibility");
  const logout = document.querySelector(".account-logout");
  const dropdown = document.querySelector(".account-dropdown");
  const accountToggle = dropdown.querySelector(".account-toggle");
  const accountActions = dropdown.querySelector(".account-actions");

  function showAccountActions(open) {
    accountToggle.setAttribute("aria-expanded", String(open));
    accountActions.hidden = !open;
  }

  accountToggle.addEventListener("click", () => showAccountActions(accountActions.hidden));
  document.addEventListener("pointerdown", event => {
    if (!dropdown.contains(event.target)) showAccountActions(false);
  });
  dropdown.addEventListener("focusout", event => {
    if (!dropdown.contains(event.relatedTarget)) showAccountActions(false);
  });
  dropdown.addEventListener("keydown", event => {
    if (event.key === "Escape" && !accountActions.hidden) {
      event.preventDefault();
      showAccountActions(false);
      accountToggle.focus();
    }
  });
  window.addEventListener("hashchange", () => showAccountActions(false));
  const roomIds = new Set(Array.from(document.querySelectorAll(".room-nav [data-go]"), link => link.dataset.go));
  const served = location.protocol === "http:" || location.protocol === "https:";
  const sessionChanges = served && typeof BroadcastChannel === "function" ? new BroadcastChannel("huping-session") : null;

  function requestedRoom() {
    const hashRoom = location.hash.slice(1);
    const nextRoom = new URLSearchParams(location.search).get("next");
    return roomIds.has(hashRoom) ? hashRoom : roomIds.has(nextRoom) ? nextRoom : "living";
  }

  function loginPath(room = "living") {
    return room === "living" ? "/login" : "/login?next=" + room;
  }

  const returnRoom = requestedRoom();
  const setupToken = /^#setup=([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1];
  let user = null;
  if (served && setupToken) {
    location.replace("/admin#setup=" + setupToken);
    return { ready: Promise.resolve(null), request, user };
  }

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && user) location.replace(loginPath(requestedRoom()));
      throw new Error(data.error || "本地服务暂时无法完成请求。");
    }
    return data;
  }

  function showLogin(needsSetup, canLogin, unavailable = false) {
    const waitingForAccounts = needsSetup && !canLogin;
    const title = document.querySelector("#auth-title");
    const description = auth.querySelector(".auth-description");
    if (waitingForAccounts) {
      title.textContent = "等待管理员设置";
      description.textContent = "请管理员通过一次性初始化链接创建首个账号。同事账号由管理员统一创建。";
    }
    if (served) history.replaceState(null, "", loginPath(returnRoom));
    house.dataset.session = "guest";
    authForm.hidden = unavailable || waitingForAccounts;
    auth.hidden = false;
    document.title = title.textContent + " · 同事互评";
  }

  const ready = request("/api/session").then(state => {
    user = state.user;
    if (!user) showLogin(state.setup, state.canLogin);
    else if (location.pathname === "/login") {
      location.replace("/#" + returnRoom);
    }
    else {
      const name = document.querySelector(".account-name");
      name.textContent = user.name;
      dropdown.hidden = false;
      house.dataset.session = "authenticated";
    }
    return user;
  }).catch(() => {
    showLogin(false, false, true);
    authStatus.textContent = "无法连接本地账号服务，请通过本地预览打开。";
    return null;
  });

  visibility.addEventListener("click", () => {
    const password = authForm.elements.password;
    const shown = password.type === "password";
    password.type = shown ? "text" : "password";
    visibility.setAttribute("aria-pressed", String(shown));
    visibility.setAttribute("aria-label", shown ? "隐藏密码" : "显示密码");
  });

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    authStatus.textContent = "正在登录…";
    try {
      const body = Object.fromEntries(new FormData(authForm));
      await request("/api/session/login", { method: "POST", body });
      sessionChanges?.postMessage("changed");
      location.replace("/#" + returnRoom);
    } catch (error) {
      authStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await request("/api/session/logout", { method: "POST", body: {} });
      sessionChanges?.postMessage("changed");
      location.replace("/login");
    } catch (error) {
      document.querySelector("#room-status").textContent = error.message;
      logout.disabled = false;
    }
  });

  sessionChanges?.addEventListener("message", event => {
    if (event.data === "changed") location.reload();
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) location.reload();
  });

  return { ready, request, get user() { return user; } };
})();
