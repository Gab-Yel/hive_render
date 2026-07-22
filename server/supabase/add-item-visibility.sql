-- add-item-visibility.sql
-- -----------------------------------------------------------------------------
-- Adds a "visible to roommates or just you" option to Other Expenses and the
-- Shopping List — same idea as schedule_sessions.visible, just for these two
-- lists. Run once in Supabase's SQL Editor. Safe to re-run.
-- -----------------------------------------------------------------------------

alter table expenses add column if not exists visible boolean default true;
alter table shopping_items add column if not exists visible boolean default true;
