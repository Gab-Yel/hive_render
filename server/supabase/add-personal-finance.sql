-- add-personal-finance.sql
-- -----------------------------------------------------------------------------
-- Adds the tables behind the new "Personal" page: a per-user expense journal
-- (with categories, one of which is "fixed" for recurring daily costs like
-- transport/food), a monthly allowance/limit, and simple savings / income /
-- debt lists. All of this is scoped to a single user_id, not a room — it's
-- meant to track an individual's own money, separate from the shared
-- household finances in server/src/routes/finances.js.
--
-- Run this once against your Supabase database (same way as the other
-- add-*.sql files here), after schema.sql has already been run.
-- -----------------------------------------------------------------------------

-- Every logged expense: a name, an amount, a category, and the date it was
-- spent on (defaults to today, but can be backdated for a given journal day).
create table if not exists personal_expenses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete cascade,
    name text not null,
    amount numeric not null,
    category text not null default 'other', -- fixed | food | transport | shopping | entertainment | other
    spent_on date not null default current_date,
    created_at timestamp default now()
);
create index if not exists idx_personal_expenses_user on personal_expenses(user_id, spent_on);

-- One row per user: their self-set monthly spending allowance/limit, used to
-- warn them as they approach or exceed it.
create table if not exists personal_settings (
    user_id uuid primary key references users(id) on delete cascade,
    monthly_allowance numeric default 0,
    updated_at timestamp default now()
);

-- A simple running list of savings "buckets" (e.g. "Emergency fund", "Trip
-- fund") with an amount each — not transactional, just what they currently
-- have set aside.
create table if not exists personal_savings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete cascade,
    name text not null,
    amount numeric not null,
    created_at timestamp default now()
);
create index if not exists idx_personal_savings_user on personal_savings(user_id);

-- Income entries (allowance from home, a part-time job payout, etc.), dated
-- so monthly income can be computed for the savings-rate stat.
create table if not exists personal_income (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete cascade,
    name text not null,
    amount numeric not null,
    received_on date not null default current_date,
    created_at timestamp default now()
);
create index if not exists idx_personal_income_user on personal_income(user_id);

-- Debts owed (a friend, a loan, a credit line) with a paid/unpaid toggle.
create table if not exists personal_debts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete cascade,
    name text not null,
    amount numeric not null,
    paid boolean default false,
    created_at timestamp default now()
);
create index if not exists idx_personal_debts_user on personal_debts(user_id);
