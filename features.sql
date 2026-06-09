-- ============================================================
--  TriPlan — new features (run after schema.sql)
-- ============================================================

-- Feature 1: Planning chat history
create table if not exists trip_chat (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  suggestions jsonb,          -- [{name, type, description, country, confirmed}]
  created_at  timestamptz not null default now()
);
alter table trip_chat enable row level security;
create policy chat_all on trip_chat for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

-- Feature 2: Pre-trip TODO list
create table if not exists trip_todos (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  title      text not null,
  deadline   date,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table trip_todos enable row level security;
create policy todos_all on trip_todos for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

-- Feature 3: Activity feed
create table if not exists trip_activity (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  user_email  text,
  action      text not null,    -- 'added_flight', 'added_place', 'added_todo'
  summary     text not null,    -- human-readable: "TLV → BKK · Emirates"
  entity_type text,
  entity_id   text,
  seen_by     jsonb not null default '[]',
  created_at  timestamptz not null default now()
);
alter table trip_activity enable row level security;
create policy activity_all on trip_activity for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
