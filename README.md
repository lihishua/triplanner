# Wayfare — setup

A shared trip planner for two people. Front end is static; Supabase provides
auth + Postgres + the AI edge function.

## Files
```
web/index.html     front end shell
web/app.js         all logic (auth, sync, map, weather, AI)
web/config.js      <- paste your Supabase URL + anon key here
supabase/schema.sql                       run once in SQL editor
supabase/functions/investigate/index.ts   AI briefing (Claude), runs server-side
```

## 1. Supabase project
1. Create a project at supabase.com.
2. SQL editor → paste **schema.sql** → run. This creates tables + RLS.
   Then paste **budget.sql** → run, to add the Budget tables.
3. Project Settings → API → copy the **Project URL** and **anon public key**
   into `web/config.js`.

## 2. Both of you sign up
- Deploy the front end (below) or run locally, then each of you hits **Sign up** once.
- Auth → Providers: email is on by default. For just the two of you, you can
  turn **off** "Confirm email" (Auth → Providers → Email) to skip the confirm step.

## 3. Create the shared trip (one time)
After both accounts exist, open SQL editor and run the commented block at the
bottom of `schema.sql`, replacing the two emails with yours. This makes one
trip and adds you both as members — that's what makes you see the same data.

## 4. AI "Investigate" feature
```
# Supabase CLI:
supabase functions deploy investigate
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
```
Get the key from console.anthropic.com → API keys. Billed per use (a briefing
is a few cents at most). Until this is deployed, the button shows a friendly
"not reachable yet" message instead of breaking.

## 5. Deploy the front end
Any static host. The `web/` folder is the root.
- Netlify / Vercel: drag-drop `web/`, or point at the repo with build command
  none and publish dir `web`.
- Or `cd web && python3 -m http.server` to try locally.

## Notes / honest limits
- The capture box files a **typed** place + optional link. The browser can't
  read the contents of an Instagram URL (Instagram blocks cross-site fetches),
  so you type "Hoi An, Vietnam" and paste the link to keep alongside it.
  Geocoding (the map pin) is automatic via OpenStreetMap.
- Weather is live from Open-Meteo (no key needed).
- The anon key in config.js is meant to be public; your data is protected by
  the Row-Level Security policies, not by hiding the key.
- Budget page: add expenses with category + optional country tag, set an
  overall target, see a spend meter and a per-category breakdown.
  **Currency caveat:** amounts are summed as entered and NOT converted between
  currencies. For the total/meter to be meaningful, keep expenses in one
  currency (or treat the number as a rough mixed figure). Live FX conversion
  would be a later add (free rates API + a chosen base currency).
```
