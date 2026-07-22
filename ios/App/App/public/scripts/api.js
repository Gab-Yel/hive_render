// scripts/api.js
// -----------------------------------------------------------------------------
// A tiny wrapper around fetch() so every other script doesn't have to repeat
// "attach the token, parse JSON, handle errors" every single time.
//
// WHY localStorage for the token?
// It's the simplest place a browser can remember something across page
// reloads without a backend session. The trade-off (worth knowing as you
// learn): localStorage is readable by any JS that runs on your page, so if
// your site ever had an XSS bug, the token could be stolen. For a learning
// project / small real app this is a totally standard, acceptable choice —
// plenty of production apps do exactly this. If you later want the extra
// safety margin, the upgrade path is an httpOnly cookie set by the server
// instead — but that adds CORS/cookie complexity that isn't worth it yet,
// especially since you're heading toward a mobile app where a plain bearer
// token (stored in SecureStore) is actually the more natural fit anyway.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// WHY not just "/api" anymore?
// On the plain website, the page and the API are the same origin, so a
// relative path works. Inside the Capacitor-wrapped app, though, index.html
// is loaded from a bundled local file (not your server) — a relative "/api"
// would try to hit that local origin and fail. So: set PRODUCTION_API_URL to
// your deployed backend's URL once you have one (Railway/Render/etc), and
// the native app will always use it. Plain local web development
// (localhost:8000) still uses the relative path for convenience. CORS is
// already enabled on the server (see server/src/index.js), so this works
// from any origin.
// -----------------------------------------------------------------------------
// This must be YOUR deployed Express backend's URL (Railway/Render/VPS —
// see DEPLOYMENT.md Part 2), with "/api" on the end, e.g.
// "https://hive-production.up.railway.app/api".
//
// A common mistake: pasting your Supabase *project* URL here instead.
// Supabase's URL (https://xxxx.supabase.co) points to Supabase's own
// auto-generated REST API (PostgREST), which has no idea what "/auth/
// register" means — this app's routes (/auth/register, /auth/login, etc.)
// only exist on the Express server in server/src/routes, wherever *that*
// is deployed. Supabase is only used here as the Postgres database (see
// server/src/db.js) — the app never talks to Supabase directly from the
// browser/app. Hitting the Supabase URL directly is exactly what causes a
// "Request failed (401)" on every request, including on mobile, since the
// native app always uses this constant (see API_BASE below).
const PRODUCTION_API_URL = "https://hive-render.onrender.com/api";

const API_BASE = (() => {
  const isNative = window.Capacitor?.isNativePlatform?.();
  const isLocalWeb = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isNative) return PRODUCTION_API_URL;
  return isLocalWeb ? "/api" : PRODUCTION_API_URL;
})();

const Auth = {
  getToken() {
    return localStorage.getItem("hive_token");
  },
  setToken(token) {
    localStorage.setItem("hive_token", token);
  },
  clearToken() {
    localStorage.removeItem("hive_token");
  },
  getUser() {
    const raw = localStorage.getItem("hive_user");
    return raw ? JSON.parse(raw) : null;
  },
  setUser(user) {
    localStorage.setItem("hive_user", JSON.stringify(user));
  },
  logout() {
    localStorage.removeItem("hive_token");
    localStorage.removeItem("hive_user");
  },
};

// -----------------------------------------------------------------------------
// Global "top loading bar" — shows automatically for the duration of ANY
// api() call, anywhere in the app, with no per-page wiring needed. Uses a
// counter so overlapping requests don't hide the bar early (e.g. dashboard
// firing 3 fetches at once — the bar only disappears once all of them
// finish).
// -----------------------------------------------------------------------------
let _activeRequests = 0;
function _getLoadingBar() {
  let bar = document.getElementById("global-loading-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "global-loading-bar";
    document.body.appendChild(bar);
  }
  return bar;
}
function _showGlobalLoader() {
  _activeRequests++;
  const bar = _getLoadingBar();
  bar.classList.remove("done");
  // Force reflow so the width transition restarts cleanly if it fires again
  // right after a previous request just finished.
  void bar.offsetWidth;
  bar.classList.add("active");
}
function _hideGlobalLoader() {
  _activeRequests = Math.max(0, _activeRequests - 1);
  if (_activeRequests > 0) return;
  const bar = _getLoadingBar();
  bar.classList.remove("active");
  bar.classList.add("done");
  setTimeout(() => {
    if (_activeRequests === 0) bar.classList.remove("done");
  }, 300);
}

// WHY a timeout at all? Without one, a truly unreachable backend (wrong
// URL, server down, DNS failure) leaves fetch() hanging with no error for
// a very long time — from the person's point of view that looks exactly
// like the app being frozen. 20s is generous enough to cover a free-tier
// host waking up from a cold start (Render/Railway free plans can take
// 20-50s the first time), while still eventually telling the person
// something is wrong instead of leaving them stuck forever.
const REQUEST_TIMEOUT_MS = 20000;

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = Auth.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  _showGlobalLoader();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        "The server took too long to respond. If it's a free-tier host it may be waking up from sleep — try again in a moment."
      );
    }
    throw new Error("Couldn't reach the server. Check your internet connection and that the backend is deployed and running.");
  } finally {
    clearTimeout(timeoutId);
    _hideGlobalLoader();
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // no JSON body (e.g. 204) — that's fine
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return data;
}

// Central place to read/refresh "who am I" and keep localStorage in sync.
async function refreshMe() {
  const { user } = await api("/auth/me");
  Auth.setUser(user);
  return user;
}
