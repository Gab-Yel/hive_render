// middleware/asyncRoute.js
// -----------------------------------------------------------------------------
// THE BUG THIS FIXES (this is likely why signup/login "waits forever, then
// fails"): Express 4 does NOT automatically catch errors thrown inside an
// `async (req, res) => {...}` handler. If `await db.prepare(...).get()`
// rejects (e.g. the database is unreachable, wrong connection string, DNS
// failure, etc.), that becomes an unhandled promise rejection — Express
// never finds out, so it never sends ANY response. The request just hangs
// until the client eventually gives up (a device or proxy timeout), which
// is exactly the "waits a long time, then fails" symptom.
//
// The fix: wrap every route handler in this, so a rejected promise is
// forwarded to next(err) — Express's error-handling middleware in
// index.js then responds immediately with a clear 500 instead of leaving
// the client hanging.
// -----------------------------------------------------------------------------
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncRoute };
