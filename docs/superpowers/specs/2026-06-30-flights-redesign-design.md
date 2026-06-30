# Flights Section Redesign — Design Spec
_Date: 2026-06-30_

## Overview

Replace the current flat flight list + separate research section with a single grouped-by-leg view. All flights are options for a leg; booking one deletes the rest. Legs are ordered west→east geographically and can be dragged to reorder.

---

## Data Model

### New column: `leg_order TEXT` on `trips` table

Stores a JSON array of leg keys, e.g. `["TLV-BKK","BKK-SYD","SYD-MEL"]`.

- A **leg key** is `"{originIATA}-{destinationIATA}"` where both codes are resolved via the existing `AIRPORTS` lookup (uppercase trimmed text fallback if not found in AIRPORTS).
- When `leg_order` is null or a new leg appears not yet in the saved array, it is appended in west→east order (by origin longitude — see Section 4).
- The `flights` table is **unchanged**. No migration beyond adding the `leg_order` column.

---

## Flights Page Layout

### Removed
- The Research section and its `+ Add note` button are removed from the Flights page.
- The `flight_research` data remains in the DB (used by the smart `+` FAB) but is no longer rendered on the Flights page.

### Page header
- Single `+ Add flight` button (unchanged, opens existing flight form modal).

### Leg groups
Each leg renders as:

```
┌─────────────────────────────────────────────────┐
│ ISRAEL (TLV) → SRI LANKA (CMB)             ⠿   │  ← leg header, draggable via handle
├─────────────────────────────────────────────────┤
│ ☐ Booked  El Al · LY28 · Aug 12 · $420   ✏ ×  │  ← flight card
│ ☐ Booked  Emirates via DXB · $310         ✏ ×  │
└─────────────────────────────────────────────────┘
```

**Leg header:** full country name (from AIRPORTS lookup) + IATA code for both origin and destination. Drag handle (⠿) on the right.

**Flight cards within a leg:**
- Left: Booked checkbox
- Middle: airline, flight no., date, price (compact single line)
- Right: edit button (✏, opens flight form pre-filled) and delete × button
- Tapping the card body (not checkbox, not ✏, not ×) also opens the edit form
- Cards within a leg are ordered by `created_at` (date added, ascending)

**Empty state:** "No flights yet. Tap + to add your first leg."

---

## Booking Confirmation + Deletion

When the user checks Booked on a flight that has sibling options in the same leg:

1. Confirmation prompt: **"Congrats! 🎉 I'll now delete all other options for this leg. OK?"** with OK and Cancel buttons.
2. **OK:** save `booked = true` on the checked flight, then delete all other flights in the same leg from Supabase / localStorage.
3. **Cancel:** revert the checkbox to unchecked, no changes saved.

If the leg has only one flight (no siblings), checking Booked skips the confirmation and saves immediately.

Un-booking (unchecking Booked on an already-booked flight) saves `booked = false` — no deletion prompt.

---

## West→East Geographic Ordering

### IATA_LON lookup

A small hardcoded object mapping IATA codes to approximate longitude, covering the airports most likely in this app (~40 entries):

```js
const IATA_LON = {
  TLV: 34.9, AMM: 35.9, CAI: 31.4, IST: 28.8, DXB: 55.4, DOH: 51.6,
  MCT: 58.3, KTM: 85.4, DEL: 77.1, BOM: 72.9, CMB: 79.9, MAA: 80.3,
  BLR: 77.7, COK: 76.3, CCU: 88.4, HYD: 78.5, DAD: 108.2, HAN: 105.8,
  SGN: 106.7, PNH: 104.8, REP: 103.8, BKK: 100.7, DMK: 100.6, HKT: 98.3,
  CNX: 99.0, USM: 100.1, KUL: 101.7, LGK: 99.7, SIN: 103.9, RGN: 96.1,
  MNL: 121.0, CEB: 124.0, DPS: 115.2, CGK: 106.7, NRT: 140.4, HND: 139.8,
  KIX: 135.4, FUK: 130.5, OKA: 127.6, ICN: 126.4, TPE: 121.2,
  SYD: 151.2, MEL: 144.8, BNE: 153.0, AKL: 174.8,
};
```

For IATA codes not in `IATA_LON`, longitude defaults to `0` (placed at middle of order).

### Default sort

When computing default leg order (no saved `leg_order`, or new legs not yet in it):
- Resolve each leg's origin to an IATA code
- Sort legs by `IATA_LON[originIata] ?? 0` ascending (west→east)
- Append to end of any existing saved order

### Globe animation

`chainFlightsAsRoute()` is updated to use the same west→east leg order (respecting saved `leg_order` if present) instead of its current date+chain logic, so the animated preview matches the list.

---

## Drag to Reorder Legs

- Drag uses native HTML5 `dragstart` / `dragover` / `drop` events (no library).
- Only the ⠿ drag handle triggers dragging — prevents accidental drags while scrolling.
- On drop: recompute the `leg_order` array, save immediately to `trips.leg_order` in Supabase (or localStorage in guest mode), re-render.

---

## IATA Normalization for Leg Grouping

When grouping flights into legs, each flight's `origin` and `destination` are resolved to an IATA code:

1. If the value is already a known IATA code (3-letter, found in `AIRPORTS`) → use it.
2. Otherwise search `AIRPORTS` for a city or airport name match → use the IATA code found.
3. If no match → uppercase trim the raw value and use as-is.

Two flights resolve to the same leg key if both their normalized origin and normalized destination match.

---

## Out of Scope

- Reordering individual flight options within a leg (date-added order only)
- Merging two separate legs into one
- The `flight_research` table is not deleted (still used by smart `+` FAB routing)
