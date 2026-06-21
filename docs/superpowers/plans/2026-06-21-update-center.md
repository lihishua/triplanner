# Update Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dismiss-only activity banner with a category-grouped "Update Center" that summarizes the other trip member's changes (flights, countries, places, todos) since the viewer last acknowledged it, reachable any time via a header bell icon, with each bullet clickable to jump to the specific item.

**Architecture:** A new dependency-free module (`update-digest.js`) owns the pure grouping/phrasing logic (raw activity rows in → digest text+ids out) and is unit-tested with plain Node + `assert` — no framework, no build step, consistent with the rest of this no-build vanilla-JS app. `app.js` gains the Supabase-facing glue (fetch unseen rows, render the modal, mark-seen-on-acknowledge, click-to-navigate) and a few small logging/id-capturing fixes at existing insert sites. `index.html` gains one new overlay modal and a header button, following the app's existing `.overlay`/`.modal` pattern.

**Tech Stack:** Vanilla JS (no build step), Supabase JS client, plain Node.js for the one automated test (no test runner/framework — none exists in this repo, and the approved spec already settles on manual verification for everything else).

**Spec:** `docs/superpowers/specs/2026-06-21-update-center-design.md`

---

## Why a new file (`update-digest.js`)?

`app.js` is already ~1900 lines and starts with browser-only top-level code (`window.TRIPLAN_CONFIG`, `window.supabase.createClient(...)`), so it can't be loaded in Node for testing. The grouping/phrasing logic is the one piece of this feature with real business-rule complexity (it's exactly what produced the wrong output if you get it wrong), so it's worth pulling into its own small, dependency-free file that loads fine both as a `<script>` tag in the browser and via `require()` in Node. Everything else (DOM rendering, Supabase calls, navigation) stays in `app.js`, matching the existing single-file convention, and is verified manually in the browser like the rest of the app already is.

---

### Task 1: Add `meta` column to `trip_activity`

**Files:**
- Modify: `features.sql`

- [ ] **Step 1: Add the column**

In `features.sql`, after the existing `trip_activity` table block (currently ending at the `activity_all` policy, around line 45), add:

```sql
-- Update Center: structured grouping data (currently only used by 'added_flight')
alter table trip_activity add column if not exists meta jsonb;
```

- [ ] **Step 2: Apply it**

This project applies schema changes by hand in the Supabase SQL editor (see `README.md` Setup section — same pattern used for every prior migration in this repo). Tell the user to paste the new `alter table` statement into the Supabase SQL editor and run it. Do not attempt to run it automatically — there is no migrations workflow in this repo, and applying schema changes is the user's call.

- [ ] **Step 3: Commit**

```bash
git add features.sql
git commit -m "Add meta column to trip_activity for Update Center grouping"
```

---

### Task 2: Pure digest grouping/phrasing logic (`update-digest.js`)

**Files:**
- Create: `update-digest.js`
- Create: `update-digest.test.js`

This is the only piece of this feature with real logic worth testing in isolation. Build it test-first.

- [ ] **Step 1: Write the failing test**

Create `update-digest.test.js`:

```js
const assert = require('assert');
const { buildUpdateDigest } = require('./update-digest.js');

// Reproduces the exact example from the design spec.
const rows = [
  { entity_type: 'flight', entity_id: 'f1', user_email: 'lihi@example.com',
    summary: 'BKK → CMB', meta: { origin: 'BKK', destination: 'Colombo' } },
  { entity_type: 'flight', entity_id: 'f2', user_email: 'lihi@example.com',
    summary: 'DXB → CMB', meta: { origin: 'DXB', destination: 'Colombo' } },
  { entity_type: 'flight', entity_id: 'f3', user_email: 'lihi@example.com',
    summary: 'SIN → CMB', meta: { origin: 'SIN', destination: 'Colombo' } },
  { entity_type: 'flight', entity_id: 'f4', user_email: 'lihi@example.com',
    summary: 'Vietnam → Perth', meta: { origin: 'Vietnam', destination: 'Perth' } },
  { entity_type: 'country', entity_id: 'c1', user_email: 'lihi@example.com',
    summary: 'Philippines' },
  { entity_type: 'todo', entity_id: 't1', user_email: 'lihi@example.com',
    summary: 'אישור יציאה מהארץ ממשרד החינוך' },
  { entity_type: 'todo', entity_id: 't2', user_email: 'lihi@example.com',
    summary: 'חיסונים' },
  { entity_type: 'todo', entity_id: 't3', user_email: 'lihi@example.com',
    summary: 'לקנות רחפן' },
];

const digest = buildUpdateDigest(rows);

assert.strictEqual(
  digest.flights.text,
  'Lihi added 3 options to Colombo, added one flight from Vietnam to Perth.'
);
assert.deepStrictEqual(digest.flights.ids, ['f1', 'f2', 'f3', 'f4']);

assert.strictEqual(digest.countries.text, 'Lihi added Philippines.');
assert.deepStrictEqual(digest.countries.ids, ['c1']);

assert.strictEqual(digest.places, null);

assert.strictEqual(
  digest.todos.text,
  'Lihi added: אישור יציאה מהארץ ממשרד החינוך, חיסונים, לקנות רחפן'
);
assert.deepStrictEqual(digest.todos.ids, ['t1', 't2', 't3']);

// Single country, single place, multiple places phrasing
const single = buildUpdateDigest([
  { entity_type: 'country', entity_id: 'c2', user_email: 'amir@example.com', summary: 'Vietnam' },
  { entity_type: 'place', entity_id: 'p1', user_email: 'amir@example.com', summary: 'Hoi An, Vietnam' },
]);
assert.strictEqual(single.countries.text, 'Amir added Vietnam.');
assert.strictEqual(single.places.text, 'Amir added Hoi An, Vietnam.');

const multiPlaces = buildUpdateDigest([
  { entity_type: 'place', entity_id: 'p1', user_email: 'amir@example.com', summary: 'Hoi An, Vietnam' },
  { entity_type: 'place', entity_id: 'p2', user_email: 'amir@example.com', summary: 'Da Nang, Vietnam' },
]);
assert.strictEqual(multiPlaces.places.text, 'Amir added 2 new places: Hoi An, Vietnam, Da Nang, Vietnam.');

const multiCountries = buildUpdateDigest([
  { entity_type: 'country', entity_id: 'c1', user_email: 'amir@example.com', summary: 'Vietnam' },
  { entity_type: 'country', entity_id: 'c2', user_email: 'amir@example.com', summary: 'Laos' },
  { entity_type: 'country', entity_id: 'c3', user_email: 'amir@example.com', summary: 'Cambodia' },
]);
assert.strictEqual(multiCountries.countries.text, 'Amir added Vietnam, Laos and Cambodia.');

// Fully empty digest
const empty = buildUpdateDigest([]);
assert.strictEqual(empty.flights, null);
assert.strictEqual(empty.countries, null);
assert.strictEqual(empty.places, null);
assert.strictEqual(empty.todos, null);

console.log('All update-digest tests passed.');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node update-digest.test.js`
Expected: throws `Cannot find module './update-digest.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `update-digest.js`**

```js
/* Pure, dependency-free grouping/phrasing logic for the Update Center digest.
   Loaded as a plain <script> in the browser; also require()-able from Node for testing.
   Input: raw trip_activity rows (already filtered to "unseen, by the other trip member").
   Output: { flights, countries, places, todos }, each either
     { text: string, ids: string[] } or null when there's nothing in that category. */

function capWords(s) {
  return (s || '').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function authorName(rows) {
  const email = rows.find(r => r.user_email)?.user_email || '';
  return capWords(email.split('@')[0]) || 'Someone';
}

function idsOf(rows) {
  return rows.map(r => r.entity_id).filter(Boolean);
}

function joinWithAnd(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function buildFlightsLine(rows) {
  if (!rows.length) return null;
  const byDestination = {};
  rows.forEach(r => {
    const dest = r.meta?.destination || 'an unknown destination';
    (byDestination[dest] = byDestination[dest] || []).push(r);
  });
  const clauses = Object.keys(byDestination).map(dest => {
    const group = byDestination[dest];
    if (group.length === 1) {
      const origin = group[0].meta?.origin || 'an unknown origin';
      return `added one flight from ${origin} to ${dest}`;
    }
    return `added ${group.length} options to ${dest}`;
  });
  return { text: `${authorName(rows)} ${clauses.join(', ')}.`, ids: idsOf(rows) };
}

function buildCountriesLine(rows) {
  if (!rows.length) return null;
  const names = rows.map(r => r.summary);
  return { text: `${authorName(rows)} added ${joinWithAnd(names)}.`, ids: idsOf(rows) };
}

function buildPlacesLine(rows) {
  if (!rows.length) return null;
  if (rows.length === 1) {
    return { text: `${authorName(rows)} added ${rows[0].summary}.`, ids: idsOf(rows) };
  }
  const names = rows.map(r => r.summary);
  return {
    text: `${authorName(rows)} added ${rows.length} new places: ${names.join(', ')}.`,
    ids: idsOf(rows),
  };
}

function buildTodosLine(rows) {
  if (!rows.length) return null;
  const titles = rows.map(r => r.summary);
  return { text: `${authorName(rows)} added: ${titles.join(', ')}`, ids: idsOf(rows) };
}

function buildUpdateDigest(rows) {
  const byType = { flight: [], country: [], place: [], todo: [] };
  rows.forEach(r => { if (byType[r.entity_type]) byType[r.entity_type].push(r); });
  return {
    flights: buildFlightsLine(byType.flight),
    countries: buildCountriesLine(byType.country),
    places: buildPlacesLine(byType.place),
    todos: buildTodosLine(byType.todo),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { buildUpdateDigest };
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `node update-digest.test.js`
Expected: `All update-digest tests passed.`

- [ ] **Step 5: Commit**

```bash
git add update-digest.js update-digest.test.js
git commit -m "Add pure digest grouping/phrasing logic for Update Center"
```

---

### Task 3: Load `update-digest.js` in the browser

**Files:**
- Modify: `index.html:638-641`

- [ ] **Step 1: Add the script tag before `app.js`**

Current (`index.html:638-641`):
```html
<script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="app.js"></script>
```

New:
```html
<script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="update-digest.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 2: Verify**

Run: `grep -n "update-digest.js" index.html`
Expected: one match, on the line just added.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Load update-digest.js before app.js"
```

---

### Task 4: Centralize country-add logging in `ensureCountry`

**Files:**
- Modify: `app.js:234-247` (`ensureCountry`)
- Modify: `app.js:1614-1629` (`confirmSuggestion`)

`ensureCountry` is the single function that actually inserts a new `countries` row — it's called from three places, none of which currently log an `added_country` activity (one of them, `confirmSuggestion`, logs a differently-typed and mislabeled event instead). Centralizing here fixes all three call sites at once.

- [ ] **Step 1: Add logging to `ensureCountry`**

Current (`app.js:234-247`):
```js
async function ensureCountry(name, flag) {
  const found = countries.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  if (GUEST_MODE) {
    const newCountry = lsInsert('countries', { trip_id: TRIP_ID, name, flag });
    countries.push(newCountry);
    return newCountry;
  }
  const { data, error } = await sb.from('countries')
    .insert({ trip_id: TRIP_ID, name, flag }).select().single();
  if (error) { alert(error.message); return null; }
  countries.push(data);
  return data;
}
```

New:
```js
async function ensureCountry(name, flag) {
  const found = countries.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  if (GUEST_MODE) {
    const newCountry = lsInsert('countries', { trip_id: TRIP_ID, name, flag });
    countries.push(newCountry);
    return newCountry;
  }
  const { data, error } = await sb.from('countries')
    .insert({ trip_id: TRIP_ID, name, flag }).select().single();
  if (error) { alert(error.message); return null; }
  countries.push(data);
  logActivity('added_country', name, 'country', data.id);
  return data;
}
```

- [ ] **Step 2: Remove the mislabeled call in `confirmSuggestion`**

Current (`app.js:1614-1629`):
```js
async function confirmSuggestion(mid) {
  // mid = "{messageId}_{suggIndex}"
  const [msgId, idxStr] = mid.split('_');
  const idx = parseInt(idxStr);
  const msg = chatHistory.find(m => m.id === msgId || m._tempId === parseInt(msgId));
  if (!msg?.suggestions?.[idx]) return;
  const s = msg.suggestions[idx];
  await ensureCountry(cap(s.country || s.name), FLAGS[(s.country || s.name).toLowerCase()] || '🌍');
  s.confirmed = true;
  if (!GUEST_MODE && msg.id) {
    await sb.from('trip_chat').update({ suggestions: msg.suggestions }).eq('id', msg.id);
  }
  await refreshAll();
  renderChat();
  logActivity('confirmed_suggestion', `✓ ${s.name}${s.country ? ', ' + s.country : ''}`, 'place');
}
```

New (drop the last line — `ensureCountry` now logs it):
```js
async function confirmSuggestion(mid) {
  // mid = "{messageId}_{suggIndex}"
  const [msgId, idxStr] = mid.split('_');
  const idx = parseInt(idxStr);
  const msg = chatHistory.find(m => m.id === msgId || m._tempId === parseInt(msgId));
  if (!msg?.suggestions?.[idx]) return;
  const s = msg.suggestions[idx];
  await ensureCountry(cap(s.country || s.name), FLAGS[(s.country || s.name).toLowerCase()] || '🌍');
  s.confirmed = true;
  if (!GUEST_MODE && msg.id) {
    await sb.from('trip_chat').update({ suggestions: msg.suggestions }).eq('id', msg.id);
  }
  await refreshAll();
  renderChat();
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check app.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Centralize added_country activity logging in ensureCountry"
```

---

### Task 5: Capture `entity_id` when a place is added

**Files:**
- Modify: `app.js:391-397`

- [ ] **Step 1: Capture the inserted row's id**

Current (`app.js:391-397`):
```js
  const { error } = await sb.from('places').insert({
    trip_id: TRIP_ID, country_id: country.id, name: cap(cityName),
    lat: geo.lat, lng: geo.lng, source_url: url || null,
  });
  if (error) return capMsg(error.message);
  closeAll(); await refreshAll();
  logActivity('added_place', cap(cityName) + ', ' + cap(countryName), 'place');
```

New:
```js
  const { data, error } = await sb.from('places').insert({
    trip_id: TRIP_ID, country_id: country.id, name: cap(cityName),
    lat: geo.lat, lng: geo.lng, source_url: url || null,
  }).select().single();
  if (error) return capMsg(error.message);
  closeAll(); await refreshAll();
  logActivity('added_place', cap(cityName) + ', ' + cap(countryName), 'place', data.id);
```

- [ ] **Step 2: Syntax check**

Run: `node --check app.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Capture place id for Update Center navigation"
```

---

### Task 6: Capture `entity_id` + `meta` when a flight is added

**Files:**
- Modify: `app.js:790-813` (`saveFlight`)

- [ ] **Step 1: Capture the inserted row's id and pass flight meta**

Current (`app.js:790-813`):
```js
async function saveFlight() {
  const f = { trip_id: TRIP_ID };
  ['origin','destination','airline','flight_no','depart_date','depart_time','price','notes']
    .forEach(k => f[k] = val('f-'+k).trim());

  if (_editingFlightId) {
    if (GUEST_MODE) { lsUpdate('flights', _editingFlightId, f); }
    else {
      const { error } = await sb.from('flights').update(f).eq('id', _editingFlightId);
      if (error) return alert(error.message);
    }
  } else {
    if (GUEST_MODE) { lsInsert('flights', f); }
    else {
      const { error } = await sb.from('flights').insert(f);
      if (error) return alert(error.message);
    }
  }
  _editingFlightId = null;
  closeAll(); await refreshAll();
  if (!_editingFlightId) logActivity('added_flight',
    `${f.origin || '?'} → ${f.destination || '?'}${f.depart_date ? ' · ' + f.depart_date : ''}${f.airline ? ' · ' + f.airline : ''}`,
    'flight');
}
```

New:
```js
async function saveFlight() {
  const f = { trip_id: TRIP_ID };
  ['origin','destination','airline','flight_no','depart_date','depart_time','price','notes']
    .forEach(k => f[k] = val('f-'+k).trim());

  const wasEditing = !!_editingFlightId;
  let newId = null;

  if (wasEditing) {
    if (GUEST_MODE) { lsUpdate('flights', _editingFlightId, f); }
    else {
      const { error } = await sb.from('flights').update(f).eq('id', _editingFlightId);
      if (error) return alert(error.message);
    }
  } else {
    if (GUEST_MODE) { lsInsert('flights', f); }
    else {
      const { data, error } = await sb.from('flights').insert(f).select().single();
      if (error) return alert(error.message);
      newId = data.id;
    }
  }
  _editingFlightId = null;
  closeAll(); await refreshAll();
  if (!wasEditing) logActivity('added_flight',
    `${f.origin || '?'} → ${f.destination || '?'}${f.depart_date ? ' · ' + f.depart_date : ''}${f.airline ? ' · ' + f.airline : ''}`,
    'flight', newId, { origin: f.origin || '?', destination: f.destination || '?' });
}
```

Note this also fixes a latent bug: the old code checked `if (!_editingFlightId)` *after* already setting `_editingFlightId = null` on the line above, so that condition was always true — even edits were (mis)logged as "added_flight". The new `wasEditing` flag captures the right state before it's cleared.

- [ ] **Step 2: Update `logActivity`'s signature to accept `meta`**

Current (`app.js:1807-1820`):
```js
async function logActivity(action, summary, entityType = null, entityId = null) {
  if (GUEST_MODE || !TRIP_ID) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('trip_activity').insert({
    trip_id: TRIP_ID,
    user_email: user.email,
    action,
    summary,
    entity_type: entityType,
    entity_id: entityId ? String(entityId) : null,
    seen_by: [user.id],
  }).catch(() => {});
}
```

New:
```js
async function logActivity(action, summary, entityType = null, entityId = null, meta = null) {
  if (GUEST_MODE || !TRIP_ID) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('trip_activity').insert({
    trip_id: TRIP_ID,
    user_email: user.email,
    action,
    summary,
    entity_type: entityType,
    entity_id: entityId ? String(entityId) : null,
    meta,
    seen_by: [user.id],
  }).catch(() => {});
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check app.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Capture flight id and meta for Update Center; fix edit-vs-add logging bug"
```

---

### Task 7: Capture `entity_id` when a todo is added

**Files:**
- Modify: `app.js:1694-1709` (`saveTodo`)

- [ ] **Step 1: Capture the inserted row's id**

Current (`app.js:1694-1709`):
```js
async function saveTodo() {
  const title = document.getElementById('todo-title').value.trim();
  if (!title) return;
  const deadline = document.getElementById('todo-deadline').value || null;

  if (_editingTodoId) {
    const t = todos.find(x => x.id === _editingTodoId);
    if (t) { t.title = title; t.deadline = deadline; }
    if (GUEST_MODE) { lsUpdate('todos', _editingTodoId, { title, deadline }); }
    else { await sb.from('trip_todos').update({ title, deadline }).eq('id', _editingTodoId); }
  } else {
    const row = { trip_id: TRIP_ID, title, deadline, done: false };
    if (GUEST_MODE) { lsInsert('todos', row); }
    else { await sb.from('trip_todos').insert(row); }
    logActivity('added_todo', title, 'todo');
```

New:
```js
async function saveTodo() {
  const title = document.getElementById('todo-title').value.trim();
  if (!title) return;
  const deadline = document.getElementById('todo-deadline').value || null;

  if (_editingTodoId) {
    const t = todos.find(x => x.id === _editingTodoId);
    if (t) { t.title = title; t.deadline = deadline; }
    if (GUEST_MODE) { lsUpdate('todos', _editingTodoId, { title, deadline }); }
    else { await sb.from('trip_todos').update({ title, deadline }).eq('id', _editingTodoId); }
  } else {
    const row = { trip_id: TRIP_ID, title, deadline, done: false };
    let newId = null;
    if (GUEST_MODE) { newId = lsInsert('todos', row).id; }
    else {
      const { data } = await sb.from('trip_todos').insert(row).select().single();
      newId = data?.id;
    }
    logActivity('added_todo', title, 'todo', newId);
```

(Leave the rest of the function — the lines after this point that close out `saveTodo` — untouched.)

- [ ] **Step 2: Syntax check**

Run: `node --check app.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Capture todo id for Update Center navigation"
```

---

### Task 8: Add `data-id` attributes to navigation targets

**Files:**
- Modify: `app.js:751-762` (`renderFlights`)
- Modify: `app.js:577-587` (`openCountry`, place rows)
- Modify: `app.js:1664-1671` (`renderTodos`)

These let the highlight/scroll navigation in Task 10 find the right DOM element.

- [ ] **Step 1: Flight cards**

Current (`app.js:751-756`):
```js
  el.innerHTML = flights.map(f => `
    <div class="card" onclick="editFlight('${f.id}')" style="cursor:pointer">
      <button class="del" onclick="event.stopPropagation();delFlight('${f.id}')">×</button>
      <div class="flight-route"><span>${esc(f.origin)||'—'}</span>
        <span class="arrow"></span><span>${esc(f.destination)||'—'}</span></div>
      <div class="flight-meta">
```

New:
```js
  el.innerHTML = flights.map(f => `
    <div class="card" data-id="${f.id}" onclick="editFlight('${f.id}')" style="cursor:pointer">
      <button class="del" onclick="event.stopPropagation();delFlight('${f.id}')">×</button>
      <div class="flight-route"><span>${esc(f.origin)||'—'}</span>
        <span class="arrow"></span><span>${esc(f.destination)||'—'}</span></div>
      <div class="flight-meta">
```

- [ ] **Step 2: Place rows**

Current (`app.js:577-579`):
```js
    ${pts.map(p => `
      <div class="place-item">
        <span class="place-item-name" onclick="openCity('${p.id}')">📍 ${esc(p.name)}</span>
```

New:
```js
    ${pts.map(p => `
      <div class="place-item" data-id="${p.id}">
        <span class="place-item-name" onclick="openCity('${p.id}')">📍 ${esc(p.name)}</span>
```

- [ ] **Step 3: Todo rows**

Current (`app.js:1664-1665`):
```js
    return `<div class="todo-item">
      <div class="todo-check${t.done ? ' done' : ''}" onclick="toggleTodo('${t.id}')">
```

New:
```js
    return `<div class="todo-item" data-id="${t.id}">
      <div class="todo-check${t.done ? ' done' : ''}" onclick="toggleTodo('${t.id}')">
```

- [ ] **Step 4: Syntax check**

Run: `node --check app.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Add data-id attributes for Update Center navigation targets"
```

---

### Task 9: Update Center UI — markup, styles, header bell

**Files:**
- Modify: `index.html:191-195` (CSS — replace old activity-banner styles)
- Modify: `index.html:356-367` (header + remove old banner div)
- Modify: `index.html` — add `ov-updates` overlay near the other overlays (next to `ov-todo`, currently `index.html:445-455`)

- [ ] **Step 1: Replace the old banner CSS with Update Center CSS**

Current (`index.html:191-195`):
```css
  /* ACTIVITY BANNER */
  .activity-item{display:inline-flex;align-items:center;gap:6px;cursor:pointer;
    background:var(--paper);border:1px solid var(--line);border-radius:20px;
    padding:4px 12px;font-size:13px;margin:3px 4px 3px 0}
  .activity-item:hover{border-color:var(--accent);color:var(--accent)}
```

New:
```css
  /* UPDATE CENTER */
  #updates-btn{position:relative}
  .updates-dot{position:absolute;top:5px;right:7px;width:8px;height:8px;border-radius:50%;background:#b4544a}
  .update-section{margin-bottom:14px}
  .update-section:last-child{margin-bottom:0}
  .update-heading{font-family:'Fraunces',serif;font-weight:600;font-size:14px;color:var(--ink-soft);margin-bottom:4px}
  .update-bullet{cursor:pointer;font-size:15px;padding:4px 0;border-radius:6px}
  .update-bullet:hover{color:var(--accent)}
  .update-empty{font-size:14px;color:var(--ink-soft);font-style:italic}
  @keyframes highlight-pulse{0%,100%{background:transparent}50%{background:var(--accent-soft)}}
  .highlight-pulse{animation:highlight-pulse 1s ease-in-out 2}
```

- [ ] **Step 2: Add the header bell button, remove the old banner div**

Current (`index.html:356-367`):
```html
    <header class="top">
      <div class="brand"><span class="dot"></span><h1>TriPlan</h1><small>our trip, together</small></div>
      <div class="top-actions">
        <button class="btn ghost" onclick="suggestItinerary()">✦ Plan</button>
        <button class="btn ghost" onclick="previewTrip()">▶ Preview trip</button>
        <button id="logout-btn" class="btn ghost" onclick="doLogout()">Log out</button>
      </div>
    </header>
    <div id="trip-carousel" class="trip-carousel" style="display:none"></div>
    <!-- Activity banner -->
    <div id="activity-banner" style="display:none;background:var(--accent-soft);border:1px solid var(--line);
      border-radius:12px;padding:12px 16px;margin-top:12px;font-size:14px"></div>
```

New:
```html
    <header class="top">
      <div class="brand"><span class="dot"></span><h1>TriPlan</h1><small>our trip, together</small></div>
      <div class="top-actions">
        <button class="btn ghost" onclick="suggestItinerary()">✦ Plan</button>
        <button class="btn ghost" onclick="previewTrip()">▶ Preview trip</button>
        <button id="updates-btn" class="btn ghost" onclick="openOverlay('ov-updates')">🔔 Updates<span id="updates-dot" class="updates-dot" style="display:none"></span></button>
        <button id="logout-btn" class="btn ghost" onclick="doLogout()">Log out</button>
      </div>
    </header>
    <div id="trip-carousel" class="trip-carousel" style="display:none"></div>
```

- [ ] **Step 3: Add the `ov-updates` overlay**

Insert right after the `ov-todo` overlay block (currently `index.html:445-455`):

```html
<div class="overlay" id="ov-updates"><div class="modal">
  <h3>Updates</h3>
  <div class="sub">What's new since you last checked in.</div>
  <div id="updates-body"></div>
  <div class="modal-actions">
    <button class="btn ghost" onclick="closeAll()">Close</button>
    <button class="btn" onclick="acknowledgeUpdates()">Got it</button>
  </div>
</div></div>
```

- [ ] **Step 4: Verify markup**

Run: `grep -n "ov-updates\|updates-btn\|updates-dot\|updates-body" index.html`
Expected: matches for the button, the dot span, the overlay div, and `updates-body`, with no leftover references to `activity-banner`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Update Center modal markup, header bell, and styles"
```

---

### Task 10: Update Center JS — fetch, render, acknowledge, navigate

**Files:**
- Modify: `app.js:1804-1883` (replace `loadActivityBanner`/`dismissBanner`/`navigateToActivity` block)
- Modify: `app.js:128` (`enterTrip`, call site)

This is the last piece — it ties the pure digest builder (Task 2) and the data-id attributes (Task 8) together into working UI.

- [ ] **Step 1: Replace the old banner functions**

`app.js` has a `FEATURE 3: ACTIVITY FEED` section (originally around line 1804) containing `logActivity`, then `loadActivityBanner`, `dismissBanner`, `navigateToActivity`. `logActivity` was already updated in Task 6 — leave it as-is. Replace only the three functions below it:

```js
async function loadActivityBanner() {
  if (GUEST_MODE) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb.from('trip_activity').select('*')
    .eq('trip_id', TRIP_ID)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  if (!data?.length) return;

  const unseen = data.filter(a => !a.seen_by?.includes(user.id));
  if (!unseen.length) return;

  // Group by author
  const byAuthor = {};
  unseen.forEach(a => {
    const who = a.user_email === user.email ? null : (a.user_email?.split('@')[0] || 'Someone');
    if (!who) return;
    if (!byAuthor[who]) byAuthor[who] = [];
    byAuthor[who].push(a);
  });
  if (!Object.keys(byAuthor).length) return;

  const banner = document.getElementById('activity-banner');
  let html = '';
  for (const [who, acts] of Object.entries(byAuthor)) {
    html += `<div style="margin-bottom:6px"><span style="font-family:'Fraunces',serif;font-weight:600">${esc(who)}'s updates:</span> `;
    html += acts.map(a =>
      `<span class="activity-item" onclick="navigateToActivity('${a.entity_type}')">
        ${a.action === 'added_flight' ? '✈' : a.action === 'added_todo' ? '✓' : '📍'} ${esc(a.summary)}
      </span>`
    ).join('');
    html += '</div>';
  }
  html += `<div style="margin-top:6px;text-align:right"><button class="btn ghost small" onclick="dismissBanner()">Dismiss</button></div>`;
  banner.innerHTML = html;
  banner.style.display = 'block';

  // Mark as seen
  await sb.from('trip_activity').update({
    seen_by: sb.rpc ? undefined : null,
  }).in('id', unseen.map(a => a.id)).catch(() => {});

  // Simpler: just mark each one
  const uid = user.id;
  for (const a of unseen) {
    const newSeen = [...(a.seen_by || []), uid];
    await sb.from('trip_activity').update({ seen_by: newSeen }).eq('id', a.id).catch(() => {});
  }
}

function dismissBanner() {
  document.getElementById('activity-banner').style.display = 'none';
}

function navigateToActivity(entityType) {
  const tabMap = { flight: 'flights', place: 'countries', todo: 'prep' };
  if (tabMap[entityType]) showTab(tabMap[entityType]);
  dismissBanner();
}
```

New:
```js
let _currentDigest = null;
let _unseenRows = [];

async function loadUpdateCenter() {
  if (GUEST_MODE) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data } = await sb.from('trip_activity').select('*')
    .eq('trip_id', TRIP_ID)
    .neq('user_email', user.email)
    .order('created_at', { ascending: true })
    .limit(20);
  _unseenRows = (data || []).filter(a => !a.seen_by?.includes(user.id));
  _currentDigest = buildUpdateDigest(_unseenRows);
  renderUpdateCenter();
  updateBellBadge();
  if (_unseenRows.length) openOverlay('ov-updates');
}

function updateBellBadge() {
  document.getElementById('updates-dot').style.display = _unseenRows.length ? 'block' : 'none';
}

function renderUpdateCenter() {
  const sections = [
    ['Flights', _currentDigest?.flights, 'flights'],
    ['Countries', _currentDigest?.countries, 'countries'],
    ['Places', _currentDigest?.places, 'places'],
    ['Todos', _currentDigest?.todos, 'todos'],
  ];
  document.getElementById('updates-body').innerHTML = sections.map(([label, line, key]) => `
    <div class="update-section">
      <div class="update-heading">${esc(label)}</div>
      ${line
        ? `<div class="update-bullet" onclick="navUpdate('${key}')">${esc(line.text)}</div>`
        : `<div class="update-empty">No new ${esc(label.toLowerCase())}.</div>`}
    </div>`).join('');
}

async function acknowledgeUpdates() {
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    for (const row of _unseenRows) {
      const newSeen = [...(row.seen_by || []), user.id];
      await sb.from('trip_activity').update({ seen_by: newSeen }).eq('id', row.id).catch(() => {});
    }
    _unseenRows = [];
    updateBellBadge();
  }
  closeAll();
}

function navUpdate(key) {
  const line = _currentDigest?.[key];
  if (!line) return;
  closeAll();
  if (key === 'flights') return navUpdateFlights(line.ids);
  if (key === 'countries') return navUpdateCountry(line.ids[0]);
  if (key === 'places') return navUpdatePlace(line.ids[0]);
  if (key === 'todos') return navUpdateTodos(line.ids);
}

function navUpdateFlights(ids) {
  showTab('flights');
  highlightEls(ids.map(id => `.card[data-id="${id}"]`));
}

function navUpdateCountry(id) {
  if (!id) return;
  openCountry(id);
}

function navUpdatePlace(id) {
  if (!id) return;
  const place = places.find(p => p.id === id);
  if (!place) return;
  openCountry(place.country_id);
  setTimeout(() => highlightEls([`.place-item[data-id="${id}"]`]), 50);
}

async function navUpdateTodos(ids) {
  showTab('prep');
  await refreshTodos();
  highlightEls(ids.map(id => `.todo-item[data-id="${id}"]`));
}

function highlightEls(selectors) {
  const els = selectors.map(s => document.querySelector(s)).filter(Boolean);
  if (!els.length) return;
  els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  els.forEach(el => {
    el.classList.add('highlight-pulse');
    setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
  });
}
```

- [ ] **Step 2: Update the call site in `enterTrip`**

Current (`app.js:120-129`):
```js
async function enterTrip(trip) {
  TRIP_ID = trip.id;
  localStorage.setItem('triplanner_last_trip', trip.id);
  document.getElementById('trip-onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderTripCarousel();
  await refreshAll();
  await loadPreferences();
  loadActivityBanner();
}
```

New:
```js
async function enterTrip(trip) {
  TRIP_ID = trip.id;
  localStorage.setItem('triplanner_last_trip', trip.id);
  document.getElementById('trip-onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderTripCarousel();
  await refreshAll();
  await loadPreferences();
  loadUpdateCenter();
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check app.js`
Expected: no output (success).

- [ ] **Step 4: Re-run the digest unit test (regression check)**

Run: `node update-digest.test.js`
Expected: `All update-digest tests passed.` (confirms Task 10's glue code didn't touch the still-correct pure logic).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Build Update Center: fetch unseen activity, render digest, navigate, acknowledge"
```

---

### Task 11: End-to-end manual verification

**Files:** none (verification only — this app has no test suite, per the approved spec's Testing Approach section)

This requires two Supabase accounts that are both members of the same trip (see `README.md` for how a second member joins a trip). Use the `run` or `verify` skill to drive the browser if available; otherwise perform these steps by hand in two browser windows (or one regular + one incognito).

- [ ] **Step 1:** As user A, add: a country (e.g. "Philippines"), two flights to the same destination (e.g. both destination "Colombo"), one flight to a different destination, a place inside a country, and a todo with a Hebrew title.
- [ ] **Step 2:** Log in as user B in the other window. Confirm the Update Center auto-opens, showing all four sections, with Flights/Countries/Todos phrased per Task 2's rules and Places showing whatever was actually added (if a place was added in Step 1, confirm it shows; the spec's "No new places" case is already covered by Task 2's unit test).
- [ ] **Step 3:** Click the Flights bullet — confirm it switches to the Flights tab, scrolls to, and briefly highlights the matching card(s).
- [ ] **Step 4:** Click the 🔔 Updates header button — confirm the exact same digest reappears (nothing was marked seen by navigating).
- [ ] **Step 5:** Click the Countries bullet — confirm it opens that country's detail view directly.
- [ ] **Step 6:** Reopen via the bell again, click the Todos bullet — confirm it switches to Prep and highlights the right todo row, including correct RTL rendering of the Hebrew title.
- [ ] **Step 7:** Reopen via the bell once more, click "Got it" — confirm the modal closes and the bell's red dot disappears.
- [ ] **Step 8:** Reload the page as user B — confirm the Update Center does *not* auto-open (nothing new since acknowledging), and clicking the bell shows all four sections as "No new X".
- [ ] **Step 9:** Switch back to user A's window — confirm user A never sees their own additions reflected back in their own Update Center.

No commit for this task — it's a verification pass over already-committed work. If any step fails, fix the relevant task's code and re-commit there.
