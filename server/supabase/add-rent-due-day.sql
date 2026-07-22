-- add-rent-due-day.sql
-- -----------------------------------------------------------------------------
-- Adds the "rent due day" setting to rooms that already exist (schema.sql's
-- `create table if not exists` won't add a column to a table you already
-- have — same lesson as fix-month-columns.sql). Safe to re-run.
-- -----------------------------------------------------------------------------

alter table rooms add column if not exists rent_due_day int check (rent_due_day between 1 and 31);
