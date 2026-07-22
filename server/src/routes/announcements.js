// routes/announcements.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");

const router = express.Router();

async function currentRoom(req, res) {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user.room_id) {
    res.status(400).json({ error: "Join or create a room first" });
    return null;
  }
  return user;
}

// GET /api/announcements
router.get(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentRoom(req, res);
    if (!user) return;

    const rows = await db
      .prepare(
        `SELECT a.*, u.name AS author_name
         FROM announcements a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.room_id = ?
         ORDER BY a.created_at DESC`
      )
      .all(user.room_id);

    res.json({ announcements: rows });
  })
);

// POST /api/announcements  { title, body, priority }
router.post(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentRoom(req, res);
    if (!user) return;

    const { title, body, priority } = req.body || {};
    if (!title) return res.status(400).json({ error: "Title is required" });

    const info = await db
      .prepare(
        "INSERT INTO announcements (room_id, user_id, title, body, priority, type) VALUES (?, ?, ?, ?, ?, 'normal')"
      )
      .run(user.room_id, user.id, title, body || "", priority || "info");

    const row = await db.prepare("SELECT * FROM announcements WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ announcement: row });
  })
);

// GET /api/announcements/unread-count
// Placed before "/" intentionally has no conflict here (no /:id route in
// this router), but kept as its own explicit path rather than a query param
// so it's cacheable/simple to call frequently from the notification bell.
router.get(
  "/unread-count",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user.room_id) return res.json({ count: 0 });

    const row = await db
      .prepare("SELECT COUNT(*)::int AS count FROM announcements WHERE room_id = ? AND created_at > ?")
      .get(user.room_id, user.notifications_seen_at);
    res.json({ count: row.count });
  })
);

// POST /api/announcements/mark-seen — call when the person opens the
// notification bell / Announce tab, so unread count resets to 0.
router.post(
  "/mark-seen",
  requireAuth,
  asyncRoute(async (req, res) => {
    await db.prepare("UPDATE users SET notifications_seen_at = now() WHERE id = ?").run(req.user.id);
    res.json({ ok: true });
  })
);

module.exports = router;
