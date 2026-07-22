// routes/polls.js
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

async function serializePoll(poll, userId) {
  const options = await db.prepare("SELECT * FROM poll_options WHERE poll_id = ?").all(poll.id);
  const votes = await db.prepare("SELECT * FROM poll_votes WHERE poll_id = ?").all(poll.id);
  const total = votes.length;
  const myVote = votes.find((v) => v.user_id === userId);

  return {
    id: poll.id,
    question: poll.question,
    deadline: poll.deadline,
    createdAt: poll.created_at,
    totalVotes: total,
    myOptionId: myVote ? myVote.option_id : null,
    options: options.map((o) => {
      const count = votes.filter((v) => v.option_id === o.id).length;
      return {
        id: o.id,
        label: o.label,
        votes: count,
        pct: total ? Math.round((count / total) * 100) : 0,
      };
    }),
  };
}

// GET /api/polls
router.get(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const polls = await db
      .prepare("SELECT * FROM polls WHERE room_id = ? ORDER BY created_at DESC")
      .all(user.room_id);
    res.json({ polls: await Promise.all(polls.map((p) => serializePoll(p, user.id))) });
  })
);

// POST /api/polls  { question, options: string[], deadline? }
router.post(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const { question, options, deadline } = req.body || {};

    if (!question || !Array.isArray(options) || options.filter((o) => o.trim()).length < 2) {
      return res.status(400).json({ error: "A question and at least 2 options are required" });
    }

    const info = await db
      .prepare("INSERT INTO polls (room_id, user_id, question, deadline) VALUES (?, ?, ?, ?)")
      .run(user.room_id, user.id, question, deadline || null);

    const validOptions = options.filter((o) => o.trim());
    for (const label of validOptions) {
      await db.prepare("INSERT INTO poll_options (poll_id, label) VALUES (?, ?)").run(info.lastInsertRowid, label.trim());
    }

    const poll = await db.prepare("SELECT * FROM polls WHERE id = ?").get(info.lastInsertRowid);
    await notifyRoom(user.room_id, "New poll", `${user.name} started a poll: "${question}"`);
    res.status(201).json({ poll: await serializePoll(poll, user.id) });
  })
);

// POST /api/polls/:id/vote  { optionId }
router.post(
  "/:id/vote",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const poll = await db.prepare("SELECT * FROM polls WHERE id = ?").get(req.params.id);
    if (!poll || poll.room_id !== user.room_id) return res.status(404).json({ error: "Poll not found" });

    if (poll.deadline && new Date(poll.deadline).getTime() < Date.now()) {
      return res.status(400).json({ error: "This poll is closed" });
    }

    const { optionId } = req.body || {};
    const option = await db
      .prepare("SELECT * FROM poll_options WHERE id = ? AND poll_id = ?")
      .get(optionId, poll.id);
    if (!option) return res.status(400).json({ error: "Invalid option" });

    await db
      .prepare(
        `INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)
         ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id`
      )
      .run(poll.id, optionId, user.id);

    res.json({ poll: await serializePoll(poll, user.id) });
  })
);

module.exports = router;
