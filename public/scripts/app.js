// scripts/app.js
// -----------------------------------------------------------------------------
// The app "shell": sidebar navigation + loading page fragments into
// #main-content, same fetch-a-fragment pattern the original prototype used.
// WHY keep that pattern instead of a full client-side framework/router?
// Each tab (dashboard/finances/hive) is a plain HTML file under /pages. When
// you click a sidebar button we fetch that file's HTML and drop it into
// #main-content, then call that page's init function to wire up its buttons
// and load its data from the API. It's simple enough to read top-to-bottom,
// which matters since this is your learning project — a router library
// would hide exactly the mechanics you're trying to learn.
// -----------------------------------------------------------------------------

const PAGE_INIT = {
  "pages/dashboard.html": () => window.initDashboardPage && window.initDashboardPage(),
  "pages/finances.html": () => window.initFinancesPage && window.initFinancesPage(),
  "pages/hive.html": () => window.initHivePage && window.initHivePage(),
  "pages/personal.html": () => window.initPersonalPage && window.initPersonalPage(),
};

async function loadPage(fileName) {
  const viewContainer = document.getElementById("main-content");
  try {
    const response = await fetch(fileName, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    viewContainer.innerHTML = await response.text();
    if (PAGE_INIT[fileName]) await PAGE_INIT[fileName]();
  } catch (error) {
    viewContainer.innerHTML = `<p style="color:red;">Failed to load view: ${error.message}</p>`;
  }
}

function renderSidebarUser() {
  const user = Auth.getUser();
  if (!user) return;
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatarEl = document.getElementById("sidebar-avatar");
  avatarEl.textContent = initials;
  if (user.avatar) {
    avatarEl.style.backgroundImage = `url(${user.avatar})`;
    avatarEl.style.backgroundSize = "cover";
    avatarEl.style.backgroundPosition = "center";
    avatarEl.textContent = "";
  } else {
    avatarEl.style.backgroundImage = "";
  }
  document.getElementById("sidebar-who-name").textContent = user.name;
}

async function renderSidebarLocation() {
  try {
    const { room } = await api("/rooms/mine");
    document.getElementById("sidebar-location-text").textContent = room && room.location ? room.location : "No location set";
  } catch (_) {
    document.getElementById("sidebar-location-text").textContent = "";
  }
}

// initApp() is called by auth.js once the user is fully logged in AND has a
// room. It only needs to run once per session.
// ---- Mobile sidebar drawer -------------------------------------------------
// On narrow screens (see the @media block in style.css) #main-sidebar
// becomes an off-canvas drawer instead of the old icon-only rail — that
// rail had a real bug where it hid the nav buttons entirely, leaving no
// way to navigate on an actual phone. Tapping the logo (either the always-
// visible one in #mobile-topbar, or the sidebar's own once it's open)
// toggles the drawer; tapping the backdrop or a nav link closes it.
function setSidebarOpen(open) {
  document.getElementById("main-sidebar").classList.toggle("open", open);
  document.getElementById("sidebar-backdrop").classList.toggle("open", open);
}

function wireSidebarToggle() {
  const topbarToggle = document.getElementById("mobile-topbar-toggle");
  const sidebarLogo = document.getElementById("sidebar-logo-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");

  if (topbarToggle) topbarToggle.addEventListener("click", () => setSidebarOpen(true));
  if (sidebarLogo) sidebarLogo.addEventListener("click", () => setSidebarOpen(false));
  if (backdrop) backdrop.addEventListener("click", () => setSidebarOpen(false));
}

// ---- Notifications ----------------------------------------------------------
// WHY this, and not a real push notification (the kind that alerts you even
// when the app is closed)? Real push needs a Firebase/APNs project, native
// permission prompts, and device-token registration — a genuinely separate
// piece of infrastructure. This is the practical "if possible" version: an
// in-app bell that tracks how much room activity you haven't seen yet
// (new polls, bills, calendar events, join requests — anything that shows
// up on the Announce tab, which this reuses as a unified feed). Polling
// every 45s while the app is open is enough to feel current without
// hammering a free-tier host.
const NOTIFICATION_POLL_MS = 45000;

async function refreshNotificationBadge() {
  try {
    const { count } = await api("/announcements/unread-count");
    document.querySelectorAll(".bell-badge").forEach((el) => {
      if (count > 0) {
        el.textContent = count > 9 ? "9+" : String(count);
        el.style.display = "flex";
      } else {
        el.style.display = "none";
      }
    });
  } catch (_) {
    // Not fatal — badge just stays as it was (e.g. not in a room yet).
  }
}

function wireNotificationBell() {
  document.querySelectorAll(".notification-bell").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setSidebarOpen(false);
      // The Hive page defaults to its Announce tab, which is exactly the
      // unified feed this bell is tracking — reuse the existing nav button
      // so active-state/page-load logic doesn't need duplicating here.
      const hiveNavBtn = document.querySelector('.sidebar-btn[data-target="pages/hive.html"]');
      if (hiveNavBtn) hiveNavBtn.click();
      try {
        await api("/announcements/mark-seen", { method: "POST" });
      } catch (_) {
        // Non-critical — badge will just re-fetch as unread again shortly.
      }
      await refreshNotificationBadge();
    });
  });
}

let appInitialized = false;
function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  renderSidebarUser();
  renderSidebarLocation();
  wireSidebarToggle();
  wireNotificationBell();
  refreshNotificationBadge();
  setInterval(refreshNotificationBadge, NOTIFICATION_POLL_MS);

  const buttons = document.querySelectorAll(".sidebar-btn");
  buttons.forEach((button) => {
    button.addEventListener("click", (e) => {
      if (button.classList.contains("nav-disabled")) {
        alert("This section needs an internet connection. Personal still works offline.");
        return;
      }
      loadPage(e.currentTarget.dataset.target);
      buttons.forEach((btn) => btn.classList.remove("active"));
      e.currentTarget.classList.add("active");
      setSidebarOpen(false); // navigating on mobile should close the drawer
    });
  });

  document.getElementById("sidebar-footer-btn").addEventListener("click", () => {
    setSidebarOpen(false);
    openSettings();
  });

  wireOfflineUI();
  updateOfflineUI();

  // Offline (no cached session data to even try Dashboard with, or simply
  // no signal at boot) -> land on Personal, the one section that works
  // without a connection, instead of a Dashboard full of failed requests.
  if (!navigator.onLine) {
    const personalBtn = document.querySelector('.sidebar-btn[data-target="pages/personal.html"]');
    buttons.forEach((btn) => btn.classList.remove("active"));
    if (personalBtn) personalBtn.classList.add("active");
    loadPage("pages/personal.html");
  } else {
    loadPage("pages/dashboard.html");
  }
}

// ---- Offline gating + banner --------------------------------------------------
// Only the Personal page works without a connection (see scripts/offline.js
// for why). This keeps the rest of the nav honest about that instead of
// letting people tap into a broken Dashboard/Finance/Hive with no signal.
const OFFLINE_RESTRICTED_TARGETS = ["pages/dashboard.html", "pages/finances.html", "pages/hive.html"];

function updateOfflineUI() {
  const online = navigator.onLine;

  document.querySelectorAll(".sidebar-btn").forEach((btn) => {
    const restricted = OFFLINE_RESTRICTED_TARGETS.includes(btn.dataset.target);
    btn.classList.toggle("nav-disabled", restricted && !online);
  });

  let banner = document.getElementById("offline-banner");
  if (!online) {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "offline-banner";
      banner.className = "offline-banner";
      banner.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8.5a16 16 0 0 1 20 0M5.5 12a11 11 0 0 1 13 0M9 15.5a6 6 0 0 1 6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>
        <span>You're offline — Personal still works. Everything else needs a connection.</span>
      `;
      const app = document.getElementById("app");
      app.insertBefore(banner, app.firstChild);
    }
  } else if (banner) {
    banner.remove();
  }
}

function wireOfflineUI() {
  window.addEventListener("online", updateOfflineUI);
  window.addEventListener("offline", updateOfflineUI);
}

document.addEventListener("DOMContentLoaded", () => {
  bootAuth();
});
