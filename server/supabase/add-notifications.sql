-- add-notifications.sql
-- -----------------------------------------------------------------------------
-- Adds the in-app notification bell feature. This does NOT set up real push
-- notifications (the kind that alert you when the app is closed) — that
-- needs a Firebase/APNs project and native device-token plumbing, a much
-- bigger undertaking on its own. This is an in-app activity feed instead:
-- the existing Announce tab becomes a unified feed (it already gets a row
-- for join requests; this adds one for new polls, bills, and calendar
-- events too), and a bell icon shows how many you haven't seen yet.
--
-- Run once in Supabase's SQL Editor. Safe to re-run.
-- -----------------------------------------------------------------------------

alter table users add column if not exists notifications_seen_at timestamp default now();
