# Prep Tabs, Sign-out Redesign, Native Booked Checkbox, Chat Removal — Design Spec

Date: 2026-06-24

Four independent UI/data changes bundled into one pass since they're each small.

## 1. Prep section split into tabs

### Problem

"Prep" (`#page-prep`, `app.js:1830-1995`) is a single flat checklist backed by `trip_todos` (id, trip_id, title, deadline, done — no category). Want it split into **Todos**, **Drugs & First Aid**, **Shopping List**, plus the ability to add arbitrary custom tabs for personal needs.

### Data model

`features.sql` additions:

```sql
alter table trip_todos add column if not exists category text not null default 'todos';

create table if not exists prep_tabs (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
alter table prep_tabs enable row level security;
create policy prep_tabs_all on prep_tabs for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
```

- Built-in tabs use fixed `category` keys: `'todos'`, `'first_aid'`, `'shopping'`. Always shown, in that order, never stored in `prep_tabs`.
- Custom tabs are rows in `prep_tabs`; a todo belonging to one stores that row's `id` (as text) in `category`.
- Every tab — built-in or custom — uses the same item shape: title + optional deadline + done. No per-tab schema differences (confirmed).
- No rename/delete for custom tabs in this pass — add-only, per requirements. (Future: could add a delete affordance later if it turns out to be needed.)

Guest mode (`lsGet('todos')` / `lsGet('prep_tabs')`) mirrors the same shape in localStorage.

### UI

- New sub-tab row inside `#page-prep`, under the existing page-head, above the list: `Todos | Drugs & First Aid | Shopping List | <custom tabs in creation order> | ＋`. Visually a smaller/secondary version of the existing `nav.tabs` style (reuse a variant class, not the same DOM, since it must live inside one page rather than switching pages).
- Switching sub-tabs is pure client-side state (`let activePrepTab = 'todos'`) — filters the already-loaded `todos` array by `category` and re-renders; no refetch.
- `＋` opens a small modal (new `#ov-prep-tab`, same pattern as `#ov-todo`) with a single "Tab name" input and Add button. On save: insert into `prep_tabs`, push to a `prepTabs` array, switch `activePrepTab` to the new tab's id, re-render the sub-tab row.
- The page-head's "＋ Add task" and "✦ AI suggest" buttons stay where they are; "Add task" pre-fills the modal's hidden category to `activePrepTab`. `renderTodos()` filters by `activePrepTab` instead of rendering all of `todos`.

### AI suggest (now per-tab)

- `suggestTodos()` sends the active tab's **display name** (`"Todos"`, `"Drugs & First Aid"`, `"Shopping List"`, or the custom tab's `name`) as a new `category` field in the `chat-plan` request body, alongside the existing `mode: 'todo'`.
- `chat-plan/index.ts`'s `buildTodoSystemPrompt` takes `category` and generalizes the existing prompt: replace "Suggest 4-6 NEW practical pre-trip todos" with "Suggest 4-6 NEW practical items for the '{category}' checklist for this trip", keeping the rest (destinations, family notes, already-seen exclusion, JSON shape) unchanged. One generic template handles built-ins and arbitrary custom names alike — no per-category special-casing.
- `getSeenTodoTitles`/`addSeenTodoTitle` localStorage keys become `triplan_seen_todos_<tripId>_<category>` (was `triplan_seen_todos_<tripId>`), so suggestions in one tab don't suppress suggestions in another.
- `acceptAiTodo` inserts with `category: activePrepTab` instead of the implicit default.

## 2. Sign-out: smaller, higher, with confirmation

- Replace `#logout-btn`'s text ("Sign out" / "Exit guest") with a circular icon-only button (door/exit glyph, e.g. ⏏ or an inline SVG), ~32px diameter.
- Move it into `header.top` next to the brand, vertically centered with the "TriPlan" title — change `header.top`'s `align-items:baseline` to `align-items:center` (the brand's own `align-items:baseline` for its dot+title+subtitle stays as-is, only the header-level alignment changes), keep `margin-left:auto` so it stays right-aligned.
- `doLogout()` (`app.js:85`) gets a guard at the top: `if (!confirm('Sign out?')) return;` — applies to both the guest-mode early-return branch and the real `sb.auth.signOut()` branch, since both are reached through the same function.

## 3. Booked checkbox: native input

- In `renderFlights()` (`app.js:884-903`), replace the custom `<span class="todo-check">` with a real `<input type="checkbox" ${f.booked?'checked':''} onclick="event.stopPropagation()" onchange="toggleFlightBooked('${f.id}')">`, keeping the adjacent "Booked" text label. `toggleFlightBooked` (`app.js:905-911`) is unchanged — it already just flips `f.booked` and persists.
- Drop the `.todo-check`-based markup for this one spot only; `.todo-check` itself stays as-is since the Prep list (section 1) still uses it for task checkboxes.

## 4. Remove chat section

Remove, from `index.html`: the `✦ Chat` tab button, the entire `#page-chat` section, and chat-specific CSS rules (`.chat-messages`, `.chat-msg`, `.chat-input-row`, `.chat-sugg-cards`, etc.).

Remove, from `app.js`: `chatHistory`, `chatLoaded`, `loadChat`, `renderChat`, `sendChat`, the suggestion-accept handler tied to chat cards, `clearChat`, and the `showTab`/`loadWikiPhotos` wiring for `t === 'chat'` (`app.js:2117`).

**Not touched:** `trip_chat` table (no migration — left in place, harmless and cheap to keep), and `chat-plan/index.ts`'s `buildChatSystemPrompt` / `isTodo` branch (the `mode: 'todo'` path used by AI Suggest keeps working unchanged; the `mode: 'chat'` path becomes unreachable dead code in the edge function, left as-is rather than deleted, per requirements).

## Testing approach

Manual verification (personal 2-person app, no test suite for UI):

1. Prep: switch between all 3 built-in tabs, confirm each shows only its own items; add a custom tab, add an item to it, confirm it persists across a page refresh and appears for the other trip member.
2. AI suggest on each tab (including the custom one) returns items framed for that category, and previously-skipped/added titles aren't immediately re-suggested within the same tab.
3. Sign-out: confirm the icon is circular, vertically aligned with "TriPlan", and that cancelling the `confirm()` leaves you logged in while accepting signs out (test both real auth and guest mode).
4. Flights: confirm the native checkbox toggles `booked`, persists after a refresh, and still feeds `renderBookedFlightsLine`'s budget-tab summary.
5. Confirm the Chat tab/button is gone, no console errors on load or on tab-switching, and "✦ AI suggest" on Prep still works (proves the shared edge function survived the removal).
