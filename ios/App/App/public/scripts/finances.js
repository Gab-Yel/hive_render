// scripts/finances.js
// -----------------------------------------------------------------------------
// Finance tab. Key changes from the prototype:
// - "You Owe" summary card removed from Overview.
// - Other Expenses tab no longer shows a per-person owed amount — just the
//   total and a Settled/Unsettled toggle.
// - Bills tab now has a real "Mark Paid" button per bill.
// - Both charts (Overview, Bills) use the new animated line chart.
// -----------------------------------------------------------------------------

function wireTabs(rootSelector) {
  const root = document.querySelector(rootSelector);
  const tabButtons = root.querySelectorAll(".tab-btn");
  const panels = root.parentElement.querySelectorAll(".tab-panel");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
    });
  });
}

function toggleComposer(triggerId, cardId, closeId) {
  const trigger = document.getElementById(triggerId);
  const card = document.getElementById(cardId);
  if (!trigger || !card) return;
  trigger.addEventListener("click", () => card.classList.toggle("open"));
  const closeBtn = document.getElementById(closeId);
  if (closeBtn) closeBtn.addEventListener("click", () => card.classList.remove("open"));
}

async function initFinancesPage() {
  wireTabs("#finance-tabs");

  await Promise.all([loadOverview(), loadRent(), loadBills(), loadExpenses(), loadShopping(), loadStats()]);

  document.getElementById("rent-toggle-btn").addEventListener("click", handleRentToggle);

  toggleComposer("add-bill-btn", "bill-form", "close-bill-form");
  wireBillTypePicker();
  document.getElementById("submit-bill-btn").addEventListener("click", handleAddBill);

  toggleComposer("add-expense-btn", "expense-form", "close-expense-form");
  document.getElementById("submit-expense-btn").addEventListener("click", handleAddExpense);

  toggleComposer("add-item-btn", "shopping-form", "close-shopping-form");
  document.getElementById("submit-shopping-btn").addEventListener("click", handleAddShoppingItem);
}

// ---- Overview -----------------------------------------------------------
async function loadOverview() {
  try {
    const { rent, electric, water } = await api("/finances/overview");
    document.getElementById("ov-rent-amount").textContent = `₱${Number(rent.amount).toLocaleString()}`;
    const rentDueDate = rent.dueDay ? nextRentDueDate(rent.dueDay) : null;
    const rentOvStatus = deadlineStatus(rentDueDate, rent.paid);
    document.getElementById("ov-rent-sub").textContent = rentOvStatus.label;
    document.getElementById("ov-rent-sub").className = `ov-sub rent ${rentOvStatus.className}`;

    document.getElementById("ov-electric-amount").textContent = electric ? `₱${Number(electric.amount).toLocaleString()}` : "₱0.00";
    document.getElementById("ov-electric-status").textContent = electric ? (electric.paid ? "Paid" : "Unpaid") : "No bill yet";

    document.getElementById("ov-water-amount").textContent = water ? `₱${Number(water.amount).toLocaleString()}` : "₱0.00";
    document.getElementById("ov-water-status").textContent = water ? (water.paid ? "Paid" : "Unpaid") : "No bill yet";
  } catch (_) {}

  try {
    const { chart } = await api("/finances/chart");
    renderLineChart(document.getElementById("overview-chart"), chart);
    renderLineChart(document.getElementById("bills-chart"), chart);
  } catch (_) {}
}

// ---- Deadline helpers (used by both Rent and Bills) ------------------------
// WHY compute this on the client instead of the server? It's just date math
// against "today" — doing it here avoids any server/device timezone
// mismatch (the badge should match what the due date looks like on THIS
// phone, "today").
function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// For a recurring day-of-month deadline (rent). Clamps to the last day of
// the month if dueDay is higher than that month has (e.g. day 31 in Feb).
function nextRentDueDate(dueDay) {
  const now = new Date();
  const day = Math.min(dueDay, daysInMonth(now.getFullYear(), now.getMonth()));
  return new Date(now.getFullYear(), now.getMonth(), day);
}

// Returns { label, className } for a badge. `dueDate` is a JS Date. Pass
// `paid = true` to short-circuit to a "Paid" state instead.
function deadlineStatus(dueDate, paid) {
  if (paid) return { label: "Paid", className: "settled" };
  if (!dueDate) return { label: "No due date set", className: "neutral" };

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDue = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const diffDays = Math.round((startOfDue - startOfToday) / 86400000);

  if (diffDays < 0) return { label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"}`, className: "overdue" };
  if (diffDays === 0) return { label: "Due today", className: "due-today" };
  return { label: `Due in ${diffDays} day${diffDays === 1 ? "" : "s"}`, className: "upcoming" };
}

function deadlineBadgeHTML(status) {
  return `<span class="deadline-badge ${status.className}">${status.label}</span>`;
}

// ---- Rent due-day setting ---------------------------------------------------
// WHY not window.prompt()? It's unreliable inside Capacitor's Android
// WebView — some Android/WebView versions silently fail to show it at all,
// which is the likely cause of "an error when I input the deadline of
// rent." A real in-app modal (styled like the rest of the app, and the
// same modal pattern Settings already uses) works everywhere reliably.
let _currentRentDueDay = null;

function openRentDueDayModal(currentDueDay) {
  _currentRentDueDay = currentDueDay;
  const modal = document.getElementById("rent-due-day-modal");
  const input = document.getElementById("rent-due-day-input");
  const errorEl = document.getElementById("rent-due-day-error");
  input.value = currentDueDay || "";
  errorEl.textContent = "";
  modal.classList.add("open");
  input.focus();
}

function closeRentDueDayModal() {
  document.getElementById("rent-due-day-modal").classList.remove("open");
}

function wireRentDueDayModal() {
  document.getElementById("close-rent-due-day").onclick = closeRentDueDayModal;
  document.getElementById("save-rent-due-day").onclick = async () => {
    const input = document.getElementById("rent-due-day-input");
    const errorEl = document.getElementById("rent-due-day-error");
    const btn = document.getElementById("save-rent-due-day");
    const raw = input.value.trim();
    const dueDay = raw === "" ? null : parseInt(raw, 10);

    if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      errorEl.textContent = "Enter a whole number from 1 to 31.";
      return;
    }
    errorEl.textContent = "";
    setBtnLoading(btn, true);
    try {
      await api("/rooms/rent-due-day", { method: "PATCH", body: { dueDay } });
      closeRentDueDayModal();
      await loadRent();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      setBtnLoading(btn, false);
    }
  };
  document.getElementById("clear-rent-due-day").onclick = async () => {
    const btn = document.getElementById("clear-rent-due-day");
    setBtnLoading(btn, true);
    try {
      await api("/rooms/rent-due-day", { method: "PATCH", body: { dueDay: null } });
      closeRentDueDayModal();
      await loadRent();
    } catch (err) {
      document.getElementById("rent-due-day-error").textContent = err.message;
    } finally {
      setBtnLoading(btn, false);
    }
  };
}

async function loadRent() {
  const { rentAmount, rentDueDay, paidThisMonth, history } = await api("/finances/rent");
  document.getElementById("rent-amount").textContent = `₱${Number(rentAmount).toLocaleString()}`;

  const card = document.getElementById("rent-status-card");
  const statusText = document.getElementById("rent-status-text");
  const toggleBtn = document.getElementById("rent-toggle-btn");

  card.classList.toggle("paid", paidThisMonth);
  card.classList.toggle("unpaid", !paidThisMonth);
  statusText.textContent = paidThisMonth ? "Paid" : "Unpaid";
  toggleBtn.dataset.paid = String(paidThisMonth);
  toggleBtn.textContent = paidThisMonth ? "Mark as Unpaid" : "Mark as Paid";

  const dueDate = rentDueDay ? nextRentDueDate(rentDueDay) : null;
  const status = deadlineStatus(dueDate, paidThisMonth);
  const deadlineRow = document.getElementById("rent-deadline-row");
  deadlineRow.innerHTML = `
    <span>Deadline</span>
    <span class="value">
      ${deadlineBadgeHTML(status)}
      <button class="deadline-edit-btn" id="edit-rent-due-day">${rentDueDay ? "Change" : "Set"}</button>
    </span>
  `;
  document.getElementById("edit-rent-due-day").onclick = () => openRentDueDayModal(rentDueDay);

  const list = document.getElementById("rent-history-list");
  if (history.length === 0) {
    list.innerHTML = `<p class="chart-empty">No payments recorded yet.</p>`;
  } else {
    list.innerHTML = history
      .map(
        (h) => `
        <div class="history-row">
          <div class="history-left">
            <span class="history-check"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12.5 9 17l11-11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span>${h.month}</span>
          </div>
          <div class="history-right"><span class="history-amount">₱${Number(h.amount).toLocaleString()}</span></div>
        </div>`
      )
      .join("");
  }
}

async function handleRentToggle() {
  await api("/finances/rent/pay", { method: "POST" });
  await loadRent();
  await loadOverview();
}

// ---- Bills ------------------------------------------------------------------
let pendingBillType = "electric";
function wireBillTypePicker() {
  document.querySelectorAll("[data-bill-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-bill-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      pendingBillType = btn.dataset.billType;
    });
  });
}

async function loadBills() {
  const { bills } = await api("/finances/bills");
  const list = document.getElementById("bill-list");

  if (bills.length === 0) {
    list.innerHTML = `<p class="chart-empty">No bills added yet.</p>`;
    return;
  }

  list.innerHTML = bills
    .map((b) => {
      const icon =
        b.type === "electric"
          ? `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c3.2 4 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.8-7 6-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
      const label = b.type === "electric" ? "Electric Bill" : "Water Bill";
      const dueDate = b.due_date ? new Date(b.due_date + "T00:00:00") : null;
      const status = deadlineStatus(dueDate, b.paid);
      const dueDateLabel = dueDate
        ? dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : null;
      return `
        <div class="bill-row">
          <span class="bill-icon ${b.type}">${icon}</span>
          <div class="bill-info">
            <p class="bill-name">${label}</p>
            <p class="bill-meta">${dueDateLabel ? `Due ${dueDateLabel}` : "No due date set"} ${deadlineBadgeHTML(status)}</p>
          </div>
          <div class="bill-side">
            <p class="bill-amount">₱${Number(b.amount).toLocaleString()}</p>
            <button class="bill-pay-btn ${b.paid ? "paid" : ""}" data-bill-id="${b.id}">
              ${b.paid ? "Paid ✓" : "Mark Paid"}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".bill-pay-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/finances/bills/${btn.dataset.billId}/pay`, { method: "PATCH" });
      await loadBills();
      await loadOverview();
    });
  });
}

async function handleAddBill() {
  const amount = document.getElementById("bill-amount").value;
  const dueDate = document.getElementById("bill-due-date").value;
  if (!amount) return alert("Enter an amount");

  await api("/finances/bills", { method: "POST", body: { type: pendingBillType, amount, dueDate } });
  document.getElementById("bill-amount").value = "";
  document.getElementById("bill-due-date").value = "";
  document.getElementById("bill-form").classList.remove("open");
  await loadBills();
  await loadOverview();
}

// ---- Other expenses (no "you owe" math — just settled/unsettled) ------------
async function loadExpenses() {
  const { expenses } = await api("/finances/expenses");
  const list = document.getElementById("expense-list");
  const unsettledCount = expenses.filter((e) => !e.settled).length;
  document.getElementById("expense-summary").textContent = `${expenses.length} expense${expenses.length === 1 ? "" : "s"} · ${unsettledCount} unsettled`;

  if (expenses.length === 0) {
    list.innerHTML = `<p class="chart-empty">No shared expenses yet.</p>`;
    return;
  }

  list.innerHTML = expenses
    .map(
      (e) => `
      <div class="expense-row ${e.settled ? "settled" : ""}">
        <span class="expense-icon ${e.settled ? "settled" : "unsettled"}">
          ${e.settled
            ? `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12.5 9 17l11-11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.6"/></svg>`}
        </span>
        <div class="expense-info">
          <p class="expense-name">${e.name}${e.visible === false ? ` <span class="private-tag">Only you</span>` : ""}</p>
          <p class="expense-meta">By ${e.added_by} · ₱${Number(e.amount).toLocaleString()} total</p>
        </div>
        <div class="expense-side">
          <button class="settle-btn ${e.settled ? "settled" : ""}" data-expense-id="${e.id}">
            ${e.settled ? "Settled ✓" : "Mark Settled"}
          </button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll(".settle-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/finances/expenses/${btn.dataset.expenseId}/settle`, { method: "PATCH" });
      await loadExpenses();
    });
  });
}

async function handleAddExpense() {
  const name = document.getElementById("expense-name").value.trim();
  const amount = document.getElementById("expense-amount").value;
  const visible = document.getElementById("expense-visible").checked;
  if (!name || !amount) return alert("Fill in both fields");

  await api("/finances/expenses", { method: "POST", body: { name, amount, visible } });
  document.getElementById("expense-name").value = "";
  document.getElementById("expense-amount").value = "";
  document.getElementById("expense-visible").checked = true;
  document.getElementById("expense-form").classList.remove("open");
  await loadExpenses();
}

// ---- Shopping list -----------------------------------------------------------
async function loadShopping() {
  const { items } = await api("/finances/shopping");
  const list = document.getElementById("shopping-list");
  const doneCount = items.filter((i) => i.done).length;
  document.getElementById("shopping-summary").textContent = `${items.length - doneCount} items needed`;

  if (items.length === 0) {
    list.innerHTML = `<p class="chart-empty">Nothing on the list yet.</p>`;
    return;
  }

  list.innerHTML = items
    .map(
      (item) => `
      <button class="shop-row ${item.done ? "done" : ""}" data-item-id="${item.id}" data-done="${item.done ? "true" : "false"}">
        <span class="shop-check ${item.done ? "checked" : ""}">
          ${item.done ? `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12.5 9 17l11-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}
        </span>
        <div class="shop-info">
          <p class="shop-name">${item.name}${item.visible === false ? ` <span class="private-tag">Only you</span>` : ""}</p>
          <p class="shop-meta">Added by ${item.added_by}</p>
        </div>
      </button>`
    )
    .join("");

  list.querySelectorAll(".shop-row").forEach((row) => {
    row.addEventListener("click", async () => {
      await api(`/finances/shopping/${row.dataset.itemId}/toggle`, { method: "PATCH" });
      await loadShopping();
    });
  });
}

async function handleAddShoppingItem() {
  const name = document.getElementById("shopping-name").value.trim();
  const visible = document.getElementById("shopping-visible").checked;
  if (!name) return;
  await api("/finances/shopping", { method: "POST", body: { name, visible } });
  document.getElementById("shopping-name").value = "";
  document.getElementById("shopping-visible").checked = true;
  document.getElementById("shopping-form").classList.remove("open");
  await loadShopping();
}

// ---- Statistics -------------------------------------------------------------
async function loadStats() {
  try {
    const { thisMonth, percentChange, byCategory, averages } = await api("/finances/stats");

    document.getElementById("stats-total-amount").textContent = `₱${Number(thisMonth.total).toLocaleString()}`;

    const changeEl = document.getElementById("stats-total-change");
    if (percentChange === null) {
      changeEl.textContent = "No spending recorded last month to compare";
      changeEl.className = "stats-total-change flat";
    } else if (percentChange === 0) {
      changeEl.textContent = "Same as last month";
      changeEl.className = "stats-total-change flat";
    } else {
      const up = percentChange > 0;
      changeEl.textContent = `${up ? "↑" : "↓"} ${Math.abs(percentChange)}% vs last month`;
      // "up" in spending is the bad direction here, hence up->rent(red), down->status-home(green) —
      // the opposite mapping from something like a savings tracker.
      changeEl.className = `stats-total-change ${up ? "up" : "down"}`;
    }

    const categoryClass = { Rent: "rent", Electric: "electric", Water: "water", Other: "other" };
    document.getElementById("stats-category-breakdown").innerHTML = byCategory
      .map(
        (c) => `
        <div class="stats-category-row">
          <span class="stats-category-label">${c.label}</span>
          <div class="stats-category-bar-track">
            <div class="stats-category-bar-fill ${categoryClass[c.label] || "other"}" style="width:${c.pct}%;"></div>
          </div>
          <span class="stats-category-amount">₱${Number(c.amount).toLocaleString()}</span>
        </div>
      `
      )
      .join("");

    document.getElementById("stats-averages").innerHTML = `
      <div class="stats-averages-grid">
        <div class="stats-average-item">
          <p class="stats-average-value">₱${Number(averages.electric).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p class="stats-average-label">Avg. Electric / month</p>
        </div>
        <div class="stats-average-item">
          <p class="stats-average-value">₱${Number(averages.water).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p class="stats-average-label">Avg. Water / month</p>
        </div>
      </div>
    `;

    const insightEl = document.getElementById("stats-insight-text");
    if (percentChange !== null && percentChange > 15) {
      insightEl.innerHTML = `<strong>Heads up — </strong>Total spending is up ${percentChange}% from last month. Check the breakdown above for what's driving it.`;
    } else if (percentChange !== null && percentChange < -15) {
      insightEl.innerHTML = `<strong>Nice — </strong>Total spending is down ${Math.abs(percentChange)}% from last month. Keep it up!`;
    } else {
      const biggestCategory = [...byCategory].sort((a, b) => b.amount - a.amount)[0];
      if (biggestCategory && biggestCategory.amount > 0) {
        insightEl.innerHTML = `<strong>Tip — </strong>${biggestCategory.label} is the biggest chunk of spending this month (${biggestCategory.pct}% of the total).`;
      } else {
        insightEl.innerHTML = `<strong>Tip — </strong>Spending looks steady this month. Check back after adding more bills or expenses for deeper insights.`;
      }
    }
  } catch (_) {
    document.getElementById("stats-insight-text").textContent = "Couldn't load statistics.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireRentDueDayModal();
});

window.initFinancesPage = initFinancesPage;
