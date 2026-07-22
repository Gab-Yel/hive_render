// routes/rooms.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");
const { generateRoomCode } = require("../utils/roomCode");
const { publicUser } = require("./auth");

const router = express.Router();

function requireRole(role) {
  return asyncRoute(async (req, res, next) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.role !== role) {
      return res.status(403).json({ error: `Only a '${role}' can do this` });
    }
    req.dbUser = user;
    next();
  });
}

// POST /api/rooms  { location, rent, notes }
router.post(
  "/",
  requireAuth,
  requireRole("tenant"),
  asyncRoute(async (req, res) => {
    const { location, rent, notes } = req.body || {};
    const user = req.dbUser;

    if (user.room_id) {
      return res.status(400).json({ error: "You're already in a room. Leave it before creating a new one." });
    }

    let code;
    do {
      code = generateRoomCode();
    } while (await db.prepare("SELECT id FROM rooms WHERE code = ?").get(code));

    const info = await db
      .prepare("INSERT INTO rooms (code, location, rent, notes, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(code, location || null, Number(rent) || 0, notes || null, user.id);

    await db.prepare("UPDATE users SET room_id = ? WHERE id = ?").run(info.lastInsertRowid, user.id);

    // Seed 6 months of $0 chart history so the Overview line chart has an axis
    // to animate along from day one — real numbers replace these as bills come in.
    const months = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];
    for (const m of months) {
      await db
        .prepare("INSERT INTO chart_history (room_id, month, electric, water) VALUES (?, ?, 0, 0)")
        .run(info.lastInsertRowid, m);
    }

    await db
      .prepare(
        "INSERT INTO announcements (room_id, user_id, title, body, priority, type) VALUES (?, ?, ?, ?, 'info', 'normal')"
      )
      .run(info.lastInsertRowid, user.id, "Room created", `${user.name} started this Hive. Welcome!`);

    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ room });
  })
);

// POST /api/rooms/join  { code }
router.post(
  "/join",
  requireAuth,
  requireRole("tenant"),
  asyncRoute(async (req, res) => {
    const { code } = req.body || {};
    const user = req.dbUser;

    if (user.room_id) {
      return res.status(400).json({ error: "You're already in a room." });
    }
    if (!code) return res.status(400).json({ error: "Room code is required" });

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").get(code.trim().toUpperCase());
    if (!room) return res.status(404).json({ error: "No room found with that code" });

    const already = await db
      .prepare("SELECT id FROM join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'")
      .get(room.id, user.id);
    if (already) {
      return res.status(409).json({ error: "You already have a pending request for this room" });
    }

    const reqInfo = await db
      .prepare("INSERT INTO join_requests (room_id, user_id, status) VALUES (?, ?, 'pending')")
      .run(room.id, user.id);

    await db
      .prepare(
        `INSERT INTO announcements (room_id, user_id, title, body, priority, type, join_request_id)
         VALUES (?, ?, ?, ?, 'notice', 'join_request', ?)`
      )
      .run(
        room.id,
        user.id,
        "New join request",
        `${user.name} wants to join this Hive.`,
        reqInfo.lastInsertRowid
      );

    res.status(201).json({
      message: "Request sent. A current member needs to accept it.",
      requestId: reqInfo.lastInsertRowid,
    });
  })
);

// POST /api/rooms/requests/:id/respond  { accept: boolean }
router.post(
  "/requests/:id/respond",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { accept } = req.body || {};
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const joinReq = await db.prepare("SELECT * FROM join_requests WHERE id = ?").get(req.params.id);

    if (!joinReq) return res.status(404).json({ error: "Request not found" });
    if (!user.room_id || user.room_id !== joinReq.room_id) {
      return res.status(403).json({ error: "Only members of that room can respond" });
    }
    if (joinReq.status !== "pending") {
      return res.status(400).json({ error: "This request was already resolved" });
    }

    const status = accept ? "accepted" : "declined";
    await db.prepare("UPDATE join_requests SET status = ? WHERE id = ?").run(status, joinReq.id);

    if (accept) {
      await db.prepare("UPDATE users SET room_id = ? WHERE id = ?").run(joinReq.room_id, joinReq.user_id);
    }

    // Resolve (remove from the actionable feed) the original notification.
    await db.prepare("DELETE FROM announcements WHERE join_request_id = ?").run(joinReq.id);

    const requester = await db.prepare("SELECT * FROM users WHERE id = ?").get(joinReq.user_id);
    await db
      .prepare(
        "INSERT INTO announcements (room_id, user_id, title, body, priority, type) VALUES (?, NULL, ?, ?, 'info', 'normal')"
      )
      .run(
        joinReq.room_id,
        accept ? "New member" : "Join request declined",
        accept ? `${requester.name} joined the Hive.` : `${requester.name}'s request to join was declined.`
      );

    res.json({ status });
  })
);

// GET /api/rooms/mine — room + members for the logged in user
router.get(
  "/mine",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user.room_id) return res.json({ room: null, members: [] });

    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);
    const members = await db.prepare("SELECT * FROM users WHERE room_id = ?").all(user.room_id);
    res.json({ room, members: members.map(publicUser) });
  })
);

// PATCH /api/rooms/rent-due-day  { dueDay: 1-31 | null }
// "make it an option for the users" — any room member can set/change which
// day of the month rent is due, rather than it being hard-coded. Passing
// null clears it (falls back to "no deadline set" in the UI).
router.patch(
  "/rent-due-day",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user.room_id) return res.status(400).json({ error: "Join or create a room first" });

    const { dueDay } = req.body || {};
    if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      return res.status(400).json({ error: "dueDay must be an integer from 1 to 31, or null to clear it" });
    }

    await db.prepare("UPDATE rooms SET rent_due_day = ? WHERE id = ?").run(dueDay, user.room_id);
    const room = await db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);
    res.json({ room });
  })
);

module.exports = router;
