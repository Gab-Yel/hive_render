// routes/finances.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");
const { notifyRoom } = require("../utils/notify");

const router = express.Router();

async function currentUser(req, res) {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user.room_id) {
    res.status(400).json({ error: "Join or create a room first" });
    return null;
  }
  return user;
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---- Keep chart_history in sync with the current month's bills --------------
// THE BUG THIS FIXES: chart_history was only ever seeded once (test data) and
// nothing ever wrote to it afterwards, so the "Electric & Water" line chart on
// Overview/Bills never reflected new bills or amount changes — it just showed
// whatever the seed data happened to contain, forever. Call this any time a
// bill is added or its amount could have changed, right after the write.
async function syncChartHistory(roomId) {
  const month = monthKey();
  const bills = await db.prepare("SELECT type, amount FROM bills WHERE room_id = ? AND month = ?").all(roomId, month);
  const electric = Number(bills.find((b) => b.type === "electric")?.amount || 0);
  const water = Number(bills.find((b) => b.type === "water")?.amount || 0);
  await db
    .prepare(
      `INSERT INTO chart_history (room_id, month, electric, water)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (room_id, month) DO UPDATE SET electric = EXCLUDED.electric, water = EXCLUDED.water`
    )
    .run(roomId, month, electric, water);
}

// ---- Overview -------------------------------------------------------------
router.get(
  "/overview",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);

    const paidThisMonth = await db
      .prepare("SELECT 1 FROM rent_payments WHERE room_id = ? AND user_id = ? AND month = ?")
      .get(user.room_id, user.id, monthKey());

    const bills = await db.prepare("SELECT * FROM bills WHERE room_id = ? ORDER BY created_at DESC").all(user.room_id);
    const electric = bills.find((b) => b.type === "electric");
    const water = bills.find((b) => b.type === "water");

    res.json({
      rent: { amount: room.rent, paid: !!paidThisMonth, dueDay: room.rent_due_day },
      electric: electric || null,
      water: water || null,
    });
  })
);

// ---- Chart data -------------------------------------------------------------
router.get(
  "/chart",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const rows = await db
      .prepare("SELECT month, electric, water FROM chart_history WHERE room_id = ? ORDER BY created_at ASC")
      .all(user.room_id);
    res.json({ chart: rows });
  })
);

// ---- Rent -------------------------------------------------------------------
router.get(
  "/rent",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);
    const history = await db
      .prepare("SELECT * FROM rent_payments WHERE room_id = ? AND user_id = ? ORDER BY month DESC")
      .all(user.room_id, user.id);
    const paidThisMonth = history.some((h) => h.month === monthKey());
    res.json({ rentAmount: room.rent, rentDueDay: room.rent_due_day, paidThisMonth, history });
  })
);

// POST /api/finances/rent/pay — mark current month paid (toggle)
router.post(
  "/rent/pay",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);
    const month = monthKey();

    const existing = await db
      .prepare("SELECT * FROM rent_payments WHERE room_id = ? AND user_id = ? AND month = ?")
      .get(user.room_id, user.id, month);

    if (existing) {
      await db.prepare("DELETE FROM rent_payments WHERE id = ?").run(existing.id);
      return res.json({ paid: false });
    }

    await db
      .prepare("INSERT INTO rent_payments (room_id, user_id, month, amount) VALUES (?, ?, ?, ?)")
      .run(user.room_id, user.id, month, room.rent);
    res.json({ paid: true });
  })
);

// ---- Bills (electric / water) -----------------------------------------------
router.get(
  "/bills",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const bills = await db.prepare("SELECT * FROM bills WHERE room_id = ? ORDER BY created_at DESC").all(user.room_id);
    res.json({ bills });
  })
);

router.post(
  "/bills",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { type, amount, dueDate } = req.body || {};
    if (!type || !amount) return res.status(400).json({ error: "type and amount are required" });

    const info = await db
      .prepare("INSERT INTO bills (room_id, type, month, amount, due_date) VALUES (?, ?, ?, ?, ?)")
      .run(user.room_id, type, monthKey(), Number(amount), dueDate || null);

    await syncChartHistory(user.room_id);
    await notifyRoom(user.room_id, "New bill added", `${user.name} added a ₱${Number(amount).toLocaleString()} ${type} bill`);
    res.status(201).json({ bill: await db.prepare("SELECT * FROM bills WHERE id = ?").get(info.lastInsertRowid) });
  })
);

router.patch(
  "/bills/:id/pay",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const bill = await db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
    if (!bill || bill.room_id !== user.room_id) return res.status(404).json({ error: "Bill not found" });
    await db.prepare("UPDATE bills SET paid = NOT paid WHERE id = ?").run(bill.id);
    const updated = await db.prepare("SELECT * FROM bills WHERE id = ?").get(bill.id);
    await syncChartHistory(bill.room_id);
    res.json({ paid: updated.paid });
  })
);

// ---- Other expenses ---------------------------------------------------------
// "visible" lets someone log a personal expense in the same list without it
// cluttering everyone else's view — e.g. a personal errand cost vs. an
// actual shared household cost. You always see your own items regardless;
// roommates only see the ones marked visible.
router.get(
  "/expenses",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const rows = await db
      .prepare(
        `SELECT e.*, u.name AS added_by
         FROM expenses e JOIN users u ON u.id = e.user_id
         WHERE e.room_id = ? AND (e.visible = true OR e.user_id = ?)
         ORDER BY e.created_at DESC`
      )
      .all(user.room_id, user.id);
    res.json({ expenses: rows });
  })
);

router.post(
  "/expenses",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { name, amount, visible } = req.body || {};
    if (!name || !amount) return res.status(400).json({ error: "name and amount are required" });

    const info = await db
      .prepare("INSERT INTO expenses (room_id, user_id, name, amount, visible) VALUES (?, ?, ?, ?, ?)")
      .run(user.room_id, user.id, name, Number(amount), visible === false ? false : true);

    res.status(201).json({
      expense: await db.prepare("SELECT * FROM expenses WHERE id = ?").get(info.lastInsertRowid),
    });
  })
);

router.patch(
  "/expenses/:id/settle",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const expense = await db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id);
    if (!expense || expense.room_id !== user.room_id) return res.status(404).json({ error: "Expense not found" });
    await db.prepare("UPDATE expenses SET settled = NOT settled WHERE id = ?").run(expense.id);
    const updated = await db.prepare("SELECT * FROM expenses WHERE id = ?").get(expense.id);
    res.json({ settled: updated.settled });
  })
);

// ---- Shopping list ------------------------------------------------------------
router.get(
  "/shopping",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const rows = await db
      .prepare(
        `SELECT s.*, u.name AS added_by
         FROM shopping_items s JOIN users u ON u.id = s.user_id
         WHERE s.room_id = ? AND (s.visible = true OR s.user_id = ?)
         ORDER BY s.created_at DESC`
      )
      .all(user.room_id, user.id);
    res.json({ items: rows });
  })
);

router.post(
  "/shopping",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { name, visible } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const info = await db
      .prepare("INSERT INTO shopping_items (room_id, user_id, name, visible) VALUES (?, ?, ?, ?)")
      .run(user.room_id, user.id, name, visible === false ? false : true);
    res.status(201).json({
      item: await db.prepare("SELECT * FROM shopping_items WHERE id = ?").get(info.lastInsertRowid),
    });
  })
);

router.patch(
  "/shopping/:id/toggle",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const item = await db.prepare("SELECT * FROM shopping_items WHERE id = ?").get(req.params.id);
    if (!item || item.room_id !== user.room_id) return res.status(404).json({ error: "Item not found" });
    await db.prepare("UPDATE shopping_items SET done = NOT done WHERE id = ?").run(item.id);
    const updated = await db.prepare("SELECT * FROM shopping_items WHERE id = ?").get(item.id);
    res.json({ done: updated.done });
  })
);

// ---- Statistics -------------------------------------------------------------
// The whole point of this app being a "financial assistance app for dorm
// life": not just tracking bills, but surfacing what actually matters — is
// spending trending up or down, and where's the money going. (The "who
// owes/fronted what" per-person breakdown was removed by request — this tab
// is now just about the household's own spending, not who owes who.)
router.get(
  "/stats",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);

    const now = new Date();
    const thisMonth = monthKey(now);
    const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const billsThis = await db.prepare("SELECT type, amount FROM bills WHERE room_id = ? AND month = ?").all(user.room_id, thisMonth);
    const billsLast = await db.prepare("SELECT type, amount FROM bills WHERE room_id = ? AND month = ?").all(user.room_id, lastMonth);
    const electricThis = Number(billsThis.find((b) => b.type === "electric")?.amount || 0);
    const waterThis = Number(billsThis.find((b) => b.type === "water")?.amount || 0);
    const electricLast = Number(billsLast.find((b) => b.type === "electric")?.amount || 0);
    const waterLast = Number(billsLast.find((b) => b.type === "water")?.amount || 0);

    const expensesThisRows = await db
      .prepare("SELECT user_id, amount FROM expenses WHERE room_id = ? AND to_char(created_at, 'YYYY-MM') = ?")
      .all(user.room_id, thisMonth);
    const expensesLastRows = await db
      .prepare("SELECT amount FROM expenses WHERE room_id = ? AND to_char(created_at, 'YYYY-MM') = ?")
      .all(user.room_id, lastMonth);

    const otherThis = expensesThisRows.reduce((sum, r) => sum + Number(r.amount), 0);
    const otherLast = expensesLastRows.reduce((sum, r) => sum + Number(r.amount), 0);
    const rentAmount = Number(room.rent) || 0;

    const totalThis = rentAmount + electricThis + waterThis + otherThis;
    const totalLast = rentAmount + electricLast + waterLast + otherLast;
    const percentChange = totalLast > 0 ? Math.round(((totalThis - totalLast) / totalLast) * 1000) / 10 : null;

    const byCategoryRaw = [
      { label: "Rent", amount: rentAmount },
      { label: "Electric", amount: electricThis },
      { label: "Water", amount: waterThis },
      { label: "Other", amount: otherThis },
    ];
    const byCategory = byCategoryRaw.map((c) => ({
      ...c,
      pct: totalThis > 0 ? Math.round((c.amount / totalThis) * 100) : 0,
    }));

    // A rolling baseline from recent history, so "this month" has something
    // steadier than just last month to compare against.
    const history = await db
      .prepare("SELECT electric, water FROM chart_history WHERE room_id = ? ORDER BY created_at DESC LIMIT 6")
      .all(user.room_id);
    const avgElectric = history.length ? history.reduce((s, h) => s + Number(h.electric), 0) / history.length : 0;
    const avgWater = history.length ? history.reduce((s, h) => s + Number(h.water), 0) / history.length : 0;

    res.json({
      thisMonth: { total: totalThis, rent: rentAmount, electric: electricThis, water: waterThis, other: otherThis },
      lastMonth: { total: totalLast, rent: rentAmount, electric: electricLast, water: waterLast, other: otherLast },
      percentChange,
      byCategory,
      averages: { electric: Math.round(avgElectric * 100) / 100, water: Math.round(avgWater * 100) / 100 },
    });
  })
);

module.exports = router;
