// routes/users.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");
const { publicUser } = require("./auth");

const router = express.Router();

// GET /api/users/room
router.get(
  "/room",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user.room_id) return res.json({ members: [] });
    const members = await db.prepare("SELECT * FROM users WHERE room_id = ?").all(user.room_id);
    res.json({ members: members.map(publicUser) });
  })
);

// PATCH /api/users/me/status  { status: 'home' | 'in_room' | 'outside' }
router.patch(
  "/me/status",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { status } = req.body || {};
    if (!["home", "in_room", "outside"].includes(status)) {
      return res.status(400).json({ error: "status must be 'home', 'in_room', or 'outside'" });
    }
    await db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, req.user.id);
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

// PATCH /api/users/me  { name?, avatar? }
router.patch(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { name, avatar } = req.body || {};
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

    const nextName = name && name.trim() ? name.trim() : user.name;
    const nextAvatar = avatar !== undefined ? avatar : user.avatar;

    await db.prepare("UPDATE users SET name = ?, avatar = ? WHERE id = ?").run(nextName, nextAvatar, user.id);
    const updated = await db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    res.json({ user: publicUser(updated) });
  })
);

module.exports = router;
