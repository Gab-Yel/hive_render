// scripts/personal.js
// -----------------------------------------------------------------------------
// The "Personal" page: a per-user spending journal, monthly allowance/limit
// with a warning, savings/income/debt lists, and a stats tab. Scoped to the
// logged-in user only — nothing here is shared with roommates.
//
// OFFLINE: this page is the one part of Hive designed to keep working with
// no connection (see scripts/offline.js for why just this page). Every read
// goes through Offline.get() (falls back to the last-synced copy), and
// every write goes through Offline.write() (queues itself if there's no
// connection). Things added/deleted while offline are kept in a small
// "pending" localStorage list purely so the UI can show them immediately
// with a "Pending sync" tag — once back online, scripts/offline.js replays
// the real queue against the server and this page does a full reload from
// scratch so nothing gets out of sync.
//
// Reuses wireTabs()/toggleComposer() from finances.js (loaded earlier in
// index.html) instead of redefining the same tab/composer wiring twice.
// -----------------------------------------------------------------------------

const CATEGORY_LABELS = {
  fixed: "Fixed",
  food: "Food",
  transport: "Transport",
  shopping: "Shopping",
  entertainment: "Entertainment",
  other: "Other",
};

function money(n) {
  return `₱${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ---- Pending (offline, unsynced) items ---------------------------------------
// Purely a UI convenience layered on top of Offline's write queue: lets
// just-added/deleted items show up immediately instead of the list looking
// like nothing happened until the connection comes back.
function pendingAddsKey(type) {
  return `hive_personal_pending_adds:${type}`;
}
function pendingDeletesKey(type) {
  return `hive_personal_pending_deletes:${type}`;
}
function getPendingAdds(type) {
  const raw = localStorage.getItem(pendingAddsKey(type));
  return raw ? JSON.parse(raw) : [];
}
function addPendingAdd(type, payload) {
  const list = getPendingAdds(type);
  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  list.push({ tempId, payload });
  localStorage.setItem(pendingAddsKey(type), JSON.stringify(list));
  return tempId;
}
function removePendingAdd(type, tempId) {
  const list = getPendingAdds(type).filter((p) => p.tempId !== tempId);
  localStorage.setItem(pendingAddsKey(type), JSON.stringify(list));
}
function getPendingDeletes(type) {
  const raw = localStorage.getItem(pendingDeletesKey(type));
  return raw ? JSON.parse(raw) : [];
}
function addPendingDelete(type, id) {
  const list = getPendingDeletes(type);
  list.push(id);
  localStorage.setItem(pendingDeletesKey(type), JSON.stringify(list));
}
function clearPendingFor(type) {
  localStorage.removeItem(pendingAddsKey(type));
  localStorage.removeItem(pendingDeletesKey(type));
}
const PENDING_TAG = `<span class="pending-sync-tag">Pending sync</span>`;

async function initPersonalPage() {
  wireTabs("#personal-tabs");

  document.getElementById("journal-date").value = new Date().toISOString().slice(0, 10);

  await loadAllPersonalData();

  wireShortcutButtons();
  toggleComposer("add-journal-btn", "journal-form", "close-journal-form");
  document.getElementById("submit-journal-btn").addEventListener("click", handleAddJournalEntry);

  document.getElementById("close-quick-expense").addEventListener("click", () => {
    document.getElementById("quick-expense-form").classList.remove("open");
  });
  document.getElementById("submit-quick-expense").addEventListener("click", handleSubmitQuickExpense);

  document.getElementById("save-allowance-btn").addEventListener("click", handleSaveAllowance);

  toggleComposer("add-income-btn", "income-form", "close-income-form");
  document.getElementById("submit-income-btn").addEventListener("click", handleAddIncome);

  toggleComposer("add-savings-btn", "savings-form", "close-savings-form");
  document.getElementById("submit-savings-btn").addEventListener("click", handleAddSavings);

  toggleComposer("add-debt-btn", "debt-form", "close-debt-form");
  document.getElementById("submit-debt-btn").addEventListener("click", handleAddDebt);

  // Once we're actually back online, scripts/offline.js has already
  // replayed every queued write against the server — clear our local
  // "pending" markers and pull a clean copy of everything so nothing's
  // stale or duplicated.
  document.removeEventListener("hive:back-online", handleBackOnlineForPersonal);
  document.addEventListener("hive:back-online", handleBackOnlineForPersonal);
}

async function handleBackOnlineForPersonal() {
  if (!document.getElementById("personal-page")) return; // not the active page right now
  ["journal", "income", "savings", "debts"].forEach(clearPendingFor);
  await loadAllPersonalData();
}

async function loadAllPersonalData() {
  await Promise.all([loadJournalOverview(), loadJournal(), loadAllowance(), loadIncome(), loadSavings(), loadDebts(), loadPersonalStats()]);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Today/month overview + allowance warning banner -------------------------
async function loadJournalOverview() {
  try {
    const { data, fromCache } = await Offline.get("/personal/overview");
    let { spentToday, dailyBudget, spentThisMonth, remainingMonth, allowance, warning } = data;

    // Layer in anything added/deleted while offline so the totals feel
    // live, not frozen at the last successful sync.
    if (fromCache) {
      const pendingAdds = getPendingAdds("journal");
      const today = todayISO();
      const pendingTodaySum = pendingAdds.filter((p) => (p.payload.spentOn || today) === today).reduce((s, p) => s + Number(p.payload.amount), 0);
      const pendingMonthSum = pendingAdds.reduce((s, p) => s + Number(p.payload.amount), 0);
      spentToday += pendingTodaySum;
      spentThisMonth += pendingMonthSum;
      if (allowance > 0) remainingMonth = Math.round((allowance - spentThisMonth) * 100) / 100;
    }

    document.getElementById("pj-today-amount").textContent = money(spentToday);
    document.getElementById("pj-today-budget").textContent = dailyBudget !== null ? `Daily budget: ${money(dailyBudget)}` : "No daily budget set";

    document.getElementById("pj-month-amount").textContent = money(spentThisMonth);
    document.getElementById("pj-month-remaining").textContent =
      remainingMonth !== null ? (remainingMonth >= 0 ? `${money(remainingMonth)} left this month` : `${money(Math.abs(remainingMonth))} over limit`) : "No limit set";

    const banner = document.getElementById("pj-warning-banner");
    if (warning) {
      banner.style.display = "flex";
      banner.classList.toggle("danger", warning.level === "over");
      document.getElementById("pj-warning-text").innerHTML = `<strong>${warning.level === "over" ? "Over budget — " : "Heads up — "}</strong>${warning.message}`;
    } else {
      banner.style.display = "none";
    }
  } catch (_) {}
}

// ---- Shortcut buttons (fixed daily expenses) ---------------------------------
let pendingQuickExpense = null;

function wireShortcutButtons() {
  document.querySelectorAll(".shortcut-btn:not(.add-custom)").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingQuickExpense = { name: btn.dataset.name, category: "fixed" };
      document.getElementById("quick-expense-title").textContent = `Log: ${btn.dataset.name}`;
      document.getElementById("quick-expense-amount").value = "";
      document.getElementById("quick-expense-form").classList.add("open");
      document.getElementById("quick-expense-amount").focus();
    });
  });
  document.getElementById("add-shortcut-expense").addEventListener("click", () => {
    document.getElementById("journal-form").classList.add("open");
  });
}

async function handleSubmitQuickExpense() {
  const amount = document.getElementById("quick-expense-amount").value;
  if (!pendingQuickExpense || !amount) return alert("Enter an amount");
  await submitJournalEntry({ ...pendingQuickExpense, amount, spentOn: todayISO() });
  document.getElementById("quick-expense-form").classList.remove("open");
}

// ---- Journal --------------------------------------------------------------------
async function loadJournal() {
  const { data } = await Offline.get("/personal/journal?range=month");
  let entries = data.entries.filter((e) => !getPendingDeletes("journal").includes(e.id));

  const pendingEntries = getPendingAdds("journal").map((p) => ({
    ...p.payload,
    id: p.tempId,
    amount: Number(p.payload.amount),
    spent_on: p.payload.spentOn || todayISO(),
    categoryLabel: CATEGORY_LABELS[p.payload.category] || "Other",
    pending: true,
  }));
  entries = [...pendingEntries, ...entries];

  const list = document.getElementById("journal-list");
  if (entries.length === 0) {
    list.innerHTML = `<p class="chart-empty">No expenses logged yet.</p>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (e) => `
      <div class="journal-row">
        <span class="journal-category-tag ${e.category}">${CATEGORY_LABELS[e.category] || "Other"}</span>
        <div class="journal-info">
          <p class="journal-name">${e.name}${e.pending ? PENDING_TAG : ""}</p>
          <p class="journal-meta">${new Date(e.spent_on + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
        </div>
        <div class="journal-side">
          <p class="journal-amount">${money(e.amount)}</p>
          <button class="journal-delete" data-id="${e.id}" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll(".journal-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (String(id).startsWith("pending-")) {
        removePendingAdd("journal", id);
      } else {
        const result = await Offline.write(`/personal/journal/${id}`, { method: "DELETE" });
        if (result === null) addPendingDelete("journal", id);
      }
      await Promise.all([loadJournalOverview(), loadJournal(), loadPersonalStats()]);
    });
  });
}

async function submitJournalEntry({ name, amount, category, spentOn }) {
  const payload = { name, amount, category, spentOn: spentOn || todayISO() };
  const result = await Offline.write("/personal/journal", { method: "POST", body: payload });
  if (result === null) addPendingAdd("journal", payload);
  await Promise.all([loadJournalOverview(), loadJournal(), loadPersonalStats()]);
}

async function handleAddJournalEntry() {
  const name = document.getElementById("journal-name").value.trim();
  const amount = document.getElementById("journal-amount").value;
  const category = document.getElementById("journal-category").value;
  const spentOn = document.getElementById("journal-date").value || todayISO();
  if (!name || !amount) return alert("Fill in both the description and amount");

  await submitJournalEntry({ name, amount, category, spentOn });
  document.getElementById("journal-name").value = "";
  document.getElementById("journal-amount").value = "";
  document.getElementById("journal-form").classList.remove("open");
}

// ---- Allowance + income -----------------------------------------------------
async function loadAllowance() {
  const { data } = await Offline.get("/personal/allowance");
  const amount = data.amount;
  document.getElementById("allowance-input").value = amount > 0 ? amount : "";
  const progress = document.getElementById("allowance-progress");
  if (amount <= 0) {
    progress.style.display = "none";
    return;
  }
  const { data: overview, fromCache } = await Offline.get("/personal/overview");
  let spentThisMonth = overview.spentThisMonth;
  if (fromCache) {
    spentThisMonth += getPendingAdds("journal").reduce((s, p) => s + Number(p.payload.amount), 0);
  }
  const pct = Math.min(100, Math.round((spentThisMonth / amount) * 100));
  progress.style.display = "block";
  const fill = document.getElementById("allowance-progress-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("danger", pct >= 100);
  fill.classList.toggle("warn", pct >= 90 && pct < 100);
  document.getElementById("allowance-progress-label").textContent = `${money(spentThisMonth)} of ${money(amount)} spent this month (${pct}%)`;
}

async function handleSaveAllowance() {
  const amount = document.getElementById("allowance-input").value;
  if (amount === "" || Number(amount) < 0) return alert("Enter a valid amount");
  await Offline.write("/personal/allowance", { method: "PUT", body: { amount } });
  await Promise.all([loadAllowance(), loadJournalOverview(), loadPersonalStats()]);
}

async function loadIncome() {
  const { data } = await Offline.get("/personal/income");
  let items = data.items.filter((i) => !getPendingDeletes("income").includes(i.id));
  const pendingItems = getPendingAdds("income").map((p) => ({ ...p.payload, id: p.tempId, amount: Number(p.payload.amount), received_on: p.payload.receivedOn || todayISO(), pending: true }));
  items = [...pendingItems, ...items];

  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  document.getElementById("income-summary").textContent = `Income · ${money(total)} this month`;
  const list = document.getElementById("income-list");
  if (items.length === 0) {
    list.innerHTML = `<p class="chart-empty">No income logged yet.</p>`;
    return;
  }
  list.innerHTML = items
    .map(
      (i) => `
      <div class="money-row income">
        <div class="money-info">
          <p class="money-name">${i.name}${i.pending ? PENDING_TAG : ""}</p>
          <p class="money-meta">${new Date(i.received_on + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
        </div>
        <div class="money-side">
          <p class="money-amount income">+${money(i.amount)}</p>
          <button class="money-delete" data-id="${i.id}" data-kind="income" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`
    )
    .join("");
  wireMoneyDeletes(list);
}

async function handleAddIncome() {
  const name = document.getElementById("income-name").value.trim();
  const amount = document.getElementById("income-amount").value;
  if (!name || !amount) return alert("Fill in both fields");
  const payload = { name, amount };
  const result = await Offline.write("/personal/income", { method: "POST", body: payload });
  if (result === null) addPendingAdd("income", payload);
  document.getElementById("income-name").value = "";
  document.getElementById("income-amount").value = "";
  document.getElementById("income-form").classList.remove("open");
  await Promise.all([loadIncome(), loadPersonalStats()]);
}

// ---- Savings ------------------------------------------------------------------
async function loadSavings() {
  const { data } = await Offline.get("/personal/savings");
  let items = data.items.filter((s) => !getPendingDeletes("savings").includes(s.id));
  const pendingItems = getPendingAdds("savings").map((p) => ({ ...p.payload, id: p.tempId, amount: Number(p.payload.amount), pending: true }));
  items = [...pendingItems, ...items];

  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  document.getElementById("savings-total").textContent = money(total);
  const list = document.getElementById("savings-list");
  if (items.length === 0) {
    list.innerHTML = `<p class="chart-empty">No savings logged yet.</p>`;
    return;
  }
  list.innerHTML = items
    .map(
      (s) => `
      <div class="money-row savings">
        <div class="money-info"><p class="money-name">${s.name}${s.pending ? PENDING_TAG : ""}</p></div>
        <div class="money-side">
          <p class="money-amount savings">${money(s.amount)}</p>
          <button class="money-delete" data-id="${s.id}" data-kind="savings" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`
    )
    .join("");
  wireMoneyDeletes(list);
}

async function handleAddSavings() {
  const name = document.getElementById("savings-name").value.trim();
  const amount = document.getElementById("savings-amount").value;
  if (!name || !amount) return alert("Fill in both fields");
  const payload = { name, amount };
  const result = await Offline.write("/personal/savings", { method: "POST", body: payload });
  if (result === null) addPendingAdd("savings", payload);
  document.getElementById("savings-name").value = "";
  document.getElementById("savings-amount").value = "";
  document.getElementById("savings-form").classList.remove("open");
  await Promise.all([loadSavings(), loadPersonalStats()]);
}

// ---- Debts --------------------------------------------------------------------
async function loadDebts() {
  const { data } = await Offline.get("/personal/debts");
  let items = data.items.filter((d) => !getPendingDeletes("debts").includes(d.id));
  const pendingItems = getPendingAdds("debts").map((p) => ({ ...p.payload, id: p.tempId, amount: Number(p.payload.amount), paid: false, pending: true }));
  items = [...pendingItems, ...items];

  const totalUnpaid = items.filter((i) => !i.paid).reduce((s, i) => s + Number(i.amount), 0);
  document.getElementById("debt-total").textContent = money(totalUnpaid);
  const list = document.getElementById("debt-list");
  if (items.length === 0) {
    list.innerHTML = `<p class="chart-empty">No debts logged yet.</p>`;
    return;
  }
  list.innerHTML = items
    .map(
      (d) => `
      <div class="money-row debt ${d.paid ? "settled" : ""}">
        <div class="money-info"><p class="money-name">${d.name}${d.paid ? ` <span class="private-tag">Paid</span>` : ""}${d.pending ? PENDING_TAG : ""}</p></div>
        <div class="money-side">
          <p class="money-amount debt">${money(d.amount)}</p>
          <button class="settle-btn ${d.paid ? "settled" : ""}" data-id="${d.id}" data-kind="debt-toggle" ${d.pending ? "disabled" : ""}>${d.paid ? "Paid ✓" : "Mark Paid"}</button>
          <button class="money-delete" data-id="${d.id}" data-kind="debt" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`
    )
    .join("");
  wireMoneyDeletes(list);
  list.querySelectorAll('[data-kind="debt-toggle"]:not([disabled])').forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Offline.write(`/personal/debts/${btn.dataset.id}/toggle`, { method: "PATCH" });
      await Promise.all([loadDebts(), loadPersonalStats()]);
    });
  });
}

async function handleAddDebt() {
  const name = document.getElementById("debt-name").value.trim();
  const amount = document.getElementById("debt-amount").value;
  if (!name || !amount) return alert("Fill in both fields");
  const payload = { name, amount };
  const result = await Offline.write("/personal/debts", { method: "POST", body: payload });
  if (result === null) addPendingAdd("debts", payload);
  document.getElementById("debt-name").value = "";
  document.getElementById("debt-amount").value = "";
  document.getElementById("debt-form").classList.remove("open");
  await Promise.all([loadDebts(), loadPersonalStats()]);
}

function wireMoneyDeletes(list) {
  list.querySelectorAll(".money-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.kind; // income | savings | debt
      const type = kind === "debt" ? "debts" : kind;
      const id = btn.dataset.id;
      if (String(id).startsWith("pending-")) {
        removePendingAdd(type, id);
      } else {
        const result = await Offline.write(`/personal/${type}/${id}`, { method: "DELETE" });
        if (result === null) addPendingDelete(type, id);
      }
      if (type === "income") await Promise.all([loadIncome(), loadPersonalStats()]);
      else if (type === "savings") await Promise.all([loadSavings(), loadPersonalStats()]);
      else await Promise.all([loadDebts(), loadPersonalStats()]);
    });
  });
}

// ---- Stats ----------------------------------------------------------------------
const CATEGORY_CLASS = { fixed: "rent", food: "electric", transport: "water", shopping: "other", entertainment: "other", other: "other" };

async function loadPersonalStats() {
  try {
    const { data, fromCache } = await Offline.get("/personal/stats");
    const { avgDailySpending, rankedCategories, savingsRate, financialHealthScore, scoreLabel } = data;

    document.getElementById("stat-avg-daily").textContent = money(avgDailySpending);
    document.getElementById("stat-savings-rate").textContent = savingsRate !== null ? `${savingsRate}%` : "—";

    document.getElementById("health-score-value").textContent = financialHealthScore;
    document.getElementById("health-score-tag").textContent = scoreLabel;
    document.getElementById("health-score-tag").className = `health-score-tag ${financialHealthScore >= 75 ? "good" : financialHealthScore >= 50 ? "ok" : "poor"}`;
    const scoreFill = document.getElementById("health-score-fill");
    scoreFill.style.width = `${financialHealthScore}%`;
    scoreFill.classList.toggle("danger", financialHealthScore < 50);
    scoreFill.classList.toggle("warn", financialHealthScore >= 50 && financialHealthScore < 75);

    const breakdown = document.getElementById("pstats-category-breakdown");
    if (rankedCategories.length === 0) {
      breakdown.innerHTML = `<p class="chart-empty">No expenses logged yet.</p>`;
    } else {
      breakdown.innerHTML = rankedCategories
        .map(
          (c, i) => `
          <div class="stats-category-row">
            <span class="stats-category-rank">#${i + 1}</span>
            <span class="stats-category-label">${c.label}</span>
            <div class="stats-category-bar-track">
              <div class="stats-category-bar-fill ${CATEGORY_CLASS[c.category] || "other"}" style="width:${c.pct}%;"></div>
            </div>
            <span class="stats-category-amount">${money(c.amount)}</span>
          </div>`
        )
        .join("");
    }

    const insightEl = document.getElementById("pstats-insight-text");
    if (rankedCategories.length === 0) {
      insightEl.textContent = "Log a few expenses to start seeing insights here.";
    } else {
      const top = rankedCategories[0];
      insightEl.innerHTML = `<strong>Tip — </strong>${top.label} is your biggest category this month at ${money(top.amount)} (${top.pct}% of total spend).${fromCache ? " (from your last sync — will update once you're back online)" : ""}`;
    }
  } catch (_) {
    document.getElementById("pstats-insight-text").textContent = "Couldn't load statistics.";
  }
}

window.initPersonalPage = initPersonalPage;
