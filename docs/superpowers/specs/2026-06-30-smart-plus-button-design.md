# Smart "+" Button — Design Spec
_Date: 2026-06-30_

## Overview

Replace the existing FAB "Capture a place" button with a universal smart input that accepts free text, URLs, and images in any language, classifies the content with AI, and routes it to the correct section of the app after a confirmation step.

---

## FAB Visibility

The `+` FAB is **only visible on the Countries tab**. When the user switches to Flights, Budget, or Prep — each of which has its own section-specific add controls — the FAB is hidden. Implemented as a single `display:none` toggle inside `showTab()`.

---

## Input Modal (`ov-smart-input`)

Replaces the old "Capture a place" modal as the FAB target. The old `ov-capture` overlay remains in the codebase for direct hotel/place flows that still use it internally.

**Input state:**
- Single `<textarea>` with placeholder: _"Paste a link, type a note, describe a flight… anything"_
- Image attach button (📎) — opens file picker; also listens for `⌘V` / `Ctrl+V` paste of images anywhere inside the modal
- Thumbnail preview once an image is attached
- ✓ button to submit, Cancel button

**Thinking state:**
- Textarea + ✓ button replaced by "thinking…" status text
- Cancel still available

**Confirmation state (same modal, body replaced):**
- Summary sentence from AI (e.g. _"Flight TLV → BKK on Aug 12. Adding to flight research."_)
- **Flights only:** "Booked?" checkbox — if checked, OK pre-fills and opens the flight form instead of saving to research
- **Todos / prep items:** destination picker (pill row or dropdown) showing all prep tabs — Todos, Drugs & First Aid, Shopping List, plus any custom tabs — defaulting to AI's best guess
- **Hotels:** notes if country/city will be auto-created (_"will create Thailand → Bangkok"_)
- OK button (saves) and Cancel button (discards, no save)

---

## `smart-parse` Edge Function

**File:** `supabase/functions/smart-parse/index.ts`

**Input:**
```json
{
  "text": "optional free text or URL",
  "imageBase64": "optional base64 image string",
  "tripContext": {
    "countries": ["Thailand", "Vietnam"],
    "prepTabs": [
      { "id": "todos", "name": "Todos" },
      { "id": "first_aid", "name": "Drugs & First Aid" },
      { "id": "shopping", "name": "Shopping List" }
    ]
  }
}
```

**Output:**
```json
{
  "type": "flight | hotel | place | todo | unknown",
  "summary": "Human-readable sentence describing what was parsed",
  "destination": "flight_research | hotels | countries | todos | first_aid | shopping | <custom-tab-id>",
  "extractedData": { }
}
```

**`extractedData` by type:**
- `flight`: `{ origin, destination, depart_date, depart_time, airline, flight_no, price, notes }`
- `hotel`: `{ name, city, country, link }`
- `place`: `{ name, country }`
- `todo`: `{ text }`
- `unknown`: `{}`

Claude is called **once** with all inputs combined (text + image + URL in a single message) so it has full context. Uses `claude-haiku-4-5-20251001` for cost efficiency, same as `parse-link`. `tripContext` is embedded in the prompt so Claude can match existing country names and suggest the right prep tab.

---

## Front-End Flow

1. User taps `+` → `openSmartInput()` opens `ov-smart-input` in input state
2. User enters text / URL / attaches image → taps ✓
3. Front-end invokes `smart-parse` with `{ text, imageBase64, tripContext }` — modal enters thinking state
4. On success → modal enters confirmation state with AI summary + controls
5. User optionally adjusts destination, checks "Booked?" for flights
6. Taps OK → routes to correct save function:
   - `flight_research` → existing research-save logic (adds a research card)
   - `flight_booked` (Booked checked) → `openFlight()` pre-filled with `extractedData`
   - `hotels` → existing hotel-save logic via `ensureCountry()` + `ensurePlace()`
   - `countries` → `ensureCountry()`
   - `todos` / any prep tab → insert into `trip_todos` with `category` set to the chosen tab id
7. Taps Cancel → closes modal, nothing saved

---

## Out of Scope

- Budget entries (no AI classification for budget items in this iteration)
- Multi-item parsing (one item per submission)
- Offline / guest-mode AI parsing (falls back gracefully — shows error, user cancels)
