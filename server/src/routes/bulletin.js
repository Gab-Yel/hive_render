// routes/bulletin.js
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

router.get(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const notes = await db
      .prepare(
        `SELECT b.*, u.name AS author_name
         FROM bulletin_notes b JOIN users u ON u.id = b.user_id
         WHERE b.room_id = ? ORDER BY b.created_at DESC`
      )
      .all(user.room_id);
    res.json({ notes });
  })
);

// POST /api/bulletin  { text, image } — image is a base64 data URL, optional
router.post(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { text, image } = req.body || {};
    if (!text && !image) return res.status(400).json({ error: "text or image is required" });

    const info = await db
      .prepare("INSERT INTO bulletin_notes (room_id, user_id, text, image) VALUES (?, ?, ?, ?)")
      .run(user.room_id, user.id, text || "", image || null);

    res.status(201).json({
      note: await db.prepare("SELECT * FROM bulletin_notes WHERE id = ?").get(info.lastInsertRowid),
    });
  })
);

module.exports = router;
