# Country Recommendations — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan

## Summary

Add a **Recommendations** subsection to each country's detail view. Inside it, users
keep freeform lists of local recommendations — nannies, restaurants, drivers, etc.
When the user pastes a link, types a name, or attaches an image, the app sends it to
Claude, which understands the subject, picks the right list (creating one if none fits),
and files the item there. A quick-confirm chip lets the user correct a wrong guess in
one tap.

This reuses the existing Smart Import pattern (the `smart-parse` edge function and its
text/image classification plumbing) already used by the Prep section.

## Goals

- Per-country lists of recommendations, created automatically from what the user uploads.
- AI classifies each input (text / link / image) into the correct list.
- Lists are freeform: the AI names the category; a list exists the moment an item lands in it.
- Category-aware extraction: restaurants → name + city; people (nanny, driver) → name only;
  the original link/image is always attached.
- Nothing is ever lost — failures fall back to an "Unsorted" list.

## Non-goals

- No manual list creation/renaming UI (freeform categories make it unnecessary).
- No trip-wide (cross-country) recommendations — scope is per country.
- No contact-detail scraping beyond title + city (phone/address explicitly out for now).

## Approach

Extend the existing `smart-parse` Supabase edge function with a `recommendation` mode
rather than adding a new function. It already handles text + base64 images and the
"Asking Claude…" client plumbing; this keeps infra and behavior consistent.

## Data model

New `recommendations` table, mirroring `hotels`/`trip_todos` (including a GUEST_MODE
localStorage fallback):

| column        | type / notes                                                        |
|---------------|---------------------------------------------------------------------|
| `id`          | uuid, pk                                                            |
| `trip_id`     | fk → trips                                                          |
| `country_id`  | fk → countries (scopes the rec to a country)                       |
| `category`    | **freeform text**, e.g. `"drivers"`. A list = a distinct category. |
| `title`       | the name (restaurant name, nanny's name)                           |
| `city`        | text, nullable — filled only for place-type recs (restaurants)     |
| `link`        | text, nullable — original URL if pasted                            |
| `image_url`   | text, nullable — uploaded image (reuse existing `research` bucket) |
| `created_at`  | timestamptz                                                        |
| `created_by`  | user id                                                            |

- **No separate lists table.** Lists are derived from the distinct `category` values
  present for a country. The first item in a new category creates that list implicitly.
- Category grouping and AI list-reuse match **case-insensitively** (`"Drivers"` == `"drivers"`).
- RLS mirrors the other trip-scoped tables (members of the trip can read/write).

## UI (country detail overlay `ov-detail`)

A new **Recommendations** section, rendered below Hotels in `openCountry()`:

- **Capture row** (single entry point): text/link input + 📎 image button + "Add".
- **Grouped list**: recommendations grouped by category. Each group has a header with an
  auto-picked emoji for the category name (generic fallback) + the list name, e.g.
  `🍽 Restaurants`, `🚗 Drivers`, `👶 Nannies`.
- **Item card** (compact): title, city (if present), a 🔗/🖼 indicator, `×` to delete.
  Tapping the link/image opens it.
- **Empty state**: "Paste a link, name, or screenshot — I'll sort it into the right list."
- No tab-management UI: groups appear/disappear as items come and go.

## AI classify + quick-confirm flow

1. On "Add", client calls `smart-parse` with:
   ```json
   {
     "mode": "recommendation",
     "text": "<optional>",
     "imageBase64": "<optional>",
     "imageMediaType": "image/jpeg",
     "context": { "country": "<name>", "existingCategories": ["restaurants", "drivers"] }
   }
   ```
2. Claude returns `{ "category": "...", "title": "...", "city": "..."|null }`.
   - `category` reuses an existing list name when the input fits one (that's why we pass
     `existingCategories`); otherwise it invents a short lowercase category.
   - `city` only for place-type recs (e.g. restaurants); null otherwise.
3. Item saves **immediately** into that category. A **quick-confirm chip** appears:
   *"Added to Drivers — change?"* Tapping it lets the user re-pick an existing list or
   type a new name; the item's `category` updates and the section re-renders.
4. While waiting, the capture row shows "Asking Claude…" (consistent with the rest of the app).

## Error handling & edge cases

- **AI failure / offline:** item still saves to a fallback `"Unsorted"` category with the
  raw text/link/image; chip reads *"Couldn't auto-sort — pick a list."* Nothing lost.
- **Unrecognizable image:** same `"Unsorted"` fallback.
- **GUEST_MODE:** full localStorage path (`lsInsert`/`lsGet`/`lsUpdate`/`lsDelete`); image
  stored as base64 like existing research images; no Supabase calls.
- **Delete:** removes the row; best-effort storage cleanup for uploaded images.
- **Casing duplicates:** `"Drivers"` vs `"drivers"` grouped/reused case-insensitively.

## Reused building blocks

- `smart-parse` edge function (extended with `recommendation` mode).
- `research` storage bucket for image uploads.
- `lsInsert`/`lsGet`/`lsUpdate`/`lsDelete` GUEST_MODE helpers.
- `openCountry()` render path; grouped-list rendering styled like existing place/hotel items.
- Quick-confirm chip UX language borrowed from Smart Import.
