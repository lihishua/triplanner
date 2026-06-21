# Update Center — Design Spec

Date: 2026-06-21

## Problem

TriPlanner has a partial Activity Feed (`trip_activity` table, `app.js:1805-1883`): it logs flight/place/todo additions and shows a dismissible banner grouped by author, with a 7-day cutoff. It has gaps:

- No tracking when a country is added.
- Each event is shown raw (e.g. one line per flight), not summarized ("3 options to Colombo").
- Once dismissed, there's no way to see it again.
- Clicking an item only switches tabs — it doesn't navigate to the specific thing that changed.

Goal: when one partner opens the app, they get an in-app (no push) summary of what the other partner added since their last visit, grouped by category, with each line clickable to jump straight to that item. They can navigate away and get back to the same summary via a persistent header icon.

This is a two-person trip (per existing project context) — the digest only ever needs to represent "what did the other member add," never a multi-author breakdown.

## Non-goals

- Push notifications (explicitly excluded).
- Editing or deleting activity from the digest.
- Multi-author grouping within a category (out of scope; only two trip members exist).
- Fixing the pre-existing gap where chat-suggestion confirmation never actually creates a `places` row (separate bug, not introduced or fixed here).

## Data model changes

`features.sql` — add one nullable column to the existing table:

```sql
alter table trip_activity add column if not exists meta jsonb;
```

`meta` is only populated for `action = 'added_flight'`, storing `{origin, destination}` so the digest can group flights by destination without parsing the human-readable `summary` string. No other action type needs it.

New action type: `added_country`. Logged once, centrally, inside `ensureCountry()` (`app.js:234`) — the single function that actually inserts a new `countries` row — instead of being scattered across (or missing from) the three call sites that create countries today:

- Capture flow's country-only path (`app.js:377`) — currently logs nothing.
- `addSuggestedCountry` (`app.js:546`) — currently logs nothing.
- `confirmSuggestion` (`app.js:1628`) — currently logs `'confirmed_suggestion'` typed as `'place'`, which is wrong: that function only ever calls `ensureCountry`, it never creates a `places` row. This call is deleted; `ensureCountry`'s new centralized log covers it.

## Capturing `entity_id` for navigation

Three insert call sites currently discard the inserted row, so there's no id to navigate to later. Add `.select().single()` and pass the id through to `logActivity`:

- `saveFlight` (`app.js:790-813`) — pass the new flight's id, plus `meta:{origin, destination}`.
- The Capture place-insert (`app.js:391-397`) — pass the new place's id.
- `saveTodo` (`app.js:1694-1708`) — pass the new todo's id.

`ensureCountry`'s insert already uses `.select().single()`, so `data.id` is already available there.

## Digest source query

Replace `loadActivityBanner`'s logic. Source set: rows in `trip_activity` for this trip where:
- `user_email` is **not** the viewing user's email (only show what the other partner did), and
- the viewer's user id is **not** in `seen_by`.

No time-window cutoff (the old 7-day limit is removed) — "unseen" now precisely means "since they last closed the Update Center," which is the semantics requested. Order by `created_at` ascending within each group for stable phrasing, cap fetch at the existing `.limit(20)` (newest 20) as a defensive bound, e.g. for a brand-new member with no prior `seen_by` history at all.

## Digest grouping & phrasing

Four fixed categories, always rendered in this order, always all four (confirmed): **Flights, Countries, Places, Todos**. Empty category renders `No new {category}.` (lowercase category name), e.g. `No new places.`

**Flights** (`entity_type = 'flight'`) — group by `meta.destination`:
- exactly 1 flight to that destination: `added one flight from {origin} to {destination}`
- 2+ flights to that destination: `added {N} options to {destination}`
- Per-destination clauses joined with `, `, author name prefixed once:
  `Lihi added 3 options to Colombo, added one flight from Vietnam to Perth.`

**Countries** (`entity_type = 'country'`) — list of newly added country names:
- 1: `Lihi added {Country}`
- 2+: `Lihi added {A}, {B}`
- Known simplification: no grammatical article handling. "Philippines" renders as `added Philippines`, not `added the Philippines`. Accepted trade-off — not special-casing country grammar.

**Places** (`entity_type = 'place'`):
- 1: `added {place}, {country}`
- 2+: `added {N} new places: {a}, {b}`

**Todos** (`entity_type = 'todo'`):
- `added: {title1}, {title2}, {title3}`
- Titles rendered with `dir="auto"` so Hebrew/RTL titles display correctly.

Each category's bullet(s) carry enough data client-side (the underlying `entity_id`s for that group) to support click-to-navigate, without needing new DB columns — the grouping happens at render time from the fetched rows already in memory.

## UI

**Header bell** — new ghost button in `.top-actions`, before "Log out": `🔔 Updates`, with a small dot badge shown whenever the unseen source set is non-empty. Always present (not conditionally hidden), per earlier decision. Clicking opens the Update Center with the current digest — same content the auto-popup would show, since nothing has been marked seen between auto-popup and a manual reopen unless the user explicitly closed it.

**Update Center modal** (`ov-updates`, following the existing `.overlay > .modal` pattern used by `ov-todo`/`ov-detail`): title "Updates", the four category sections in order, and a single `Got it` button at the bottom. `Got it` is the *only* action that marks the current source-set rows as seen (adds the viewer's id to each row's `seen_by`) and closes the modal. Closing via ✕/backdrop hides the modal without marking anything seen — reopening via the bell shows the identical digest.

**Auto-popup** — after `refreshAll()` in `init()`, if the unseen source set is non-empty, open `ov-updates` automatically. This replaces today's banner (`#activity-banner` markup in `index.html:366-367`, and `loadActivityBanner`/`dismissBanner`/`navigateToActivity` in `app.js`) entirely — old banner code is removed, not kept alongside the new modal.

## Click-to-navigate behavior

Clicking a bullet never closes the modal and never marks anything seen — the user must be able to navigate away and return via the bell to the same digest.

- **Flight bullet** → `showTab('flights')`, scroll to the first matching card, add a brief pulse-highlight CSS class to every card whose id is in that destination's group. Requires adding `data-id="${f.id}"` to flight cards (`app.js:752`, not present today).
- **Country bullet** → `openCountry(entity_id)` directly. Already the exact detail view; no extra highlighting needed.
- **Place bullet** → `openCountry(place.country_id)`, then scroll/highlight the matching `.place-item` row inside the now-open modal. Requires adding `data-id="${p.id}"` to place rows (`app.js:578`, not present today).
- **Todo bullet** → `showTab('prep')`, scroll/highlight the matching `.todo-item`. Requires adding `data-id="${t.id}"` to todo rows (`app.js:1664`, not present today).

## Edge cases

- **Brand-new member / first visit ever**: no prior `seen_by` history exists, so everything currently in `trip_activity` for the trip is technically unseen. Capped by the existing `.limit(20)` (newest 20 rows) so this doesn't dump the full trip history into one digest.
- **Guest mode**: untouched. `logActivity` already no-ops under `GUEST_MODE`, so the digest is simply never populated/shown — consistent with guest mode having no second user to summarize.

## Testing approach

Manual verification (this is a 2-person personal app with no test suite):
1. As user A, add a country, two flights to the same destination, one flight elsewhere, a place, and a todo with a Hebrew title.
2. Log in as user B — confirm the auto-popup shows all four categories with correctly grouped/phrased bullets, and "No new places" if no place was added in that pass.
3. Click each bullet type, confirm navigation lands on/highlights the right item, and the modal is not auto-closed or marked seen by navigating.
4. Reopen via the bell — confirm identical digest persists.
5. Click "Got it" — confirm the bell's dot clears, and reopening shows the all-four "no new X" empty state.
6. Repeat as user A to confirm the filter correctly excludes the viewer's own additions.
