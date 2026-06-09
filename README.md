# TriPlan

Plan your trip together — or solo.

Collect countries and places, track flights, manage your budget, and watch your route animate on a globe. No clutter, no complicated setup.

## What you can do

**Countries & places** — Add countries you want to visit. Click a country to set how many days you plan to spend there, add specific places inside it (cities, parks, restaurants, beaches — anything), and set individual time estimates per place. If your places exceed your country total, the app warns you and offers to fix it.

**✦ Plan** — Claude reads your entire trip (countries, places, planned days, flights) and gives you a timeline recommendation — suggested order, date ranges, gaps to fix, and places worth adding.

**▶ Preview trip** — A fullscreen animated globe. Your confirmed flights play one by one: an arc draws from city to city, a dot travels the route, and a card shows the airline, date, and price per person.

**Flights** — Log every confirmed leg. Click a flight to edit it. From/To fields auto-suggest airport codes as you type a city name.

**Research** — A scratchpad for flight options you're considering. Paste a screenshot and Claude extracts the flights automatically (airline, times, stops, price). Add the ones you like directly to your trip with one click.

**Budget** — Add expenses by category and country, set a total target, see a spend meter and per-category breakdown.

**AI briefing** — Tap "Investigate" on any place for a practical briefing on what to do there.

**Shared trips** — Create a trip, share the name, your travel partner joins instantly by entering your email + trip name. Everything syncs in real time.

**Guest mode** — No account needed. Jump in and plan — data stays on your device.

**Multiple trips** — Each trip has its own name. Start a new one next year, with different people, without touching the old one.

## Tech
Vanilla JS · Supabase (auth + Postgres + storage) · Mapbox GL JS (globe preview) · Anthropic Claude (AI features) · Open-Meteo (weather) · OpenStreetMap (geocoding)

## Setup
1. Fill in `config.js` with your Supabase project URL and anon key
2. Run `schema.sql` → `budget.sql` → `research.sql` in the Supabase SQL editor
3. Run the three `ALTER TABLE` migrations (planned_days on countries + places, extracted_flights on flight_research)
4. Deploy the edge functions: `supabase functions deploy investigate && supabase functions deploy extract-flight && supabase functions deploy plan-trip`
5. Set `ANTHROPIC_API_KEY` as a Supabase secret
