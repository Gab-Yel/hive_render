// db.js
// -----------------------------------------------------------------------------
// Migrated from Node's built-in `node:sqlite` to Supabase's Postgres database,
// via the `pg` (node-postgres) driver.
//
// WHY `pg` directly instead of the `@supabase/supabase-js` client library?
// supabase-js is a REST wrapper (PostgREST) built for browsers/mobile apps
// talking to Supabase *without* a backend of their own — it's not a general
// SQL client. This project already has a real backend (this Express server)
// that owns all the SQL, so it's simpler and faster to speak Postgres
// directly using the connection string from Supabase's dashboard
// (Settings -> Database -> Connection string). Same database, no extra
// layer, and all the existing SQL in the route files keeps working.
//
// WHY keep a `.prepare(sql).get()/.all()/.run()` shape at all, instead of
// rewriting every route to use pg's `pool.query()` directly?
// Because every route file already calls db this way — this thin adapter
// means the route files barely change (mostly just adding `async`/`await`),
// instead of a full rewrite of every SQL call. The one real difference from
// node:sqlite: these are now async, since a network database can't be
// queried synchronously. `?` placeholders are translated to Postgres's
// `$1, $2, ...` automatically.
// -----------------------------------------------------------------------------

const { Pool, types } = require("pg");

// -----------------------------------------------------------------------------
// THE BUG THIS FIXES: by default, node-postgres parses `date` and
// `timestamp` columns into JS Date objects. That seems convenient, but this
// app sends everything through res.json() — and JSON.stringify() turns a
// Date into a full ISO string like "2026-08-04T00:00:00.000Z", even for a
// plain `date` column that never had a time component. Two real bugs came
// from this:
//   1. Bill due dates displayed as raw "2026-08-04T00:00:00Z" instead of a
//      clean date.
//   2. "NaNd ago" on every announcement/note timestamp — the frontend's
//      timeAgo() was written expecting Postgres's plain text format
//      ("2026-07-19 05:12:33"), not a full ISO string with an extra "Z"
//      appended, and choked on it.
// Fix: tell node-postgres to hand back the raw text Postgres already sends
// over the wire for these types, instead of converting them to Date
// objects. Every route/frontend already round-trips these as plain
// strings, so this is the smallest fix that's correct everywhere at once.
// -----------------------------------------------------------------------------
types.setTypeParser(1082, (val) => val); // DATE
types.setTypeParser(1114, (val) => val); // TIMESTAMP WITHOUT TIME ZONE

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy server/.env.example to server/.env and paste in " +
      "your Supabase connection string (Project Settings -> Database -> Connection string)."
  );
}

const pool = new Pool({
  connectionString,
  // Supabase requires SSL; rejectUnauthorized:false avoids needing the CA
  // bundle locally. Fine for this app's scale — see README if you want to
  // pin the cert instead.
  ssl: { rejectUnauthorized: false },
  // WHY these timeouts: without them, a wrong/unreachable DATABASE_URL (bad
  // host, DNS failure, firewalled port) makes pg hang trying to connect —
  // sometimes for a long time — before ever erroring out. Combined with
  // Express not auto-catching async errors (see middleware/asyncRoute.js),
  // this used to make the whole request hang instead of failing fast. Now
  // a bad connection surfaces as a real error within a few seconds.
  connectionTimeoutMillis: 8000,
  statement_timeout: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error", err);
});

// Turns "SELECT * FROM users WHERE id = ? AND x = ?" into
// "SELECT * FROM users WHERE id = $1 AND x = $2"
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const res = await pool.query(toPositional(sql), params);
  return res.rows;
}

async function get(sql, params = []) {
  const res = await pool.query(toPositional(sql), params);
  return res.rows[0];
}

// Emulates node:sqlite's `.run()` -> { lastInsertRowid, changes }.
// For INSERTs we transparently add `RETURNING id` (unless the caller already
// wrote one) so we can hand back the new row's id the same way SQLite did.
async function run(sql, params = []) {
  const isInsert = /^\s*insert/i.test(sql);
  const hasReturning = /returning/i.test(sql);
  const finalSql = isInsert && !hasReturning ? `${sql} RETURNING id` : sql;

  const res = await pool.query(toPositional(finalSql), params);
  return {
    lastInsertRowid: isInsert ? res.rows[0]?.id : undefined,
    changes: res.rowCount,
  };
}

// db.prepare(sql).get(...) / .all(...) / .run(...) — same call shape as
// before, so route files only need `await` added, not a full rewrite.
function prepare(sql) {
  return {
    get: (...params) => get(sql, params),
    all: (...params) => all(sql, params),
    run: (...params) => run(sql, params),
  };
}

module.exports = { prepare, pool };
