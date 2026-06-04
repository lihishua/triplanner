# TriPlanner

A shared trip planner. Plan countries, cities, flights and budget together — or solo in guest mode (no account needed, data stays local).

## Stack
- Vanilla JS + HTML/CSS, no build step
- Supabase — auth, Postgres, Edge Function (AI)
- Leaflet — map
- Open-Meteo — weather (free, no key)
- Anthropic Claude — "Investigate with AI" (optional, server-side only)

## Setup

### 1. Supabase project
1. Create a project at [supabase.com](https://supabase.com)
2. SQL Editor → run `schema.sql`, then run `budget.sql`
3. Authentication → Providers → Email → turn off **Confirm email** (easier for personal use)
4. Project Settings → API → copy **Project URL** and **anon/public key** into `config.js`

### 2. config.js
Copy `config.example.js` → `config.js` and fill in your values. This file is git-ignored.

### 3. Sign up & create a trip
- Open the app, sign up with your email + password
- Create your first trip (give it a name)
- To invite someone: they sign up, then enter your email + trip name to join

### 4. AI "Investigate" (optional)
The "Investigate with AI" button calls a Supabase Edge Function. To enable it:
```bash
supabase functions deploy investigate
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
```
Get the key from [console.anthropic.com](https://console.anthropic.com) → API Keys.
Until deployed, the button shows a friendly message instead of breaking.

### 5. Run locally
```bash
python3 -m http.server
# or open index.html directly in a browser
```

### 6. Deploy
Any static host (Netlify, Vercel, GitHub Pages). No build step — the repo root is the publish directory.

## Guest mode
Click **Continue as guest** on the login screen — no account needed. All data is saved in your browser's localStorage only. AI investigate is not available in guest mode.

## Notes
- **Capture** — type a place name ("Hoi An, Vietnam") and optionally paste an Instagram link. Geocoding is automatic via OpenStreetMap.
- **Budget** — amounts are summed as entered, not converted between currencies. Keep expenses in one currency for the total to be meaningful.
- The Supabase anon key in `config.js` is safe for the browser — your data is protected by Row-Level Security, not by hiding the key.
