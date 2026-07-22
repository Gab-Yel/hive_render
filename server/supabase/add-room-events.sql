-- add-room-events.sql
-- -----------------------------------------------------------------------------
-- Adds the shared "Room Calendar" feature (marking important dates like
-- move-out day, house meetings) to a database that already has the other
-- tables. Safe to re-run — schema.sql's `create table if not exists`
-- already covers fresh installs, but if you ran an earlier schema.sql
-- before this table existed, run this once.
-- -----------------------------------------------------------------------------

create table if not exists room_events (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    title text,
    event_date date not null,
    notes text,
    created_at timestamp default now()
);

create index if not exists idx_room_events_room_id on room_events(room_id, event_date);
