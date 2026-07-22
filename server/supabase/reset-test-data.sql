-- reset-test-data.sql
-- -----------------------------------------------------------------------------
-- Use this while you're still testing, to clear out accounts/rooms and start
-- fresh. Two options below — pick ONE.
-- -----------------------------------------------------------------------------

-- OPTION A: wipe EVERYTHING (all users, all rooms, all data). Simplest while
-- you're the only person testing and nothing here is real data yet.
-- Uncomment and run:

-- truncate table
--   poll_votes, poll_options, polls,
--   schedule_sessions, chart_history,
--   shopping_items, expenses, bills, rent_payments,
--   bulletin_notes, announcements, join_requests,
--   users, rooms
-- restart identity cascade;


-- OPTION B: delete just ONE account by phone number, plus the room it
-- created (if any), so you don't nuke other people's test accounts.
-- Replace the phone number below, then run:

-- do $$
-- declare
--   target_phone text := '09171234567'; -- <-- put the phone number here
--   target_user_id uuid;
--   target_room_id uuid;
-- begin
--   select id, room_id into target_user_id, target_room_id from users where phone = target_phone;
--   if target_user_id is null then
--     raise notice 'No user found with that phone number.';
--     return;
--   end if;

--   -- Detach anyone else from the room first if this user created it, then
--   -- delete the room's data and the room itself.
--   if target_room_id is not null then
--     delete from poll_votes where poll_id in (select id from polls where room_id = target_room_id);
--     delete from poll_options where poll_id in (select id from polls where room_id = target_room_id);
--     delete from polls where room_id = target_room_id;
--     delete from schedule_sessions where room_id = target_room_id;
--     delete from chart_history where room_id = target_room_id;
--     delete from shopping_items where room_id = target_room_id;
--     delete from expenses where room_id = target_room_id;
--     delete from bills where room_id = target_room_id;
--     delete from rent_payments where room_id = target_room_id;
--     delete from bulletin_notes where room_id = target_room_id;
--     delete from announcements where room_id = target_room_id;
--     delete from join_requests where room_id = target_room_id;
--     update users set room_id = null where room_id = target_room_id;
--     delete from rooms where id = target_room_id;
--   end if;

--   delete from users where id = target_user_id;
--   raise notice 'Deleted user % and their room (if any).', target_phone;
-- end $$;
