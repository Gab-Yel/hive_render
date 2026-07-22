-- Hive schema for Supabase (Postgres)
-- -----------------------------------------------------------------------------
-- This matches the UUID-based tables already created in your Supabase
-- project (Table Editor / SQL you ran previously), with one change: `email`
-- is now `phone` (text, unique), since login is by phone number.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste
-- this whole file -> Run. It's written with IF NOT EXISTS everywhere so it's
-- safe to re-run. If you already have these tables with an `email` column,
-- see the MIGRATION NOTE at the bottom instead of just re-running this.
-- -----------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- USERS
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    phone text unique not null,
    password_hash text,
    name text,
    avatar text,
    role text check (role in ('tenant','landlord')),
    status text check (status in ('home','in_room','outside')) default 'home',
    room_id uuid,
    notifications_seen_at timestamp default now(),
    created_at timestamp default now()
);

-- ROOMS
create table if not exists rooms (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    location text,
    rent numeric,
    notes text,
    rent_due_day int check (rent_due_day between 1 and 31),
    created_by uuid references users(id),
    created_at timestamp default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_room_id_fkey') then
    alter table users add constraint users_room_id_fkey foreign key (room_id) references rooms(id);
  end if;
end $$;

-- JOIN REQUESTS
create table if not exists join_requests (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    status text check (status in ('pending','accepted','declined')) default 'pending',
    created_at timestamp default now()
);

-- ANNOUNCEMENTS
create table if not exists announcements (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    title text,
    body text,
    priority text default 'info',
    type text check (type in ('normal','join_request')) default 'normal',
    join_request_id uuid references join_requests(id),
    created_at timestamp default now()
);

-- BULLETIN NOTES
create table if not exists bulletin_notes (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    text text,
    image text,
    created_at timestamp default now()
);

-- RENT PAYMENTS
create table if not exists rent_payments (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    month text,
    amount numeric,
    paid_at timestamp default now(),
    unique(room_id, user_id, month)
);

-- BILLS
create table if not exists bills (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    type text check(type in ('electric','water')),
    month text,
    amount numeric,
    due_date date,
    paid boolean default false,
    created_at timestamp default now()
);

-- EXPENSES
create table if not exists expenses (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    name text,
    amount numeric,
    settled boolean default false,
    visible boolean default true,
    created_at timestamp default now()
);

-- SHOPPING ITEMS
create table if not exists shopping_items (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    name text,
    done boolean default false,
    visible boolean default true,
    created_at timestamp default now()
);

-- POLLS
create table if not exists polls (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    question text,
    deadline timestamp,
    created_at timestamp default now()
);

-- POLL OPTIONS
create table if not exists poll_options (
    id uuid primary key default gen_random_uuid(),
    poll_id uuid references polls(id),
    label text
);

-- POLL VOTES
create table if not exists poll_votes (
    id uuid primary key default gen_random_uuid(),
    poll_id uuid references polls(id),
    option_id uuid references poll_options(id),
    user_id uuid references users(id),
    unique(poll_id, user_id)
);

-- SCHEDULE SESSIONS
create table if not exists schedule_sessions (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    day_of_week int,
    start_time text,
    end_time text,
    title text,
    visible boolean default true,
    created_at timestamp default now()
);

-- CHART HISTORY
create table if not exists chart_history (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    month text,
    electric numeric,
    water numeric,
    created_at timestamp default now(),
    unique(room_id, month)
);

-- ROOM EVENTS (shared calendar — anyone in the room can mark an important
-- date, e.g. "Move-out day", "House meeting". Separate from
-- schedule_sessions, which are personal, recurring day-of-week schedules.)
create table if not exists room_events (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references rooms(id),
    user_id uuid references users(id),
    title text,
    event_date date not null,
    notes text,
    created_at timestamp default now()
);

-- Helpful indexes for the lookups every route does (WHERE room_id = ?, etc.)
create index if not exists idx_users_room_id on users(room_id);
create index if not exists idx_join_requests_room_id on join_requests(room_id);
create index if not exists idx_announcements_room_id on announcements(room_id);
create index if not exists idx_bulletin_notes_room_id on bulletin_notes(room_id);
create index if not exists idx_rent_payments_room_user on rent_payments(room_id, user_id);
create index if not exists idx_bills_room_id on bills(room_id);
create index if not exists idx_expenses_room_id on expenses(room_id);
create index if not exists idx_shopping_items_room_id on shopping_items(room_id);
create index if not exists idx_polls_room_id on polls(room_id);
create index if not exists idx_poll_options_poll_id on poll_options(poll_id);
create index if not exists idx_poll_votes_poll_id on poll_votes(poll_id);
create index if not exists idx_schedule_sessions_room_user on schedule_sessions(room_id, user_id);
create index if not exists idx_chart_history_room_id on chart_history(room_id);
create index if not exists idx_room_events_room_id on room_events(room_id, event_date);

-- -----------------------------------------------------------------------------
-- MIGRATION NOTE: if you already ran the OLD schema (with an `email` column)
-- and have real data in it you want to keep, run this instead of the
-- `create table` above for `users`:
--
--   alter table users rename column email to phone;
--
-- If the table is empty / test data only, easiest is to drop and let this
-- file recreate it: `drop table if exists users cascade;` then run this
-- whole file again.
--
-- NOTE ON ROW LEVEL SECURITY: this server (Express + JWT) is the only thing
-- that talks to this database, using the direct Postgres connection string
-- with full privileges — the frontend never calls Supabase directly. So RLS
-- is intentionally left off; access control happens in
-- server/src/routes/*.js. If you ever let the browser talk to Supabase
-- directly instead, you'd need RLS policies — that's a different
-- architecture than what's set up here.
-- -----------------------------------------------------------------------------
