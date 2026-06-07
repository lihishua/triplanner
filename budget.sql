-- ============================================================
--  Wayfare — Budget add-on
--  Run this in the Supabase SQL editor AFTER schema.sql.
--  Safe to run on an existing database; it only adds new things.
-- ============================================================

create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  country_id   uuid references countries(id) on delete set null,  -- optional tag
  label        text not null,
  amount       numeric(12,2) not null default 0,
  currency     text not null default 'USD',
  category     text not null default 'Other',   -- Flights, Lodging, Food, Transport, Activities, Nanny, Other
  spent_on     date,
  notes        text,
  created_at   timestamptz not null default now()
);

-- optional planned budget per trip (a single target number)
create table if not exists budget_settings (
  trip_id        uuid primary key references trips(id) on delete cascade,
  total_budget   numeric(12,2),
  base_currency  text not null default 'USD'
);

alter table expenses        enable row level security;
alter table budget_settings enable row level security;

create policy expenses_all on expenses for all
  using ( is_trip_member(trip_id) ) with check ( is_trip_member(trip_id) );
create policy budget_set_all on budget_settings for all
  using ( is_trip_member(trip_id) ) with check ( is_trip_member(trip_id) );
