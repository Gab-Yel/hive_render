// scripts/hive.js
// -----------------------------------------------------------------------------
// Powers the Hive tab's four panels. The two most "new" pieces here:
//
// 1. JOIN REQUESTS AS NOTIFICATIONS ON THE ANNOUNCE TAB
//    When someone joins with a room code, the server creates an announcement
//    with type "join_request". We detect that type here and render it as a
//    special card with Accept/Decline buttons instead of a normal post. Once
//    any current member responds, the server deletes that notification (see
//    routes/rooms.js) so it naturally disappears for everyone on next load.
//
// 2. SCHEDULE VISIBILITY
//    Selecting a roommate in the dropdown fetches THEIR sessions. The API
//    already redacts the title server-side when visible=false and you're not
//    the owner (see routes/schedules.js) — the client just needs to render
//    whatever it gets back and show a lock icon on hidden sessions.
// -----------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function initHivePage() {
  wireTabs("#hive-tabs");

  toggleComposer("new-announcement-btn", "announcement-form", "close-announcement-form");
  wirePriorityPicker();
  document.getElementById("post-announcement-btn").addEventListener("click", handlePostAnnouncement);
  loadAnnouncements();

  toggleComposer("new-note-btn", "note-form", "close-note-form");
  document.getElementById("note-add-photo-btn").addEventListener("click", () => document.getElementById("note-photo-input").click());
  document.getElementById("new-photo-btn").addEventListener("click", () => {
    document.getElementById("note-form").classList.add("open");
    document.getElementById("note-photo-input").click();
  });
  document.getElementById("note-photo-input").addEventListener("change", handleNotePhoto);
  document.getElementById("post-note-btn").addEventListener("click", handlePostNote);
  loadBulletin();

  toggleComposer("new-poll-btn", "poll-form", "close-poll-form");
  document.getElementById("add-poll-option-btn").addEventListener("click", addPollOptionInput);
  document.getElementById("submit-poll-btn").addEventListener("click", handleCreatePoll);
  loadPolls();

  toggleComposer("edit-schedule-btn", "session-form", "close-session-form");
  wireDayPicker();
  document.getElementById("submit-session-btn").addEventListener("click", handleAddSession);
  document.getElementById("schedule-dropdown-btn").addEventListener("click", () => {
    document.getElementById("schedule-dropdown").classList.toggle("open");
  });
  initSchedule();

  wireScheduleViewToggle();
  toggleComposer("add-event-btn", "event-form", "close-event-form");
  document.getElementById("submit-event-btn").addEventListener("click", handleAddEvent);
  document.getElementById("calendar-prev-month").addEventListener("click", () => changeCalendarMonth(-1));
  document.getElementById("calendar-next-month").addEventListener("click", () => changeCalendarMonth(1));
}

// ---- Announcements ------------------------------------------------------
function wirePriorityPicker() {
  document.querySelectorAll("#announcement-form .priority-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#announcement-form .priority-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

async function loadAnnouncements() {
  const list = document.getElementById("announcement-list");
  try {
    const { announcements } = await api("/announcements");
    if (announcements.length === 0) {
      list.innerHTML = `<p class="chart-empty">No announcements yet. Be the first to post one!</p>`;
      return;
    }

    list.innerHTML = announcements.map(renderAnnouncementCard).join("");

    list.querySelectorAll("[data-respond-request]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const accept = btn.dataset.respondRequest === "accept";
        const card = btn.closest("[data-join-request-id]");
        const requestId = card.dataset.joinRequestId;
        // Disable both buttons immediately — without this, a slow network
        // (or an impatient double-tap) could fire the request twice, and
        // the second one would fail with "already resolved" even though
        // the first one worked fine.
        card.querySelectorAll("[data-respond-request]").forEach((b) => (b.disabled = true));
        try {
          await api(`/rooms/requests/${requestId}/respond`, { method: "POST", body: { accept } });
          await loadAnnouncements();
        } catch (err) {
          if (err.status === 400 && /already resolved/i.test(err.message)) {
            // Someone already responded (a double-tap, or a roommate beat
            // you to it) — just refresh the list instead of alarming the
            // person with an error; the stale card will disappear.
            await loadAnnouncements();
          } else {
            alert(err.message);
            card.querySelectorAll("[data-respond-request]").forEach((b) => (b.disabled = false));
          }
        }
      });
    });
  } catch (_) {
    list.innerHTML = `<p class="chart-empty">Couldn't load announcements.</p>`;
  }
}

function timeAgo(raw) {
  // Postgres sends "timestamp" columns back as plain text like
  // "2026-07-19 05:12:33.822" (see db.js's type parser) — not valid ISO
  // until we swap the space for a "T". Handle both that and an already-ISO
  // string gracefully instead of assuming one specific shape.
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return "";

  const diffMs = Date.now() - parsed.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function renderAnnouncementCard(a) {
  if (a.type === "join_request") {
    return `
      <div class="announcement-card notice" data-join-request-id="${a.join_request_id}">
        <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M17 8h4M19 6v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <div class="announcement-body">
          <div class="announcement-head">
            <p class="announcement-title">${a.title}</p>
            <span class="announcement-tag notice">join request</span>
          </div>
          <p class="announcement-text">${a.body}</p>
          <div class="join-request-actions">
            <button class="join-accept-btn" data-respond-request="accept">Accept</button>
            <button class="join-decline-btn" data-respond-request="decline">Decline</button>
          </div>
          <p class="announcement-meta">${timeAgo(a.created_at)}</p>
        </div>
      </div>
    `;
  }

  const priority = a.priority || "info";
  const icon =
    priority === "urgent"
      ? `<svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
      : `<svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3a5 5 0 0 0-5 5v3.2c0 .7-.24 1.38-.68 1.92L5 15h14l-1.32-1.88A3 3 0 0 1 17 11.2V8a5 5 0 0 0-5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  return `
    <div class="announcement-card ${priority}">
      ${icon}
      <div class="announcement-body">
        <div class="announcement-head">
          <p class="announcement-title">${a.title}</p>
          <span class="announcement-tag ${priority}">${priority}</span>
        </div>
        ${a.body ? `<p class="announcement-text">${a.body}</p>` : ""}
        <p class="announcement-meta">${timeAgo(a.created_at)} · ${a.author_name || "System"}</p>
      </div>
    </div>
  `;
}

async function handlePostAnnouncement() {
  const title = document.getElementById("announcement-title").value.trim();
  const body = document.getElementById("announcement-body").value.trim();
  const priority = document.querySelector("#announcement-form .priority-btn.active").dataset.priority;
  if (!title) return alert("Give it a title");

  await api("/announcements", { method: "POST", body: { title, body, priority } });
  document.getElementById("announcement-title").value = "";
  document.getElementById("announcement-body").value = "";
  document.getElementById("announcement-form").classList.remove("open");
  await loadAnnouncements();
}

// ---- Bulletin -------------------------------------------------------------
let pendingNoteImage = null;

async function handleNotePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingNoteImage = reader.result;
    const preview = document.getElementById("note-image-preview");
    preview.innerHTML = `<img src="${pendingNoteImage}" alt="">`;
    preview.classList.add("has-image");
  };
  reader.readAsDataURL(file);
}

async function handlePostNote() {
  const text = document.getElementById("note-body").value.trim();
  if (!text && !pendingNoteImage) return alert("Write something or add a photo");

  await api("/bulletin", { method: "POST", body: { text, image: pendingNoteImage } });
  document.getElementById("note-body").value = "";
  document.getElementById("note-image-preview").innerHTML = "";
  document.getElementById("note-image-preview").classList.remove("has-image");
  pendingNoteImage = null;
  document.getElementById("note-form").classList.remove("open");
  await loadBulletin();
}

const BULLETIN_COLORS = ["amber", "rose", "emerald", "sky"];

async function loadBulletin() {
  const grid = document.getElementById("bulletin-grid");
  try {
    const { notes } = await api("/bulletin");
    if (notes.length === 0) {
      grid.innerHTML = `<p class="chart-empty">No notes yet.</p>`;
      return;
    }
    grid.innerHTML = notes
      .map((n, i) => {
        const color = BULLETIN_COLORS[i % BULLETIN_COLORS.length];
        return `
        <div class="bulletin-card ${color}">
          ${n.image ? `<img class="bulletin-image" src="${n.image}" alt="">` : ""}
          <div class="bulletin-content">
            ${n.text ? `<p class="bulletin-text">${n.text}</p>` : ""}
            <div class="bulletin-foot">
              <span class="bulletin-author">${n.author_name}</span>
              <span class="bulletin-time">${timeAgo(n.created_at)}</span>
            </div>
          </div>
        </div>`;
      })
      .join("");
  } catch (_) {
    grid.innerHTML = `<p class="chart-empty">Couldn't load notes.</p>`;
  }
}

// ---- Poll -------------------------------------------------------------------
function addPollOptionInput() {
  const wrap = document.getElementById("poll-option-inputs");
  const count = wrap.children.length + 1;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "composer-input poll-option-input";
  input.placeholder = `Option ${count}`;
  wrap.appendChild(input);
}

async function handleCreatePoll() {
  const question = document.getElementById("poll-question").value.trim();
  const options = [...document.querySelectorAll(".poll-option-input")].map((i) => i.value.trim()).filter(Boolean);
  const deadlineRaw = document.getElementById("poll-deadline").value;
  const deadline = deadlineRaw ? new Date(deadlineRaw).toISOString() : null;

  if (!question || options.length < 2) return alert("Add a question and at least 2 options");

  await api("/polls", { method: "POST", body: { question, options, deadline } });

  document.getElementById("poll-question").value = "";
  document.getElementById("poll-deadline").value = "";
  document.getElementById("poll-option-inputs").innerHTML = `
    <input type="text" class="composer-input poll-option-input" placeholder="Option 1">
    <input type="text" class="composer-input poll-option-input" placeholder="Option 2">
  `;
  document.getElementById("poll-form").classList.remove("open");
  await loadPolls();
}

function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const closed = d.getTime() < Date.now();
  const label = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return { label, closed };
}

async function loadPolls() {
  const list = document.getElementById("poll-list");
  try {
    const { polls } = await api("/polls");
    if (polls.length === 0) {
      list.innerHTML = `<p class="chart-empty">No polls yet. Create one above.</p>`;
      return;
    }

    list.innerHTML = polls
      .map((p) => {
        const dl = formatDeadline(p.deadline);
        const closed = dl && dl.closed;
        return `
        <div class="poll-card">
          <div class="poll-head">
            <span class="poll-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 3v7a2 2 0 0 0 2 2v9M7 3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2M17 3c-1.7 0-3 2.2-3 6.5S15.3 15 17 15v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <div>
              <p class="poll-question">${p.question}</p>
              <p class="poll-meta">${dl ? `${closed ? "Closed" : "Closes"} ${dl.label} · ` : ""}${p.totalVotes} vote${p.totalVotes === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div class="poll-options" data-poll-id="${p.id}">
            ${p.options
              .map(
                (o) => `
              <button class="poll-option ${p.myOptionId === o.id ? "voted" : ""}" data-option-id="${o.id}" ${closed ? "disabled" : ""}>
                <span class="poll-fill" style="width:${o.pct}%"></span>
                <span class="poll-row">
                  <span class="poll-label">${o.label}</span>
                  <span class="poll-stats"><span class="poll-votes">${o.votes} votes</span><span class="poll-pct">${o.pct}%</span></span>
                </span>
              </button>`
              )
              .join("")}
          </div>
          <p class="poll-hint">${closed ? "This poll is closed" : p.myOptionId ? "Tap another option to change your vote" : "Tap an option to vote"}</p>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".poll-option:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pollId = btn.closest(".poll-options").dataset.pollId;
        try {
          await api(`/polls/${pollId}/vote`, { method: "POST", body: { optionId: btn.dataset.optionId } });
          await loadPolls();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (_) {
    list.innerHTML = `<p class="chart-empty">Couldn't load polls.</p>`;
  }
}

// ---- Schedule ---------------------------------------------------------------
let scheduleSelectedUserId = null;
let scheduleSelectedDays = new Set();

function wireDayPicker() {
  document.querySelectorAll("#session-day-picker .day-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const day = chip.dataset.day;
      if (scheduleSelectedDays.has(day)) {
        scheduleSelectedDays.delete(day);
        chip.classList.remove("active");
      } else {
        scheduleSelectedDays.add(day);
        chip.classList.add("active");
      }
    });
  });
}

async function initSchedule() {
  const user = Auth.getUser();
  try {
    const { members } = await api("/users/room");
    const menu = document.getElementById("schedule-dropdown-menu");
    menu.innerHTML = members
      .map(
        (m) => `<button class="schedule-option" data-user-id="${m.id}">${m.id === user.id ? "Your Schedule" : `${m.name}&rsquo;s Schedule`}</button>`
      )
      .join("");

    menu.querySelectorAll(".schedule-option").forEach((btn) => {
      btn.addEventListener("click", () => selectScheduleUser(btn.dataset.userId, btn.textContent));
    });

    // Default to viewing your own schedule.
    const mine = menu.querySelector(`[data-user-id="${user.id}"]`);
    selectScheduleUser(user.id, mine ? mine.textContent : "Your Schedule");
  } catch (_) {
    document.getElementById("weekly-grid").innerHTML = `<p class="chart-empty">Couldn't load members.</p>`;
  }
}

function selectScheduleUser(userId, label) {
  scheduleSelectedUserId = userId;
  document.getElementById("schedule-dropdown-label").textContent = label;
  document.querySelectorAll(".schedule-option").forEach((b) => {
    b.classList.toggle("active", b.dataset.userId === String(userId));
  });
  document.getElementById("schedule-dropdown").classList.remove("open");

  const user = Auth.getUser();
  const isOwn = userId === user.id;
  document.getElementById("edit-schedule-btn").style.display = isOwn ? "flex" : "none";
  if (!isOwn) document.getElementById("session-form").classList.remove("open");

  document.getElementById("schedule-note").innerHTML = `Showing schedule for <strong>${label}</strong>${
    isOwn ? "" : " · hidden sessions show as <strong>Busy</strong>"
  }`;

  loadSchedule();
}

// ---- Weekly grid layout constants -------------------------------------------
// Covers 6am–10pm, which fits typical class/work/errand schedules without
// the grid getting unreasonably tall. A session outside this range gets
// clamped to the visible edge rather than breaking the layout.
const GRID_START_HOUR = 6;
const GRID_END_HOUR = 22;
const ROW_HEIGHT_PX = 48;
const DEFAULT_BLOCK_MINUTES = 60; // used when a session has no end time

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

async function loadSchedule() {
  const grid = document.getElementById("weekly-grid");
  try {
    const { sessions } = await api(`/schedules/user/${scheduleSelectedUserId}`);
    renderWeeklyGrid(grid, sessions);
  } catch (_) {
    grid.innerHTML = `<p class="chart-empty">Couldn't load schedule.</p>`;
  }
}

function renderWeeklyGrid(grid, sessions) {
  const totalHours = GRID_END_HOUR - GRID_START_HOUR;
  const gridHeight = totalHours * ROW_HEIGHT_PX;

  const timeLabels = Array.from({ length: totalHours }, (_, i) => {
    const hour = GRID_START_HOUR + i;
    const label = hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
    return `<div class="weekly-time-label" style="height:${ROW_HEIGHT_PX}px;">${label}</div>`;
  }).join("");

  const hourLines = Array.from(
    { length: totalHours },
    (_, i) => `<div class="weekly-hour-line" style="top:${i * ROW_HEIGHT_PX}px;"></div>`
  ).join("");

  const dayColumns = DAY_LABELS.map((_, dayIndex) => {
    const daySessions = sessions.filter((s) => s.dayOfWeek === dayIndex);
    const blocks = daySessions
      .map((s) => {
        const startMin = Math.max(timeToMinutes(s.startTime), GRID_START_HOUR * 60);
        const rawEndMin = s.endTime ? timeToMinutes(s.endTime) : timeToMinutes(s.startTime) + DEFAULT_BLOCK_MINUTES;
        const endMin = Math.min(Math.max(rawEndMin, startMin + 20), GRID_END_HOUR * 60);
        const top = ((startMin - GRID_START_HOUR * 60) / 60) * ROW_HEIGHT_PX;
        const height = Math.max(24, ((endMin - startMin) / 60) * ROW_HEIGHT_PX);
        const isPrivate = !s.visible && !s.isOwner;

        return `
          <div class="weekly-session-block ${isPrivate ? "private" : ""}" style="top:${top}px;height:${height}px;">
            <span class="weekly-session-title">${s.title}${isPrivate ? " 🔒" : ""}</span>
            <span class="weekly-session-time">${s.startTime}${s.endTime ? `–${s.endTime}` : ""}</span>
            ${s.isOwner ? `<button class="weekly-session-delete" data-session-id="${s.id}" title="Delete">&times;</button>` : ""}
          </div>
        `;
      })
      .join("");

    return `<div class="weekly-day-col" style="height:${gridHeight}px;">${hourLines}${blocks}</div>`;
  }).join("");

  grid.innerHTML = `
    <div class="weekly-grid-corner"></div>
    ${DAY_LABELS.map((d) => `<div class="weekly-day-header">${d}</div>`).join("")}
    <div class="weekly-time-col">${timeLabels}</div>
    ${dayColumns}
  `;

  grid.querySelectorAll(".weekly-session-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api(`/schedules/${btn.dataset.sessionId}`, { method: "DELETE" });
      await loadSchedule();
    });
  });
}

async function handleAddSession() {
  const title = document.getElementById("session-title").value.trim();
  const startTime = document.getElementById("session-start").value;
  const endTime = document.getElementById("session-end").value;
  const visible = document.getElementById("session-visible").checked;

  if (!title || !startTime || scheduleSelectedDays.size === 0) {
    return alert("Add a title, pick at least one day, and set a start time");
  }

  await Promise.all(
    [...scheduleSelectedDays].map((day) =>
      api("/schedules", {
        method: "POST",
        body: { dayOfWeek: Number(day), startTime, endTime: endTime || null, title, visible },
      })
    )
  );

  document.getElementById("session-title").value = "";
  document.getElementById("session-start").value = "";
  document.getElementById("session-end").value = "";
  document.getElementById("session-visible").checked = true;
  document.querySelectorAll("#session-day-picker .day-chip").forEach((c) => c.classList.remove("active"));
  scheduleSelectedDays.clear();
  document.getElementById("session-form").classList.remove("open");
  await loadSchedule();
}

// ---- Schedule view toggle: Weekly Schedule <-> Room Calendar ----------------
let roomCalendarInitialized = false;

function wireScheduleViewToggle() {
  document.querySelectorAll("#schedule-view-toggle .schedule-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#schedule-view-toggle .schedule-view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const isWeekly = btn.dataset.view === "weekly";
      document.getElementById("schedule-weekly-view").style.display = isWeekly ? "" : "none";
      document.getElementById("schedule-calendar-view").style.display = isWeekly ? "none" : "";
      if (!isWeekly && !roomCalendarInitialized) {
        roomCalendarInitialized = true;
        initRoomCalendar();
      }
    });
  });
}

// ---- Room Calendar (shared, one-off dates) ----------------------------------
// A standard month-grid calendar. Anyone in the room can mark a date (move-
// out day, a house meeting) — separate from the weekly grid above, which is
// personal and recurring by day-of-week.
let calendarYear, calendarMonth; // calendarMonth is 0-indexed (Date convention)
let calendarEventsCache = [];
let calendarSelectedDateStr = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateKey(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
function monthKeyOf(y, m) {
  return `${y}-${pad2(m + 1)}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function initRoomCalendar() {
  const today = new Date();
  calendarYear = today.getFullYear();
  calendarMonth = today.getMonth();
  calendarSelectedDateStr = dateKey(calendarYear, calendarMonth, today.getDate());
  loadCalendarMonth();
}

function changeCalendarMonth(delta) {
  calendarMonth += delta;
  if (calendarMonth < 0) {
    calendarMonth = 11;
    calendarYear -= 1;
  } else if (calendarMonth > 11) {
    calendarMonth = 0;
    calendarYear += 1;
  }
  document.getElementById("event-form").classList.remove("open");
  loadCalendarMonth();
}

async function loadCalendarMonth() {
  const grid = document.getElementById("calendar-grid");
  document.getElementById("calendar-month-label").textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;
  try {
    const { events } = await api(`/room-events?month=${monthKeyOf(calendarYear, calendarMonth)}`);
    calendarEventsCache = events;
    renderCalendarGrid();
    renderCalendarDayDetail();
  } catch (_) {
    grid.innerHTML = `<p class="chart-empty">Couldn't load the calendar.</p>`;
  }
}

function renderCalendarGrid() {
  const grid = document.getElementById("calendar-grid");
  const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const todayStr = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const eventDatesSet = new Set(calendarEventsCache.map((e) => e.event_date));

  let cells = "";
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="calendar-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(calendarYear, calendarMonth, day);
    const isToday = key === todayStr;
    const isSelected = key === calendarSelectedDateStr;
    const hasEvent = eventDatesSet.has(key);
    cells += `
      <button class="calendar-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" data-date="${key}">
        <span class="calendar-cell-day">${day}</span>
        ${hasEvent ? `<span class="calendar-cell-dot"></span>` : ""}
      </button>
    `;
  }
  grid.innerHTML = cells;

  grid.querySelectorAll(".calendar-cell:not(.empty)").forEach((cell) => {
    cell.addEventListener("click", () => {
      calendarSelectedDateStr = cell.dataset.date;
      document.getElementById("event-form").classList.remove("open");
      renderCalendarGrid();
      renderCalendarDayDetail();
    });
  });
}

function renderCalendarDayDetail() {
  if (!calendarSelectedDateStr) return;
  const [y, m, d] = calendarSelectedDateStr.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  document.getElementById("calendar-selected-date-label").textContent = label;

  const dayEvents = calendarEventsCache.filter((e) => e.event_date === calendarSelectedDateStr);
  const list = document.getElementById("calendar-events-list");
  if (dayEvents.length === 0) {
    list.innerHTML = `<p class="chart-empty">No events on this day.</p>`;
    return;
  }
  list.innerHTML = dayEvents
    .map(
      (e) => `
      <div class="calendar-event-row">
        <div class="calendar-event-info">
          <p class="calendar-event-title">${e.title}</p>
          ${e.notes ? `<p class="calendar-event-notes">${e.notes}</p>` : ""}
          <p class="calendar-event-meta">Added by ${e.author_name || "a roommate"}</p>
        </div>
        <button class="calendar-event-delete" data-event-id="${e.id}" title="Remove">&times;</button>
      </div>
    `
    )
    .join("");

  list.querySelectorAll(".calendar-event-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/room-events/${btn.dataset.eventId}`, { method: "DELETE" });
      await loadCalendarMonth();
    });
  });
}

async function handleAddEvent() {
  const title = document.getElementById("event-title").value.trim();
  const notes = document.getElementById("event-notes").value.trim();
  if (!title) return alert("Give the event a title");
  if (!calendarSelectedDateStr) return alert("Pick a day on the calendar first");

  await api("/room-events", {
    method: "POST",
    body: { title, eventDate: calendarSelectedDateStr, notes },
  });

  document.getElementById("event-title").value = "";
  document.getElementById("event-notes").value = "";
  document.getElementById("event-form").classList.remove("open");
  await loadCalendarMonth();
}

window.initHivePage = initHivePage;
