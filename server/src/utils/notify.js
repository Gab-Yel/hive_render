// utils/notify.js
// -----------------------------------------------------------------------------
// A tiny shared helper: posts a system-generated row into `announcements`
// (user_id NULL, same as the "member joined" / "join declined" messages
// rooms.js already creates) so the Announce tab acts as one unified
// activity feed. This is what the notification bell counts against — see
// routes/announcements.js's /unread-count and /mark-seen.
// -----------------------------------------------------------------------------
const db = require("../db");

async function notifyRoom(roomId, title, body) {
  await db
    .prepare(
      "INSERT INTO announcements (room_id, user_id, title, body, priority, type) VALUES (?, NULL, ?, ?, 'info', 'normal')"
    )
    .run(roomId, title, body || "");
}

module.exports = { notifyRoom };
