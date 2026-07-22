// routes/schedules.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");

const router = express.Router();

async function currentUser(req, res) {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user.room_id) {
    res.status(400).json({ error: "Join or create a room first" });
    return null;
  }
  return user;
}

function serialize(session, viewerId) {
  const isOwner = session.user_id === viewerId;
  const visible = !!session.visible;
  return {
    id: session.id,
    userId: session.user_id,
    dayOfWeek: session.day_of_week,
    startTime: session.start_time,
    endTime: session.end_time,
    visible,
    title: isOwner || visible ? session.title : "Busy",
    isOwner,
  };
}

// GET /api/schedules/user/:userId
router.get(
  "/user/:userId",
  requireAuth,
  asyncRoute(async (req, res) => {
    const viewer = await currentUser(req, res);
    if (!viewer) return;

    const target = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId);
    if (!target || target.room_id !== viewer.room_id) {
      return res.status(404).json({ error: "Member not found in your room" });
    }

    const sessions = await db
      .prepare("SELECT * FROM schedule_sessions WHERE user_id = ? ORDER BY day_of_week, start_time")
      .all(target.id);

    res.json({ sessions: sessions.map((s) => serialize(s, viewer.id)) });
  })
);

// POST /api/schedules  { dayOfWeek, startTime, endTime, title, visible }
router.post(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { dayOfWeek, startTime, endTime, title, visible } = req.body || {};

    if (dayOfWeek === undefined || !startTime || !title) {
      return res.status(400).json({ error: "dayOfWeek, startTime and title are required" });
    }

    const info = await db
      .prepare(
        `INSERT INTO schedule_sessions (room_id, user_id, day_of_week, start_time, end_time, title, visible)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(user.room_id, user.id, Number(dayOfWeek), startTime, endTime || null, title, visible === false ? false : true);

    const session = await db.prepare("SELECT * FROM schedule_sessions WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ session: serialize(session, user.id) });
  })
);

// PATCH /api/schedules/:id
router.patch(
  "/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const session = await db.prepare("SELECT * FROM schedule_sessions WHERE id = ?").get(req.params.id);
    if (!session || session.user_id !== user.id) {
      return res.status(404).json({ error: "Session not found" });
    }

    const next = {
      day_of_week: req.body.dayOfWeek ?? session.day_of_week,
      start_time: req.body.startTime ?? session.start_time,
      end_time: req.body.endTime ?? session.end_time,
      title: req.body.title ?? session.title,
      visible: req.body.visible === undefined ? session.visible : !!req.body.visible,
    };

    await db
      .prepare(
        "UPDATE schedule_sessions SET day_of_week=?, start_time=?, end_time=?, title=?, visible=? WHERE id=?"
      )
      .run(next.day_of_week, next.start_time, next.end_time, next.title, next.visible, session.id);

    const updated = await db.prepare("SELECT * FROM schedule_sessions WHERE id = ?").get(session.id);
    res.json({ session: serialize(updated, user.id) });
  })
);

// DELETE /api/schedules/:id
router.delete(
  "/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const session = await db.prepare("SELECT * FROM schedule_sessions WHERE id = ?").get(req.params.id);
    if (!session || session.user_id !== user.id) {
      return res.status(404).json({ error: "Session not found" });
    }
    await db.prepare("DELETE FROM schedule_sessions WHERE id = ?").run(session.id);
    res.json({ ok: true });
  })
);

module.exports = router;
