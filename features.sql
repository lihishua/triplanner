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

-- Update Center: structured grouping data (currently only used by 'added_flight')
alter table trip_activity add column if not exists meta jsonb;

-- Mark a flight as actually booked, vs. still an option you're considering
alter table flights add column if not exists booked boolean not null default false;

-- Feature 4: Hotels (liked or booked, per country)
create table if not exists hotels (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  country_id  uuid not null references countries(id) on delete cascade,
  name        text not null,
  link        text,
  price       text,
  notes       text,
  booked      boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table hotels enable row level security;
create policy hotels_all on hotels for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

-- Feature 5: Prep tabs (split the pre-trip checklist into categories)
alter table trip_todos add column if not exists category text not null default 'todos';

create table if not exists prep_tabs (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
alter table prep_tabs enable row level security;
create policy prep_tabs_all on prep_tabs for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

-- Feature 7: Hotels linked to a specific city/place
alter table hotels add column if not exists place_id uuid references places(id) on delete set null;

-- Feature 6: Shareable invite link to join a trip (alongside email+trip-name join)
alter table trips add column if not exists invite_token uuid not null default gen_random_uuid();

create or replace function join_trip_by_token(p_token uuid)
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid;
begin
  select id into v_trip_id from trips where invite_token = p_token;
  if v_trip_id is null then
    raise exception 'Invalid or expired invite link.';
  end if;
  insert into trip_members(trip_id, user_id) values (v_trip_id, auth.uid())
  on conflict do nothing;
  return v_trip_id;
end;
$$;
