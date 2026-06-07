-- ============================================================
--  Wayfare schema  —  run this in Supabase SQL editor
-- ============================================================
-- Model: one shared "trip". Both partners are members of it.
-- Everyone who is a member can read/write the trip's data.
-- This is what makes you both see the same thing.

-- ---------- trips ----------
create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our trip',
  created_at  timestamptz not null default now()
);

-- ---------- membership (who can access which trip) ----------
create table if not exists trip_members (
  trip_id  uuid references trips(id) on delete cascade,
  user_id  uuid references auth.users(id) on delete cascade,
  primary key (trip_id, user_id)
);

-- ---------- countries ----------
create table if not exists countries (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  name        text not null,
  flag        text,
  best_time   text,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ---------- places (pins on the map) ----------
create table if not exists places (
  id          uuid primary key default gen_random_uuid(),
  country_id  uuid not null references countries(id) on delete cascade,
  trip_id     uuid not null references trips(id) on delete cascade,
  name        text not null,
  lat         double precision,
  lng         double precision,
  notes       text,
  source_url  text,                       -- e.g. the instagram link
  ai_notes    text,                       -- filled by the investigate function
  created_at  timestamptz not null default now()
);

-- ---------- flights ----------
create table if not exists flights (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  origin      text,
  destination text,
  airline     text,
  flight_no   text,
  depart_date text,
  depart_time text,
  price       text,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ============================================================
--  Row-Level Security:  a user sees a row only if they are a
--  member of that row's trip.
-- ============================================================
alter table trips         enable row level security;
alter table trip_members  enable row level security;
alter table countries     enable row level security;
alter table places        enable row level security;
alter table flights       enable row level security;

-- helper: is the current user a member of this trip?
create or replace function is_trip_member(t uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from trip_members m
    where m.trip_id = t and m.user_id = auth.uid()
  );
$$;

-- trips: members can see/update their trip
create policy trips_select on trips for select using ( is_trip_member(id) );
create policy trips_update on trips for update using ( is_trip_member(id) );

-- trip_members: you can see membership rows for trips you belong to
create policy members_select on trip_members for select using ( is_trip_member(trip_id) );

-- data tables: full access for members of the owning trip
create policy countries_all on countries for all
  using ( is_trip_member(trip_id) ) with check ( is_trip_member(trip_id) );
create policy places_all on places for all
  using ( is_trip_member(trip_id) ) with check ( is_trip_member(trip_id) );
create policy flights_all on flights for all
  using ( is_trip_member(trip_id) ) with check ( is_trip_member(trip_id) );

-- ============================================================
--  RPC functions (run these after the tables above)
-- ============================================================

-- Create a trip and add the current user automatically
create or replace function create_my_trip(p_name text)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into trips(name) values (trim(p_name)) returning id into v_id;
  insert into trip_members(trip_id, user_id) values (v_id, auth.uid());
  return v_id;
end;
$$;

-- Join a trip by matching the owner's email + trip name
create or replace function join_trip_by_invite(p_email text, p_trip_name text)
returns uuid language plpgsql security definer as $$
declare
  v_owner_id uuid;
  v_trip_id  uuid;
begin
  select id into v_owner_id from auth.users where lower(email) = lower(trim(p_email));
  if v_owner_id is null then
    raise exception 'No account found with that email.';
  end if;

  select t.id into v_trip_id
  from trips t join trip_members m on m.trip_id = t.id
  where m.user_id = v_owner_id and lower(t.name) = lower(trim(p_trip_name))
  limit 1;

  if v_trip_id is null then
    raise exception 'No trip named "%" found for that user.', p_trip_name;
  end if;

  insert into trip_members(trip_id, user_id) values (v_trip_id, auth.uid())
  on conflict do nothing;

  return v_trip_id;
end;
$$;

-- ============================================================
--  One-time setup helper.
--  After BOTH of you have signed up once (so you exist in
--  auth.users), run this block ONCE to create the shared trip
--  and add both of you to it. Replace the two emails.
-- ============================================================
-- do $$
-- declare new_trip uuid;
-- begin
--   insert into trips(name) values ('Our family trip') returning id into new_trip;
--   insert into trip_members(trip_id, user_id)
--     select new_trip, id from auth.users
--     where email in ('you@example.com', 'husband@example.com');
-- end $$;
