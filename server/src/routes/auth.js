// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken, requireAuth } = require("../middleware/auth");
const { asyncRoute } = require("../middleware/asyncRoute");

const router = express.Router();

// Strips spaces, dashes, and parens so "0917 123 4567" and "0917-123-4567"
// are treated as the same number. Keeps a leading "+" if present.
function normalizePhone(raw) {
  const trimmed = (raw || "").trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return plus + digits;
}

function isValidPhone(phone) {
  const digits = phone.replace(/^\+/, "");
  return digits.length >= 7 && digits.length <= 15;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    avatar: u.avatar,
    role: u.role,
    status: u.status,
    roomId: u.room_id,
  };
}

// POST /api/auth/register  { phone, name, password }
router.post(
  "/register",
  asyncRoute(async (req, res) => {
    const { phone: rawPhone, name, password } = req.body || {};
    if (!rawPhone || !name || !password) {
      return res.status(400).json({ error: "phone, name and password are required" });
    }

    const phone = normalizePhone(rawPhone);
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: "Enter a valid phone number" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
    if (existing) {
      return res.status(409).json({ error: "An account with that phone number already exists" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = await db
      .prepare("INSERT INTO users (phone, password_hash, name) VALUES (?, ?, ?)")
      .run(phone, hash, name.trim());

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  })
);

// POST /api/auth/login  { phone, password }
router.post(
  "/login",
  asyncRoute(async (req, res) => {
    const { phone: rawPhone, password } = req.body || {};
    if (!rawPhone || !password) {
      return res.status(400).json({ error: "phone and password are required" });
    }

    const phone = normalizePhone(rawPhone);
    const user = await db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid phone number or password" });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  })
);

// PATCH /api/auth/role  { role }  — sets role once (only 'tenant' allowed for now)
router.patch(
  "/role",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { role } = req.body || {};
    if (role !== "tenant") {
      return res.status(400).json({ error: "Only the 'tenant' role is available right now. Landlord is coming soon." });
    }
    await db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.user.id);
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

// GET /api/auth/me
router.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: publicUser(user) });
  })
);

module.exports = router;
module.exports.publicUser = publicUser;
