// routes/roomEvents.js
// -----------------------------------------------------------------------------
// The shared "Room Calendar" — anyone in the room can mark an important
// date (move-out day, a house meeting, etc). This is deliberately separate
// from schedule_sessions: those are personal, recurring day-of-week
// schedules ("I have class every Monday at 8am"); these are one-off dates
// on an actual calendar, visible to the whole room.
// -----------------------------------------------------------------------------
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

// GET /api/room-events?month=2026-07  (month is optional — omit for all events)
router.get(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;

    const { month } = req.query;
    let rows;
    if (month) {
      rows = await db
        .prepare(
          `SELECT e.*, u.name AS author_name
           FROM room_events e LEFT JOIN users u ON u.id = e.user_id
           WHERE e.room_id = ? AND to_char(e.event_date, 'YYYY-MM') = ?
           ORDER BY e.event_date ASC`
        )
        .all(user.room_id, month);
    } else {
      rows = await db
        .prepare(
          `SELECT e.*, u.name AS author_name
           FROM room_events e LEFT JOIN users u ON u.id = e.user_id
           WHERE e.room_id = ?
           ORDER BY e.event_date ASC`
        )
        .all(user.room_id);
    }
    res.json({ events: rows });
  })
);

// POST /api/room-events  { title, eventDate: "YYYY-MM-DD", notes? }
router.post(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { title, eventDate, notes } = req.body || {};
    if (!title || !eventDate) return res.status(400).json({ error: "title and eventDate are required" });

    const info = await db
      .prepare("INSERT INTO room_events (room_id, user_id, title, event_date, notes) VALUES (?, ?, ?, ?, ?)")
      .run(user.room_id, user.id, title, eventDate, notes || null);

    const row = await db.prepare("SELECT * FROM room_events WHERE id = ?").get(info.lastInsertRowid);
    await notifyRoom(user.room_id, "New calendar event", `${user.name} marked ${eventDate}: ${title}`);
    res.status(201).json({ event: row });
  })
);

// DELETE /api/room-events/:id — any room member can remove one (shared
// calendar, not just the creator — matches how announcements/bulletin work).
router.delete(
  "/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const event = await db.prepare("SELECT * FROM room_events WHERE id = ?").get(req.params.id);
    if (!event || event.room_id !== user.room_id) return res.status(404).json({ error: "Event not found" });
    await db.prepare("DELETE FROM room_events WHERE id = ?").run(event.id);
    res.json({ ok: true });
  })
);

module.exports = router;
