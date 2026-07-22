-- fix-join-request-status.sql
-- -----------------------------------------------------------------------------
-- THE BUG THIS FIXES: your `join_requests` table was created from an earlier
-- version of the schema that didn't set `default 'pending'` on the status
-- column. Every join request since then has had status = NULL instead of
-- 'pending'. The accept/decline route checks
-- `if (joinReq.status !== "pending") return "already resolved"` — and NULL
-- never equals 'pending', so EVERY accept/decline attempt failed with
-- "already resolved", even on the very first try. That's the "invite goes
-- through but pressing Accept does nothing" bug.
--
-- Run this once in Supabase's SQL Editor. Safe to re-run.
-- -----------------------------------------------------------------------------

-- Backfill any existing broken rows. (If you happen to know a specific
-- request was truly already handled, you can skip fixing that one row —
-- but for the normal case, every NULL here really is a request that's
-- still waiting on a response.)
UPDATE join_requests SET status = 'pending' WHERE status IS NULL;

-- Make sure new requests can't be born broken the same way again.
ALTER TABLE join_requests ALTER COLUMN status SET DEFAULT 'pending';
