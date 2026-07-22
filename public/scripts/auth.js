// scripts/auth.js
// -----------------------------------------------------------------------------
// Renders the whole pre-app experience into #auth-root:
//   Landing -> (Log in) -> phone/password -> app
//   Landing -> (Create account) -> phone+password -> name -> role -> room -> app
//
// WHY a hand-rolled little "screen" system instead of a framework?
// The rest of Hive is plain HTML/CSS/JS on purpose (see README "Why no
// framework"). A framework like React gives you components and state
// management for free, but for a handful of screens, plain functions that
// render HTML strings into a container are just as easy to follow — and
// there's nothing new to learn. Each renderX() function is self-contained:
// it draws a screen and wires up its own button clicks.
// -----------------------------------------------------------------------------

const authRoot = document.getElementById("auth-root");
const appRoot = document.getElementById("app");

// Holds signup answers across steps until we have everything to register.
const wizard = { phone: "", password: "", name: "" };

function showAuth() {
  appRoot.style.display = "none";
  authRoot.style.display = "flex";
}

function showApp() {
  authRoot.style.display = "none";
  appRoot.style.display = "flex";
}

function authShell(inner) {
  authRoot.innerHTML = `
    <div class="auth-card">
      ${inner}
    </div>
  `;
}

// ---- Password show/hide toggle ---------------------------------------------
// WHY inline SVGs instead of an icon font/library? This project has no build
// step (see README) — no bundler to pull in an icon package. Two tiny inline
// SVGs (eye / eye-slash) keep it dependency-free.
const EYE_OPEN_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg>`;
const EYE_CLOSED_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10.6 5.2C11.06 5.07 11.53 5 12 5c7 0 11 7 11 7-.68 1.2-1.6 2.53-2.79 3.71M6.5 6.5C3.87 8.2 2 12 2 12s4 7 11 7c1.13 0 2.19-.18 3.16-.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

// Renders a password field with an eye-icon toggle. `id` must be unique on
// the screen; call wirePasswordToggle(id) after inserting this HTML.
function passwordFieldHTML(id, label, placeholder) {
  return `
    <div class="auth-field">
      <label>${label}</label>
      <div class="password-wrap">
        <input type="password" id="${id}" placeholder="${placeholder}">
        <button type="button" class="password-toggle" id="${id}-toggle" aria-label="Show password" tabindex="-1">${EYE_OPEN_ICON}</button>
      </div>
    </div>
  `;
}

function wirePasswordToggle(id) {
  const input = document.getElementById(id);
  const toggle = document.getElementById(`${id}-toggle`);
  if (!input || !toggle) return;
  toggle.onclick = () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.innerHTML = showing ? EYE_OPEN_ICON : EYE_CLOSED_ICON;
    toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  };
}

// ---- Button loading state --------------------------------------------------
// Disables the button, dims it, and swaps in a small spinner (CSS handles
// the animation — see .auth-btn.is-loading in style.css) so every submit
// action gives clear feedback instead of looking frozen while it waits on
// the network.
function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (!btn.querySelector(".btn-spinner")) {
      btn.insertAdjacentHTML("beforeend", `<span class="btn-spinner"></span>`);
    }
    btn.disabled = true;
    btn.classList.add("is-loading");
  } else {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    const spinner = btn.querySelector(".btn-spinner");
    if (spinner) spinner.remove();
  }
}

// ---- Landing ------------------------------------------------------------
function renderLanding() {
  authShell(`
    <div class="auth-logo">
      <span class="logo-mark">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" stroke="white" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 8L16.5 10.5V15.5L12 18L7.5 15.5V10.5L12 8Z" fill="white"/></svg>
      </span>
      <h1>Hive</h1>
    </div>
    <p class="auth-tagline">Your boarding house, connected.</p>
    <div class="auth-actions">
      <button class="auth-btn primary" id="go-login">Log In</button>
      <button class="auth-btn secondary" id="go-signup">Create Account</button>
    </div>
  `);
  document.getElementById("go-login").onclick = renderLogin;
  document.getElementById("go-signup").onclick = renderSignupPhone;
}

// ---- Log in (returning users) --------------------------------------------
function renderLogin() {
  authShell(`
    <button class="auth-back" id="back">&larr; Back</button>
    <h2 class="auth-title">Welcome back</h2>
    <p class="auth-sub">Sign in to your Hive account</p>
    <div class="auth-field">
      <label>Phone Number</label>
      <input type="tel" id="login-phone" placeholder="e.g. 0917 123 4567">
    </div>
    ${passwordFieldHTML("login-password", "Password", "&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;")}
    <p class="auth-error" id="login-error"></p>
    <button class="auth-btn primary full" id="submit-login">Sign In</button>
  `);
  wirePasswordToggle("login-password");
  document.getElementById("back").onclick = renderLanding;
  document.getElementById("submit-login").onclick = async () => {
    const phone = document.getElementById("login-phone").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("submit-login");
    errorEl.textContent = "";
    setBtnLoading(btn, true);
    try {
      const { token, user } = await api("/auth/login", { method: "POST", body: { phone, password } });
      Auth.setToken(token);
      Auth.setUser(user);
      routeAfterAuth(user);
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      setBtnLoading(btn, false);
    }
  };
}

// ---- Sign up step 1: phone + password -------------------------------------
function renderSignupPhone() {
  authShell(`
    <button class="auth-back" id="back">&larr; Back</button>
    <h2 class="auth-title">Create your account</h2>
    <p class="auth-sub">Step 1 of 3 &middot; Phone Number</p>
    <div class="auth-field">
      <label>Phone Number</label>
      <input type="tel" id="su-phone" placeholder="e.g. 0917 123 4567" value="${wizard.phone}">
    </div>
    ${passwordFieldHTML("su-password", "Password", "At least 6 characters")}
    <p class="auth-error" id="su-phone-error"></p>
    <button class="auth-btn primary full" id="su-phone-next">Continue</button>
  `);
  wirePasswordToggle("su-password");
  document.getElementById("back").onclick = renderLanding;
  document.getElementById("su-phone-next").onclick = () => {
    const phone = document.getElementById("su-phone").value.trim();
    const password = document.getElementById("su-password").value;
    const errorEl = document.getElementById("su-phone-error");
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length < 7) return (errorEl.textContent = "Enter a valid phone number");
    if (password.length < 6) return (errorEl.textContent = "Password must be at least 6 characters");
    wizard.phone = phone;
    wizard.password = password;
    renderSignupName();
  };
}

// ---- Sign up step 2: name --------------------------------------------------
function renderSignupName() {
  authShell(`
    <button class="auth-back" id="back">&larr; Back</button>
    <h2 class="auth-title">What should we call you?</h2>
    <p class="auth-sub">Step 2 of 3 &middot; Name</p>
    <div class="auth-field">
      <label>Full name</label>
      <input type="text" id="su-name" placeholder="e.g. Alex Santos" value="${wizard.name}">
    </div>
    <p class="auth-error" id="su-name-error"></p>
    <button class="auth-btn primary full" id="su-name-next">Continue</button>
  `);
  document.getElementById("back").onclick = renderSignupPhone;
  document.getElementById("su-name-next").onclick = async () => {
    const name = document.getElementById("su-name").value.trim();
    const errorEl = document.getElementById("su-name-error");
    const btn = document.getElementById("su-name-next");
    if (!name) return (errorEl.textContent = "Enter your name");
    wizard.name = name;
    errorEl.textContent = "";
    setBtnLoading(btn, true);
    try {
      const { token, user } = await api("/auth/register", { method: "POST", body: wizard });
      Auth.setToken(token);
      Auth.setUser(user);
      renderRoleStep();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      setBtnLoading(btn, false);
    }
  };
}

// ---- Sign up step 3: role ---------------------------------------------------
function renderRoleStep() {
  authShell(`
    <h2 class="auth-title">I am a...</h2>
    <p class="auth-sub">Step 3 of 3 &middot; Role</p>
    <div class="role-options">
      <button class="role-option" id="role-tenant">
        <span class="role-name">Tenant</span>
        <span class="role-desc">Access shared tools &amp; your room</span>
      </button>
      <div class="role-option disabled">
        <span class="role-name">Landlord</span>
        <span class="role-desc">Coming soon</span>
        <span class="role-soon">Soon</span>
      </div>
    </div>
    <p class="auth-error" id="role-error"></p>
  `);
  document.getElementById("role-tenant").onclick = async () => {
    const errorEl = document.getElementById("role-error");
    const btn = document.getElementById("role-tenant");
    setBtnLoading(btn, true);
    try {
      const { user } = await api("/auth/role", { method: "PATCH", body: { role: "tenant" } });
      Auth.setUser(user);
      renderRoomStep();
    } catch (err) {
      errorEl.textContent = err.message;
      setBtnLoading(btn, false);
    }
  };
}

// ---- Room step: join via code, or create ------------------------------------
function renderRoomStep() {
  authShell(`
    <h2 class="auth-title">Join your Hive</h2>
    <p class="auth-sub">Have an invite code, or starting fresh?</p>
    <div class="room-choice">
      <button class="room-choice-btn" id="choose-join">
        <span class="role-name">Join with Room Code</span>
        <span class="role-desc">A member of your house shares a code with you</span>
      </button>
      <button class="room-choice-btn" id="choose-create">
        <span class="role-name">Create a Room</span>
        <span class="role-desc">Start a new Hive and invite others</span>
      </button>
    </div>
  `);
  document.getElementById("choose-join").onclick = renderJoinRoom;
  document.getElementById("choose-create").onclick = renderCreateRoom;
}

function renderJoinRoom() {
  authShell(`
    <button class="auth-back" id="back">&larr; Back</button>
    <h2 class="auth-title">Join with Room Code</h2>
    <p class="auth-sub">Ask a current member for their invite code</p>
    <div class="auth-field">
      <label>Room Code</label>
      <input type="text" id="room-code" placeholder="e.g. HIVE-7F3K2Q" style="text-transform:uppercase;letter-spacing:.05em;">
    </div>
    <p class="auth-error" id="join-error"></p>
    <button class="auth-btn primary full" id="submit-join">Send Request</button>
  `);
  document.getElementById("back").onclick = renderRoomStep;
  document.getElementById("submit-join").onclick = async () => {
    const code = document.getElementById("room-code").value.trim();
    const errorEl = document.getElementById("join-error");
    const btn = document.getElementById("submit-join");
    setBtnLoading(btn, true);
    try {
      await api("/rooms/join", { method: "POST", body: { code } });
      renderPendingApproval();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      setBtnLoading(btn, false);
    }
  };
}

function renderPendingApproval() {
  authShell(`
    <div class="auth-pending">
      <h2 class="auth-title">Request sent</h2>
      <p class="auth-sub">A current member of that room needs to accept your request. This usually only takes a moment &mdash; check back, or ask them to open the Announce tab.</p>
      <button class="auth-btn primary full" id="recheck">I've been accepted &mdash; Check again</button>
      <button class="auth-btn secondary full" id="pending-logout">Log out</button>
    </div>
  `);
  document.getElementById("recheck").onclick = async () => {
    const btn = document.getElementById("recheck");
    setBtnLoading(btn, true);
    try {
      const user = await refreshMe();
      if (user.roomId) {
        showApp();
        initApp();
      } else {
        alert("Still pending. Ask a current member to accept your request on the Announce tab.");
      }
    } finally {
      setBtnLoading(btn, false);
    }
  };
  document.getElementById("pending-logout").onclick = () => {
    Auth.logout();
    renderLanding();
  };
}

function renderCreateRoom() {
  authShell(`
    <button class="auth-back" id="back">&larr; Back</button>
    <h2 class="auth-title">Create a Room</h2>
    <p class="auth-sub">This generates the invite code you'll share with roommates</p>
    <div class="auth-field">
      <label>Location <span class="optional">(optional)</span></label>
      <input type="text" id="room-location" placeholder="e.g. Molo, Iloilo City">
    </div>
    <div class="auth-field">
      <label>Monthly Rent (per person)</label>
      <input type="number" id="room-rent" placeholder="e.g. 2000">
    </div>
    <div class="auth-field">
      <label>Notes <span class="optional">(optional)</span></label>
      <textarea id="room-notes" rows="2" placeholder="Anything useful — payment method, house rules, wifi, etc."></textarea>
    </div>
    <p class="auth-error" id="create-error"></p>
    <button class="auth-btn primary full" id="submit-create">Create Room</button>
  `);
  document.getElementById("back").onclick = renderRoomStep;
  document.getElementById("submit-create").onclick = async () => {
    const location = document.getElementById("room-location").value.trim();
    const rent = document.getElementById("room-rent").value;
    const notes = document.getElementById("room-notes").value.trim();
    const errorEl = document.getElementById("create-error");
    const btn = document.getElementById("submit-create");
    setBtnLoading(btn, true);
    try {
      const { room } = await api("/rooms", { method: "POST", body: { location, rent, notes } });
      renderRoomCreated(room);
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      setBtnLoading(btn, false);
    }
  };
}

function renderRoomCreated(room) {
  authShell(`
    <div class="auth-pending">
      <h2 class="auth-title">Your Hive is ready!</h2>
      <p class="auth-sub">Share this code with your roommates so they can join. You can always find it again later in Settings.</p>
      <div class="room-code-display">${room.code}</div>
      <button class="auth-btn secondary full" id="copy-code" style="margin-bottom:10px;">Copy Code</button>
      <button class="auth-btn primary full" id="enter-app">Enter Hive</button>
    </div>
  `);
  document.getElementById("copy-code").onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(room.code);
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1500);
    } catch (_) {
      alert(`Room code: ${room.code}`);
    }
  };
  document.getElementById("enter-app").onclick = () => {
    showApp();
    initApp();
  };
}

// ---- Entry point / router ---------------------------------------------------
function routeAfterAuth(user) {
  if (!user.role) return renderRoleStep();
  if (!user.roomId) return renderRoomStep();
  showApp();
  initApp();
}

async function bootAuth() {
  const token = Auth.getToken();
  if (!token) {
    showAuth();
    renderLanding();
    return;
  }
  const cachedUser = Auth.getUser();
  try {
    const user = await refreshMe();
    showAuth(); // stay hidden-behind-app-shown logic handled in routeAfterAuth
    routeAfterAuth(user);
  } catch (err) {
    // Only a real "your token is invalid/expired" response from the server
    // should log you out. Anything else — no signal, a slow cold start on a
    // free-tier host, a timeout — just means we couldn't check right now,
    // not that the session is bad. Fall back to the last-known user instead
    // of throwing away a perfectly good 30-day session.
    if (err.status === 401 || err.status === 403) {
      Auth.logout();
      showAuth();
      renderLanding();
      return;
    }
    if (cachedUser) {
      showApp();
      initApp();
      // Quietly retry once we're actually back online, so the cached user
      // gets refreshed with anything that changed server-side meanwhile.
      document.addEventListener("hive:back-online", () => refreshMe().catch(() => {}), { once: true });
    } else {
      showAuth();
      renderLanding();
    }
  }
}
