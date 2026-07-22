// middleware/auth.js
// -----------------------------------------------------------------------------
// WHY JWT (JSON Web Token) instead of cookie-based sessions?
// Two reasons, both tied to what you told us about your roadmap:
// 1. You plan to wrap this in a mobile app soon. Mobile WebViews / native
//    HTTP clients don't handle browser cookies as gracefully as a real
//    browser does (cross-origin cookie rules get messy). A JWT is just a
//    string your app stores (e.g. in memory / SecureStore) and sends back
//    in an "Authorization: Bearer <token>" header — it behaves identically
//    on web and mobile.
// 2. It keeps the server *stateless* — there's no server-side session store
//    to manage, which makes deployment and scaling simpler.
//
// HOW it works here:
// - On login/register we sign a token containing the user's id.
// - The client stores that token (see public/scripts/api.js -> localStorage)
//   and sends it on every request.
// - This middleware reads the header, verifies the signature with our
//   JWT_SECRET, and — if valid — attaches the decoded payload to req.user
//   so every route handler downstream knows who's calling.
// -----------------------------------------------------------------------------

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, phone }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: "30d" });
}

module.exports = { requireAuth, signToken, JWT_SECRET };
