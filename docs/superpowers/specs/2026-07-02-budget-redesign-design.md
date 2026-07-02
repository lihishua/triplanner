# Budget Redesign — Design Spec
_Date: 2026-07-02_

## Overview

Replace the flat expense list + category breakdown with a three-drawer envelope system. Each drawer has a **planned** amount and an **actual** total built from a list of logged expenses. The page becomes the single place to plan trip spending and track it against reality.

---

## Three Drawers

### 1. One-off Expenses
**Icon:** price-tag SVG (stroke, 20×20)

One-time costs that don't repeat daily. Booked flights are **auto-imported** as read-only line items (pulled from the `flights` table where `booked = true` and `price` is non-empty). The user can add additional manual entries (tour pre-paid, gear, visa fee, etc.).

- **Planned** = sum of all line items (auto + manual)
- **Actual** = same line items (no separate actual for one-offs — the expense IS the actual)
- Planned and actual are therefore always equal for this drawer; the value is seeing the itemised list and knowing the fixed commitment

> **Note:** Because planned = actual here, the progress bar is omitted for this drawer. It shows only the itemised list and a total.

### 2. Daily Budget
**Icon:** sun SVG (stroke, 20×20)

Per-country daily envelope. For each country in the trip (from the Countries tab, ordered the same way):

- **Daily rate** — user sets a number (stored in `countries.daily_budget`)
- **Planned** = `daily_budget × planned_days` (uses `countries.planned_days`)
- If `planned_days` is 0 or unset, planned shows "— set days in country"
- **Actual** = sum of expenses logged under that country

Each country is its own sub-section within this drawer. Collapsed by default if actual = 0, expanded if any expenses logged.

### 3. Contingency Budget
**Icon:** umbrella SVG (stroke, 20×20)

Safety-net buffer for unexpected costs.

- **Planned** = one number the user sets (stored in `trips.contingency_budget`)
- **Actual** = sum of logged expenses in this drawer
- Progress bar shows actual / planned, turns red if over

---

## Expense Rows

Every expense entry (in drawers 1 manual, 2, and 3) shares the same row layout:

```
[description] .................. [amount]  ×
```

- Tap the row → opens edit modal (pre-filled description + amount)
- × button → deletes immediately (no confirmation)
- Booked-flight rows in drawer 1 are **read-only** — no edit, no delete (managed from Flights tab)

---

## Page Layout

```
┌─────────────────────────────────────────────────┐
│  Budget                                          │
│  Total planned $8,200  ·  actual $3,100          │
│  ████████████░░░░░░░░░░░░░░░░  (progress bar)   │
└─────────────────────────────────────────────────┘

┌── [tag icon] One-off Expenses ─────── $2,340 ──┐
│  El Al TLV → CMB (auto) .............. $820     │
│  Air India CMB → GOA (auto) .......... $310     │
│  Surfing course ...................... $180  ×   │
│  + Add expense                                   │
└─────────────────────────────────────────────────┘

┌── [sun icon] Daily Budget ──────────── planned $4,360 · actual $2,800 ──┐
│                                  ████████████░░░░░░░  │
│  ▾ Sri Lanka   $60/day × 20d = $1,200   actual $980   │
│      Galle hotel stay ............. $400  ×            │
│      Food & transport ............. $580  ×            │
│      + Add expense                                     │
│                                                        │
│  ▾ India   $40/day × 31d = $1,240   actual $1,820      │  ← over! red
│      Flights within India ......... $210  ×            │
│      ...                                               │
│      + Add expense                                     │
│                                                        │
│  ▸ Thailand   $50/day × 14d = $700   actual $0         │  ← collapsed
└────────────────────────────────────────────────────────┘

┌── [umbrella icon] Contingency Budget ─── planned $500 · actual $300 ──┐
│                              ████████████░░░░░░         │
│  Pharmacy ....................  $80  ×                   │
│  Lost luggage tag ............  $40  ×                  │
│  Emergency taxi ..............  $180  ×                 │
│  + Add expense                                          │
│  [Set planned amount]                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model

### DB changes (migrations)

```sql
-- Add daily budget rate to countries
ALTER TABLE countries ADD COLUMN IF NOT EXISTS daily_budget NUMERIC;

-- Add contingency planned amount to trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS contingency_budget NUMERIC;

-- Repurpose existing expenses table with drawer tagging
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS drawer TEXT NOT NULL DEFAULT 'oneoff';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id) ON DELETE SET NULL;
-- 'drawer' values: 'oneoff' | 'daily' | 'contingency'
-- country_id is non-null only when drawer = 'daily'
```

Existing expense rows (old categories) are abandoned in place — user confirmed no data worth migrating.

### Module-level state additions

```javascript
// already exists: let expenses = [];
// already exists: let budgetTarget = null; // repurposed for contingency_budget
// (budgetTarget.contingency_budget replaces budgetTarget.total_budget)
```

`refreshAll()` already fetches `expenses` and `budget_settings` — no new fetches needed. `countries` already fetched and includes `daily_budget` once column is added. `trips` already fetched via `loadPreferences()` which can also read `contingency_budget`.

---

## SVG Icons

All icons are 20×20, `stroke="currentColor"`, `fill="none"`, `stroke-width="1.5"`, `stroke-linecap="round"` `stroke-linejoin="round"`.

**One-off (price tag):**
```svg
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2H7a2 2 0 0 0-1.41.59L2.59 6.59A2 2 0 0 0 2 8v5a2 2 0 0 0 .59 1.41l7 7a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.82l-7-7A2 2 0 0 0 12 2z"/>
  <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/>
</svg>
```

**Daily Budget (sun):**
```svg
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
</svg>
```

**Contingency (umbrella):**
```svg
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>
</svg>
```

---

## Progress Bars

Each drawer with a planned amount shows a horizontal bar:
- `width = min(actual / planned, 1) * 100%`
- Normal colour: `var(--accent)`
- Over budget: `var(--red)` (add `--red: #e05252` to CSS variables if not present)
- No bar shown for drawer 1 (One-off Expenses) since planned = actual

---

## Collapse / Expand (Daily Budget sub-sections)

Per-country sections in the Daily Budget drawer are individually collapsible. State is in-memory only (resets on reload) — no persistence needed.

- Default: **expanded** if `actual > 0`, **collapsed** if no expenses yet
- Tap the country header row to toggle
- Arrow indicator: ▾ expanded, ▸ collapsed

---

## Add / Edit Expense Modal

Single modal `ov-expense` (repurpose existing) with:
- Description text input
- Amount number input
- Hidden fields: `drawer`, `country_id` (set programmatically when opening)
- Save / Cancel buttons

Edit: pre-fill fields, update existing row on save.
Add: insert new row.

The modal does **not** show a drawer or country picker — those are set by which "+ Add expense" button the user tapped.

---

## Inline Editing for Rates and Contingency

- **Daily rate per country**: shown inline in the country header as a tappable number. Tap → small input appears in place, blur/enter saves to `countries.daily_budget`.
- **Contingency planned**: shown as a tappable number below the drawer header. Same inline-edit pattern.

---

## Out of Scope

- Currency conversion
- Per-country currency settings
- Budget sharing / splitting between trip members
- Export to spreadsheet
- The old `budget_settings.total_budget` and `base_currency` fields (abandoned in place)
