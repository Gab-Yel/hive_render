-- fix-month-columns.sql
-- -----------------------------------------------------------------------------
-- Run this once in Supabase's SQL Editor. Fixes two real bugs:
--
-- 1. `bills.month`, `rent_payments.month`, and `chart_history.month` are
--    still typed `date` from the original schema. The app writes plain
--    text like "2026-07" or "Feb" into them (they're just labels, not real
--    calendar dates), which Postgres's `date` type rejects — that's the
--    "invalid input syntax for type date" errors you saw.
--
-- 2. `chart_history` was missing a `created_at` column, but the finances
--    chart endpoint tried to sort by it — that's the
--    "column created_at does not exist" error.
--
-- Safe to run even if you've already run the latest schema.sql — the
-- `alter column ... type text` is a no-op if it's already text, and
-- `add column if not exists` won't duplicate the column.
-- -----------------------------------------------------------------------------

alter table bills alter column month type text using month::text;
alter table rent_payments alter column month type text using month::text;
alter table chart_history alter column month type text using month::text;

alter table chart_history add column if not exists created_at timestamp default now();
