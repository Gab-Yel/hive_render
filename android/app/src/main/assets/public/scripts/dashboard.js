// scripts/dashboard.js
// -----------------------------------------------------------------------------
// Dashboard tab. Per your instructions: the old "scan to update status" step
// is gone — clicking Home / In Room / Outside directly sets your status via
// PATCH /api/users/me/status. Simpler flow, same information.
// -----------------------------------------------------------------------------

const STATUS_LABEL = { home: "Home", in_room: "In Room", outside: "Outside" };

async function initDashboardPage() {
  const user = Auth.getUser();
  document.querySelector("#dashboard h1").innerHTML = `Hey, ${user.name.split(" ")[0]} <span class="wave">👋</span>`;

  wireStatusButtons();
  loadRecentAnnouncement();
  loadFinanceSummary();
  loadMembers();
}

function wireStatusButtons() {
  const buttons = document.querySelectorAll(".status-btn");
  const user = Auth.getUser();
  const statusMap = { home: "home", room: "in_room", outside: "outside" };

  buttons.forEach((btn) => {
    const key = [...btn.classList].find((c) => statusMap[c]);
    if (key && statusMap[key] === user.status) btn.classList.add("active");
    else btn.classList.remove("active");

    btn.addEventListener("click", async () => {
      const status = statusMap[key];
      try {
        const { user: updated } = await api("/users/me/status", { method: "PATCH", body: { status } });
        Auth.setUser(updated);
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelector(".status-current strong").textContent = STATUS_LABEL[status];
        loadMembers();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelector(".status-current strong").textContent = STATUS_LABEL[user.status] || "Home";
}

async function loadRecentAnnouncement() {
  const el = document.getElementById("recent-announcement");
  try {
    const { announcements } = await api("/announcements");
    if (announcements.length === 0) {
      el.innerHTML = `<span>No announcements yet</span>`;
      return;
    }
    const latest = announcements[0];
    el.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <span><strong>${latest.title}</strong> — ${latest.body || ""}</span>
    `;
  } catch (_) {
    el.innerHTML = `<span>No announcements yet</span>`;
  }
}

function formatDueDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function loadFinanceSummary() {
  try {
    const { rent, electric, water } = await api("/finances/overview");
    document.querySelector("#finance-dashboard .rent h3").textContent = `₱${Number(rent.amount).toLocaleString()}`;
    document.getElementById("rent-due").textContent = rent.paid ? "Paid this month" : "Due · not yet paid";

    if (electric) {
      document.querySelector("#finance-dashboard .electricity h3").textContent = `₱${Number(electric.amount).toLocaleString()}`;
      document.getElementById("electricity-due").textContent = electric.paid ? "Paid" : `Due ${formatDueDate(electric.due_date)}`;
    }
    if (water) {
      document.querySelector("#finance-dashboard .water h3").textContent = `₱${Number(water.amount).toLocaleString()}`;
      document.getElementById("water-due").textContent = water.paid ? "Paid" : `Due ${formatDueDate(water.due_date)}`;
    }
  } catch (_) {
    // Not in a room yet, or nothing to show — leave placeholders.
  }
}

async function loadMembers() {
  const board = document.getElementById("status-board");
  try {
    const { members } = await api("/users/room");
    const user = Auth.getUser();
    const inRoomCount = members.filter((m) => m.status === "in_room").length;

    board.querySelector(".board-sub").textContent = `${inRoomCount} in room now`;

    const rows = members
      .map((m) => {
        const initials = m.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
        const isYou = m.id === user.id;
        const statusClass = m.status === "in_room" ? "room" : m.status === "outside" ? "outside" : "home";
        const avatarStyle = m.avatar
          ? `style="background-image:url(${m.avatar});background-size:cover;background-position:center;"`
          : "";
        return `
          <div class="member-row">
            <div class="avatar member-avatar" ${avatarStyle}>${m.avatar ? "" : initials}</div>
            <div class="member-info">
              <span class="member-name">${m.name} ${isYou ? "<em>You</em>" : ""}</span>
            </div>
            <span class="badge ${statusClass}">${STATUS_LABEL[m.status] || "Home"}</span>
          </div>
        `;
      })
      .join("");

    // Keep the board-head element, replace only the rows after it.
    const head = board.querySelector(".board-head");
    board.innerHTML = "";
    board.appendChild(head);
    board.insertAdjacentHTML("beforeend", rows);
  } catch (_) {
    // ignore
  }
}

window.initDashboardPage = initDashboardPage;
