// index.js
// -----------------------------------------------------------------------------
// This is the single process that runs your whole app in production:
//   - it exposes the JSON API under /api/*
//   - it also serves the frontend (public/) as static files
// Running both from one process means ONE thing to deploy and ONE port to
// open — the simplest possible setup, and exactly what most free/cheap
// hosts (Render, Railway, Fly.io, a basic VPS) expect.
//
// In local development you could instead run the frontend and backend on
// two different ports (e.g. a live-reloading static server + this API), but
// since this app has no build step (plain HTML/CSS/JS), there's no benefit
// to that complexity — we serve everything from here, both locally and in
// production, so "how you test it" and "how it runs live" are the same.
// -----------------------------------------------------------------------------

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();

// WHY cors()? If you later split the frontend onto its own domain (e.g. a
// mobile app's WebView, or a separate static host), the browser/WebView will
// block API requests unless the server explicitly allows them. Since we
// serve the frontend from this same server today, you technically don't
// need CORS yet — but enabling it costs nothing now and saves you a
// confusing debugging session later.
app.use(cors());
app.use(express.json({ limit: "5mb" })); // 5mb so base64 profile photos fit

// ---- API routes -------------------------------------------------------------
app.use("/api/auth", require("./routes/auth"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/announcements", require("./routes/announcements"));
app.use("/api/finances", require("./routes/finances"));
app.use("/api/personal", require("./routes/personal"));
app.use("/api/polls", require("./routes/polls"));
app.use("/api/schedules", require("./routes/schedules"));
app.use("/api/room-events", require("./routes/roomEvents"));
app.use("/api/bulletin", require("./routes/bulletin"));
app.use("/api/users", require("./routes/users"));

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- Static frontend ---------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
app.use(express.static(PUBLIC_DIR));

// Any non-API route falls back to index.html so the client-side router
// (scripts/app.js) can take over — this matters if you ever add real URLs
// like /pages/finances instead of only fragment-fetching.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ---- Error handler ------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Hive server running:  http://localhost:${PORT}`);
});
