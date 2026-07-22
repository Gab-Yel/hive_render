// routes/personal.js
// -----------------------------------------------------------------------------
// The "Personal" page: an individual expense journal, a monthly allowance
// (with an over-budget warning), and simple savings/income/debt lists —
// plus a stats endpoint that turns all of that into the numbers the person
// actually wants to see (average daily spend, biggest category, savings
// rate, an overall financial health score).
//
// WHY its own file and not folded into finances.js? Everything in
// finances.js is scoped to a room (shared rent/bills/expenses). This is
// scoped to a single user_id and doesn't care whether they're in a room at
// all — different data model, so it gets its own router mounted at
// /api/personal (see index.js).
// -----------------------------------------------------------------------------
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");

const router = express.Router();

const CATEGORIES = {
  fixed: "Fixed",
  food: "Food",
  transport: "Transport",
  shopping: "Shopping",
  entertainment: "Entertainment",
  other: "Other",
};
function categoryLabel(key) {
  return CATEGORIES[key] || "Other";
}

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const toISO = (dt) => dt.toISOString().slice(0, 10);
  return { start: toISO(start), end: toISO(end), daysInMonth: end.getDate() };
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Journal ------------------------------------------------------------------
// GET /journal?range=today|month  (default month)
router.get(
  "/journal",
  requireAuth,
  asyncRoute(async (req, res) => {
    const range = req.query.range === "today" ? "today" : "month";
    const { start, end } = monthBounds();
    const rows =
      range === "today"
        ? await db
            .prepare("SELECT * FROM personal_expenses WHERE user_id = ? AND spent_on = ? ORDER BY created_at DESC")
            .all(req.user.id, todayISO())
        : await db
            .prepare("SELECT * FROM personal_expenses WHERE user_id = ? AND spent_on BETWEEN ? AND ? ORDER BY spent_on DESC, created_at DESC")
            .all(req.user.id, start, end);

    const entries = rows.map((r) => ({ ...r, amount: Number(r.amount), categoryLabel: categoryLabel(r.category) }));
    const total = entries.reduce((s, e) => s + e.amount, 0);
    res.json({ entries, total: Math.round(total * 100) / 100 });
  })
);

router.post(
  "/journal",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { name, amount, category, spentOn } = req.body || {};
    if (!name || !amount) return res.status(400).json({ error: "name and amount are required" });
    const cat = CATEGORIES[category] ? category : Object.keys(CATEGORIES).includes(category) ? category : "other";

    const info = await db
      .prepare("INSERT INTO personal_expenses (user_id, name, amount, category, spent_on) VALUES (?, ?, ?, ?, ?)")
      .run(req.user.id, name, Number(amount), cat, spentOn || todayISO());

    const entry = await db.prepare("SELECT * FROM personal_expenses WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ entry: { ...entry, amount: Number(entry.amount), categoryLabel: categoryLabel(entry.category) } });
  })
);

router.delete(
  "/journal/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    await db.prepare("DELETE FROM personal_expenses WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ deleted: true });
  })
);

// ---- Allowance ------------------------------------------------------------------
router.get(
  "/allowance",
  requireAuth,
  asyncRoute(async (req, res) => {
    const row = await db.prepare("SELECT monthly_allowance FROM personal_settings WHERE user_id = ?").get(req.user.id);
    res.json({ amount: row ? Number(row.monthly_allowance) : 0 });
  })
);

router.put(
  "/allowance",
  requireAuth,
  asyncRoute(async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "amount must be a non-negative number" });
    await db
      .prepare(
        `INSERT INTO personal_settings (user_id, monthly_allowance, updated_at)
         VALUES (?, ?, now())
         ON CONFLICT (user_id) DO UPDATE SET monthly_allowance = EXCLUDED.monthly_allowance, updated_at = now()`
      )
      .run(req.user.id, amount);
    res.json({ amount });
  })
);

// ---- Overview (today/this-month spend vs. allowance, with a warning) ----------
router.get(
  "/overview",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { start, end, daysInMonth } = monthBounds();
    const allowanceRow = await db.prepare("SELECT monthly_allowance FROM personal_settings WHERE user_id = ?").get(req.user.id);
    const allowance = allowanceRow ? Number(allowanceRow.monthly_allowance) : 0;

    const todayRows = await db
      .prepare("SELECT amount FROM personal_expenses WHERE user_id = ? AND spent_on = ?")
      .all(req.user.id, todayISO());
    const monthRows = await db
      .prepare("SELECT amount FROM personal_expenses WHERE user_id = ? AND spent_on BETWEEN ? AND ?")
      .all(req.user.id, start, end);

    const spentToday = todayRows.reduce((s, r) => s + Number(r.amount), 0);
    const spentThisMonth = monthRows.reduce((s, r) => s + Number(r.amount), 0);
    const dailyBudget = allowance > 0 ? allowance / daysInMonth : null;
    const remainingMonth = allowance > 0 ? Math.round((allowance - spentThisMonth) * 100) / 100 : null;

    // Warn once spending crosses 90% of the monthly limit, and flag it as
    // urgent once it's actually over. No allowance set -> nothing to warn
    // against yet.
    let warning = null;
    if (allowance > 0) {
      const usedPct = spentThisMonth / allowance;
      if (usedPct >= 1) {
        warning = { level: "over", message: `You've gone ₱${Math.abs(remainingMonth).toLocaleString()} over your ₱${allowance.toLocaleString()} monthly limit.` };
      } else if (usedPct >= 0.9) {
        warning = { level: "near", message: `You've used ${Math.round(usedPct * 100)}% of your monthly allowance — ₱${remainingMonth.toLocaleString()} left.` };
      }
    }

    res.json({
      allowance,
      spentToday: Math.round(spentToday * 100) / 100,
      spentThisMonth: Math.round(spentThisMonth * 100) / 100,
      dailyBudget: dailyBudget !== null ? Math.round(dailyBudget * 100) / 100 : null,
      remainingMonth,
      warning,
    });
  })
);

// ---- Savings --------------------------------------------------------------------
router.get(
  "/savings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const rows = await db.prepare("SELECT * FROM personal_savings WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
    const items = rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    res.json({ items, total: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100 });
  })
);
router.post(
  "/savings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { name, amount } = req.body || {};
    if (!name || !amount) return res.status(400).json({ error: "name and amount are required" });
    const info = await db.prepare("INSERT INTO personal_savings (user_id, name, amount) VALUES (?, ?, ?)").run(req.user.id, name, Number(amount));
    res.status(201).json({ item: await db.prepare("SELECT * FROM personal_savings WHERE id = ?").get(info.lastInsertRowid) });
  })
);
router.delete(
  "/savings/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    await db.prepare("DELETE FROM personal_savings WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ deleted: true });
  })
);

// ---- Income -----------------------------------------------------------------
router.get(
  "/income",
  requireAuth,
  asyncRoute(async (req, res) => {
    const rows = await db.prepare("SELECT * FROM personal_income WHERE user_id = ? ORDER BY received_on DESC, created_at DESC").all(req.user.id);
    const items = rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    res.json({ items, total: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100 });
  })
);
router.post(
  "/income",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { name, amount, receivedOn } = req.body || {};
    if (!name || !amount) return res.status(400).json({ error: "name and amount are required" });
    const info = await db
      .prepare("INSERT INTO personal_income (user_id, name, amount, received_on) VALUES (?, ?, ?, ?)")
      .run(req.user.id, name, Number(amount), receivedOn || todayISO());
    res.status(201).json({ item: await db.prepare("SELECT * FROM personal_income WHERE id = ?").get(info.lastInsertRowid) });
  })
);
router.delete(
  "/income/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    await db.prepare("DELETE FROM personal_income WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ deleted: true });
  })
);

// ---- Debts --------------------------------------------------------------------
router.get(
  "/debts",
  requireAuth,
  asyncRoute(async (req, res) => {
    const rows = await db.prepare("SELECT * FROM personal_debts WHERE user_id = ? ORDER BY paid ASC, created_at DESC").all(req.user.id);
    const items = rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    const totalUnpaid = items.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0);
    res.json({ items, totalUnpaid: Math.round(totalUnpaid * 100) / 100 });
  })
);
router.post(
  "/debts",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { name, amount } = req.body || {};
    if (!name || !amount) return res.status(400).json({ error: "name and amount are required" });
    const info = await db.prepare("INSERT INTO personal_debts (user_id, name, amount) VALUES (?, ?, ?)").run(req.user.id, name, Number(amount));
    res.status(201).json({ item: await db.prepare("SELECT * FROM personal_debts WHERE id = ?").get(info.lastInsertRowid) });
  })
);
router.patch(
  "/debts/:id/toggle",
  requireAuth,
  asyncRoute(async (req, res) => {
    const debt = await db.prepare("SELECT * FROM personal_debts WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    await db.prepare("UPDATE personal_debts SET paid = NOT paid WHERE id = ?").run(debt.id);
    const updated = await db.prepare("SELECT * FROM personal_debts WHERE id = ?").get(debt.id);
    res.json({ paid: updated.paid });
  })
);
router.delete(
  "/debts/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    await db.prepare("DELETE FROM personal_debts WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ deleted: true });
  })
);

// ---- Statistics -----------------------------------------------------------------
// The numbers that actually matter day to day:
//  - Average daily spending: this month's spend / days elapsed so far.
//  - Ranked largest category: where the money's actually going.
//  - Savings rate: (income - expenses) / income for the month, falling back
//    to (allowance - expenses) / allowance if no income has been logged.
//  - Financial health score: a simple 0-100 blend of budget discipline,
//    savings rate, and outstanding debt load. It's intentionally simple
//    (three components, evenly-ish weighted) rather than a "real" credit
//    score — the point is a quick gut-check, not a precise rating.
router.get(
  "/stats",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { start, end, daysInMonth } = monthBounds();
    const now = new Date();
    const daysElapsed = Math.min(now.getDate(), daysInMonth);

    const allowanceRow = await db.prepare("SELECT monthly_allowance FROM personal_settings WHERE user_id = ?").get(req.user.id);
    const allowance = allowanceRow ? Number(allowanceRow.monthly_allowance) : 0;

    const expenseRows = await db
      .prepare("SELECT category, amount FROM personal_expenses WHERE user_id = ? AND spent_on BETWEEN ? AND ?")
      .all(req.user.id, start, end);
    const spentThisMonth = expenseRows.reduce((s, r) => s + Number(r.amount), 0);
    const avgDailySpending = daysElapsed > 0 ? spentThisMonth / daysElapsed : 0;

    const byCategoryMap = {};
    for (const row of expenseRows) {
      byCategoryMap[row.category] = (byCategoryMap[row.category] || 0) + Number(row.amount);
    }
    const rankedCategories = Object.entries(byCategoryMap)
      .map(([category, amount]) => ({
        category,
        label: categoryLabel(category),
        amount: Math.round(amount * 100) / 100,
        pct: spentThisMonth > 0 ? Math.round((amount / spentThisMonth) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const incomeRows = await db
      .prepare("SELECT amount FROM personal_income WHERE user_id = ? AND received_on BETWEEN ? AND ?")
      .all(req.user.id, start, end);
    const monthlyIncome = incomeRows.reduce((s, r) => s + Number(r.amount), 0);

    const savingsRows = await db.prepare("SELECT amount FROM personal_savings WHERE user_id = ?").all(req.user.id);
    const totalSavings = savingsRows.reduce((s, r) => s + Number(r.amount), 0);

    const debtRows = await db.prepare("SELECT amount, paid FROM personal_debts WHERE user_id = ?").all(req.user.id);
    const totalUnpaidDebt = debtRows.filter((r) => !r.paid).reduce((s, r) => s + Number(r.amount), 0);

    // Savings rate: prefer real income data; fall back to allowance as a
    // stand-in for "money coming in" if no income has been logged yet.
    const incomeBasis = monthlyIncome > 0 ? monthlyIncome : allowance;
    const savingsRate = incomeBasis > 0 ? Math.round(((incomeBasis - spentThisMonth) / incomeBasis) * 1000) / 10 : null;

    // ---- Financial health score (0-100), three components: -------------------
    // Budget discipline (0-40): how much of the allowance is left unspent.
    const budgetComponent =
      allowance > 0 ? Math.max(0, Math.min(40, 40 - (spentThisMonth / allowance) * 40)) : 20; // neutral if no limit set

    // Savings rate (0-30): scaled directly off the savings rate percentage.
    const savingsComponent = savingsRate !== null ? Math.max(0, Math.min(30, savingsRate * 0.3)) : 15; // neutral if unknown

    // Debt load (0-30): unpaid debt relative to whatever income/allowance
    // basis we have; no debts logged at all scores full marks.
    let debtComponent = 30;
    if (totalUnpaidDebt > 0) {
      const basis = incomeBasis > 0 ? incomeBasis : Math.max(spentThisMonth, 1);
      const ratio = totalUnpaidDebt / basis;
      debtComponent = Math.max(0, Math.min(30, 30 - ratio * 30));
    }

    const financialHealthScore = Math.round(budgetComponent + savingsComponent + debtComponent);
    const scoreLabel = financialHealthScore >= 75 ? "Healthy" : financialHealthScore >= 50 ? "Okay" : "Needs attention";

    res.json({
      avgDailySpending: Math.round(avgDailySpending * 100) / 100,
      spentThisMonth: Math.round(spentThisMonth * 100) / 100,
      rankedCategories,
      savingsRate,
      totals: {
        savings: Math.round(totalSavings * 100) / 100,
        income: Math.round(monthlyIncome * 100) / 100,
        unpaidDebt: Math.round(totalUnpaidDebt * 100) / 100,
      },
      financialHealthScore,
      scoreLabel,
    });
  })
);

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
