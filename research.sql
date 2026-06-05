-- ============================================================
--  Flight research scratchpad
--  Run in Supabase SQL editor AFTER schema.sql.
-- ============================================================

create table if not exists flight_research (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  content     text,
  image_url   text,
  link_url    text,
  link_label  text,
  created_at  timestamptz not null default now()
);

alter table flight_research enable row level security;
create policy research_all on flight_research for all
  using ( is_trip_member(trip_id) ) with check ( is_trip_member(trip_id) );

-- ============================================================
--  Supabase Storage bucket for research images.
--  Run this too, or create via dashboard:
--  Storage → New bucket → name "research" → toggle Public on.
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('research', 'research', true)
  on conflict do nothing;

create policy "Authenticated users can upload research images"
  on storage.objects for insert
  with check (bucket_id = 'research' and auth.uid() is not null);

create policy "Anyone can view research images"
  on storage.objects for select
  using (bucket_id = 'research');

create policy "Users can delete their own research images"
  on storage.objects for delete
  using (bucket_id = 'research' and auth.uid() = owner);
