# Flights Section Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat flights list + research section with a grouped-by-leg view where each leg is a header, options are listed under it, booking one deletes the rest, legs are ordered west→east and can be dragged to reorder.

**Architecture:** Legs are derived in JS by grouping `flights` records on normalised IATA `(origin, destination)`. Drag order is persisted as a JSON array in a new `trips.leg_order` column. No new tables; `flights` schema is unchanged. `flight_research` data is preserved but no longer rendered on the Flights page.

**Tech Stack:** Vanilla JS, Supabase (Postgres), localStorage (guest mode), HTML5 drag-and-drop

## Global Constraints

- No build step — edit `index.html` and `app.js` directly
- `flights` table schema is **unchanged**
- `flight_research` table and data are **not deleted** (still used by smart `+` FAB)
- `renderResearch()` must be guarded with a null-check so it silently no-ops after the HTML element is removed
- Guest-mode leg order stored under localStorage key `triplanner_leg_order_{TRIP_ID}`
- Supabase-mode leg order stored in `trips.leg_order TEXT` column
- Drag uses only native HTML5 events — no library
- Booking confirmation uses the app's existing overlay pattern (not `confirm()`)

---

### Task 1: IATA helpers, leg grouping, and `leg_order` load/save

**Files:**
- Modify: `app.js` — add after the `AIRPORTS` constant (around line 1396)
- Modify: `app.js:337-370` — update `refreshAll()` to load `leg_order`
- Modify: `app.js:194-204` — update `enterTrip()` to call `loadLegOrder()`
- Run: one SQL migration in Supabase

**Interfaces:**
- Produces: `legOrder` (module-level `string[]`), `IATA_LON`, `resolveIata(s)`, `legKey(origin, dest)`, `iataLabel(iata)`, `groupFlightsByLeg(fs)`, `saveLegOrder(order)`, `loadLegOrder()`
- Consumed by: Tasks 2, 4, 5

- [ ] **Step 1: Run the DB migration**

In the Supabase dashboard SQL editor (or via `supabase db push`):

```sql
ALTER TABLE trips ADD COLUMN IF NOT EXISTS leg_order TEXT;
```

- [ ] **Step 2: Add module-level `legOrder` variable**

Find `let _editingFlightId = null;` (around line 1162) and add above it:

```javascript
let legOrder = []; // ordered array of leg keys like ["TLV-BKK","BKK-SYD"]
```

- [ ] **Step 3: Add IATA helpers after the `AIRPORTS` constant**

Find the line `const AIRPORTS=[...` (around line 1397). After the closing `];` of the AIRPORTS array, add:

```javascript
const IATA_LON = {
  LHR:  -0.5, CDG:   2.5, FRA:   8.7, AMS:   4.8, MAD:  -3.7, BCN:   2.1,
  FCO:  12.2, ATH:  23.7, IST:  28.8, TLV:  34.9, AMM:  35.9, CAI:  31.4,
  JED:  39.2, RUH:  46.7, DOH:  51.6, DXB:  55.4, AUH:  54.4, SHJ:  55.5,
  MCT:  58.3, KTM:  85.4, CCU:  88.4, DEL:  77.1, BOM:  72.9, GOI:  73.8,
  HYD:  78.5, BLR:  77.7, MAA:  80.3, COK:  76.3, CMB:  79.9,
  RGN:  96.1, BKK: 100.7, DMK: 100.6, HKT:  98.3, CNX:  99.0, USM: 100.1,
  KUL: 101.7, LGK:  99.7, SIN: 103.9, PNH: 104.8, REP: 103.8,
  SGN: 106.7, HAN: 105.8, DAD: 108.2, CGK: 106.7, DPS: 115.2,
  MNL: 121.0, CEB: 124.0, TPE: 121.2,
  ICN: 126.4, GMP: 126.8, OKA: 127.6, FUK: 130.5, KIX: 135.4,
  HND: 139.8, NRT: 140.4, MEL: 144.8, SYD: 151.2, BNE: 153.0, AKL: 174.8,
  JFK: -73.8, EWR: -74.2, LAX: -118.4, SFO: -122.4, ORD: -87.9,
};

function resolveIata(s) {
  if (!s) return '';
  const up = s.trim().toUpperCase();
  if (AIRPORTS.find(a => a[0] === up)) return up;
  const low = s.toLowerCase().trim();
  const match = AIRPORTS.find(a =>
    a[1].toLowerCase() === low ||
    a[2].toLowerCase().includes(low) ||
    low.includes(a[1].toLowerCase())
  );
  return match ? match[0] : up;
}

function legKey(origin, dest) {
  return resolveIata(origin) + '-' + resolveIata(dest);
}

function iataLabel(iata) {
  const airport = AIRPORTS.find(a => a[0] === iata);
  if (!airport) return iata;
  return airport[3] + ' (' + iata + ')';
}

function groupFlightsByLeg(fs) {
  const map = new Map();
  for (const f of fs) {
    const key = legKey(f.origin, f.destination);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }
  const savedKeys = legOrder.filter(k => map.has(k));
  const newKeys = [...map.keys()].filter(k => !legOrder.includes(k));
  newKeys.sort((a, b) => (IATA_LON[a.split('-')[0]] ?? 0) - (IATA_LON[b.split('-')[0]] ?? 0));
  return [...savedKeys, ...newKeys].map(key => {
    const [originIata, destIata] = key.split('-');
    return { key, originIata, destIata,
      originLabel: iataLabel(originIata), destLabel: iataLabel(destIata),
      flights: map.get(key) || [] };
  });
}

async function saveLegOrder(order) {
  legOrder = order;
  const json = JSON.stringify(order);
  if (GUEST_MODE) {
    localStorage.setItem('triplanner_leg_order_' + TRIP_ID, json);
    return;
  }
  await sb.from('trips').update({ leg_order: json }).eq('id', TRIP_ID);
}

async function loadLegOrder() {
  if (GUEST_MODE) {
    const raw = localStorage.getItem('triplanner_leg_order_' + TRIP_ID);
    legOrder = raw ? JSON.parse(raw) : [];
    return;
  }
  const { data } = await sb.from('trips').select('leg_order').eq('id', TRIP_ID).single();
  legOrder = data?.leg_order ? JSON.parse(data.leg_order) : [];
}
```

- [ ] **Step 4: Call `loadLegOrder()` from `enterTrip()`**

Find `enterTrip` function (around line 194):

```javascript
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

Replace with:

```javascript
async function enterTrip(trip) {
  TRIP_ID = trip.id;
  localStorage.setItem('triplanner_last_trip', trip.id);
  document.getElementById('trip-onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderTripCarousel();
  await Promise.all([refreshAll(), loadPreferences(), loadLegOrder()]);
  loadUpdateCenter();
}
```

- [ ] **Step 5: Guard `renderResearch()` against missing element**

Find `function renderResearch()` (around line 1734):

```javascript
function renderResearch() {
  const el = document.getElementById('researchList');
```

Add an early return after the `const el` line:

```javascript
function renderResearch() {
  const el = document.getElementById('researchList');
  if (!el) return;
```

- [ ] **Step 6: Verify with `node --check`**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```

Expected: no output (syntax OK).

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: IATA helpers, leg grouping, leg_order load/save"
```

---

### Task 2: Flights page HTML + CSS + new render functions

**Files:**
- Modify: `index.html` — remove research section, update flights page, add CSS
- Modify: `app.js:1164-1191` — replace `renderFlights()` and `toggleFlightBooked()`

**Interfaces:**
- Consumes: `groupFlightsByLeg(fs)`, `legOrder`, `saveLegOrder(order)`, `iataLabel(iata)`, `legKey(origin, dest)` from Task 1
- Produces: `renderFlights()`, `renderFlightCard(f)` — consumed by Task 3 (booking) and Task 4 (drag)

- [ ] **Step 1: Remove research section from `index.html`**

Find and remove the entire `<div class="research-section">` block (around line 432–437):

```html
      <div class="research-section">
        <div class="research-head">
          <h3>Research</h3>
          <button class="btn ghost small" onclick="openResearch()">＋ Add note</button>
        </div>
        <div class="grid flights" id="researchList"></div>
      </div>
```

Replace with nothing (delete those 7 lines).

- [ ] **Step 2: Add CSS for leg groups**

In `index.html`, find the closing `</style>` tag and insert before it:

```css
  /* Flights redesign — leg groups */
  .leg-group{margin-bottom:24px}
  .leg-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .leg-label{font-family:'Fraunces',serif;font-size:17px;font-weight:600;color:var(--ink)}
  .drag-handle{font-size:20px;color:var(--ink-soft);cursor:grab;padding:4px 8px;line-height:1;user-select:none;touch-action:none}
  .drag-handle:active{cursor:grabbing}
  .leg-group.dragging{opacity:.45}
  .leg-group.drag-over .leg-header{outline:2px dashed var(--accent);border-radius:6px}
  .flight-card{display:flex;align-items:flex-start;gap:12px;padding:14px 16px}
  .booked-label{display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;font-size:14px;color:var(--ink-soft);flex-shrink:0}
  .booked-label input{width:16px;height:16px;cursor:pointer}
  .flight-card-body{flex:1;min-width:0;cursor:pointer}
  .flight-route-compact{font-size:15px;color:var(--ink);line-height:1.4}
  .flight-notes{font-size:13px;color:var(--ink-soft);margin-top:3px;white-space:pre-wrap}
  .flight-card-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
  .btn-icon{background:none;border:none;cursor:pointer;font-size:15px;color:var(--ink-soft);padding:4px 6px;border-radius:6px;line-height:1}
  .btn-icon:hover{color:var(--accent)}
```

- [ ] **Step 3: Replace `renderFlights()` and `renderFlightCard()` in `app.js`**

Find the existing `renderFlights()` function (around line 1164) and replace it and the existing `toggleFlightBooked()` (lines 1185–1190) with:

```javascript
function renderFlights() {
  const el = document.getElementById('flightList');
  const eligible = flights.filter(f => f.origin && f.destination);
  if (!eligible.length) {
    el.innerHTML = '<div class="empty">No flights yet. Tap + to add your first leg.</div>';
    return;
  }
  const legs = groupFlightsByLeg(eligible);
  // Persist any newly seen leg keys
  const currentKeys = legs.map(l => l.key);
  const merged = [...legOrder.filter(k => currentKeys.includes(k)),
                  ...currentKeys.filter(k => !legOrder.includes(k))];
  if (merged.join() !== legOrder.join()) saveLegOrder(merged);

  el.innerHTML = legs.map(leg => `
    <div class="leg-group" data-key="${esc(leg.key)}">
      <div class="leg-header">
        <span class="leg-label">${esc(leg.originLabel)} → ${esc(leg.destLabel)}</span>
        <span class="drag-handle" data-key="${esc(leg.key)}" title="Drag to reorder">⠿</span>
      </div>
      <div class="leg-flights">
        ${leg.flights.map(f => renderFlightCard(f)).join('')}
      </div>
    </div>
  `).join('');
}

function renderFlightCard(f) {
  const meta = [f.airline, f.flight_no, f.depart_date, f.depart_time, f.price]
    .filter(Boolean).join(' · ');
  return `
    <div class="card flight-card" data-id="${f.id}">
      <label class="booked-label" onclick="event.stopPropagation()">
        <input type="checkbox" ${f.booked ? 'checked' : ''}
          onchange="toggleFlightBooked('${f.id}', this)">
        Booked
      </label>
      <div class="flight-card-body" onclick="editFlight('${f.id}')">
        ${meta ? `<div class="flight-route-compact">${esc(meta)}</div>` : ''}
        ${f.notes ? `<div class="flight-notes">${esc(f.notes)}</div>` : ''}
      </div>
      <div class="flight-card-actions">
        <button class="btn-icon" onclick="event.stopPropagation();editFlight('${f.id}')" title="Edit">✏</button>
        <button class="del" onclick="event.stopPropagation();delFlight('${f.id}')">×</button>
      </div>
    </div>`;
}
```

- [ ] **Step 4: Verify in browser**

Open the Flights tab. Flights should appear grouped under leg headers (e.g. "Israel (TLV) → Sri Lanka (CMB)"). Each card shows Booked checkbox on the left, meta in the middle, ✏ and × on the right. The old Research section should be gone.

- [ ] **Step 5: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js
git commit -m "feat: flights page grouped by leg, research section removed"
```

---

### Task 3: Booking confirmation + sibling deletion

**Files:**
- Modify: `app.js` — replace `toggleFlightBooked()`, add `ov-book-confirm` overlay
- Modify: `index.html` — add booking confirmation overlay HTML

**Interfaces:**
- Consumes: `legKey(origin, dest)` from Task 1; `renderFlightCard()` from Task 2
- Produces: `toggleFlightBooked(id, checkbox)`, `confirmBookFlight()`, `cancelBookFlight()` — called from HTML

- [ ] **Step 1: Add booking confirmation overlay to `index.html`**

Just before `</body>`, add:

```html
<!-- Booking confirmation -->
<div class="overlay" id="ov-book-confirm"><div class="modal">
  <h3>Congrats! 🎉</h3>
  <p id="book-confirm-msg" style="margin:8px 0 20px;color:var(--ink-soft);font-size:15px;line-height:1.5"></p>
  <div class="modal-actions">
    <button class="btn ghost" onclick="cancelBookFlight()">Cancel</button>
    <button class="btn" onclick="confirmBookFlight()">OK</button>
  </div>
</div></div>
```

- [ ] **Step 2: Replace `toggleFlightBooked()` in `app.js`**

Find the existing `toggleFlightBooked` function and replace it entirely with:

```javascript
let _pendingBookId   = null;
let _pendingBookChkb = null;

async function toggleFlightBooked(id, checkbox) {
  const f = flights.find(x => x.id === id);
  if (!f) return;

  if (!checkbox.checked) {
    // Un-booking: just save, no confirmation
    f.booked = false;
    if (GUEST_MODE) lsUpdate('flights', id, { booked: false });
    else await sb.from('flights').update({ booked: false }).eq('id', id);
    renderFlights();
    return;
  }

  // Booking: check for siblings
  const key = legKey(f.origin, f.destination);
  const siblings = flights.filter(x => x.id !== id && legKey(x.origin, x.destination) === key);

  if (!siblings.length) {
    // No siblings — save immediately
    f.booked = true;
    if (GUEST_MODE) lsUpdate('flights', id, { booked: true });
    else await sb.from('flights').update({ booked: true }).eq('id', id);
    renderFlights();
    return;
  }

  // Show confirmation
  _pendingBookId   = id;
  _pendingBookChkb = checkbox;
  const n = siblings.length;
  document.getElementById('book-confirm-msg').textContent =
    `I'll now delete the other ${n} option${n > 1 ? 's' : ''} for this leg. OK?`;
  openOverlay('ov-book-confirm');
}

async function confirmBookFlight() {
  closeAll();
  const id = _pendingBookId;
  _pendingBookId = _pendingBookChkb = null;
  if (!id) return;

  const f = flights.find(x => x.id === id);
  if (!f) return;

  const key = legKey(f.origin, f.destination);
  const siblings = flights.filter(x => x.id !== id && legKey(x.origin, x.destination) === key);

  for (const s of siblings) {
    if (GUEST_MODE) lsDelete('flights', s.id);
    else await sb.from('flights').delete().eq('id', s.id);
  }

  f.booked = true;
  if (GUEST_MODE) lsUpdate('flights', id, { booked: true });
  else await sb.from('flights').update({ booked: true }).eq('id', id);

  await refreshAll();
}

function cancelBookFlight() {
  closeAll();
  if (_pendingBookChkb) _pendingBookChkb.checked = false;
  _pendingBookId = _pendingBookChkb = null;
}
```

- [ ] **Step 3: Test booking with siblings**

1. Add two flights for the same leg (e.g. TLV→BKK)
2. Check "Booked" on one → confirmation overlay appears with the correct message
3. Tap Cancel → checkbox reverts to unchecked, both flights still exist
4. Check "Booked" again → tap OK → sibling is deleted, booked flight remains

- [ ] **Step 4: Test booking without siblings**

Add one flight for a leg. Check "Booked" → no confirmation, saves immediately.

- [ ] **Step 5: Test un-booking**

Uncheck "Booked" on a booked flight → no confirmation, saves immediately.

- [ ] **Step 6: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app.js index.html
git commit -m "feat: booking confirmation with sibling deletion"
```

---

### Task 4: Drag to reorder legs

**Files:**
- Modify: `app.js` — add drag handlers, call `initLegDrag()` on first render

**Interfaces:**
- Consumes: `saveLegOrder(order)` from Task 1; `renderFlights()` from Task 2; `legOrder` global
- Produces: `initLegDrag()` — initialises drag on `#flightList` container once

- [ ] **Step 1: Add drag handler code to `app.js`**

Add after `renderFlightCard` (from Task 2):

```javascript
let _dragKey     = null;
let _legDragInit = false;

function initLegDrag() {
  if (_legDragInit) return;
  _legDragInit = true;
  const el = document.getElementById('flightList');

  el.addEventListener('dragstart', e => {
    const handle = e.target.closest('.drag-handle[data-key]');
    if (!handle) { e.preventDefault(); return; }
    _dragKey = handle.dataset.key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragKey);
    handle.closest('.leg-group')?.classList.add('dragging');
  });

  el.addEventListener('dragover', e => {
    if (!_dragKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const group = e.target.closest('.leg-group');
    el.querySelectorAll('.leg-group').forEach(g => g.classList.remove('drag-over'));
    if (group && group.dataset.key !== _dragKey) group.classList.add('drag-over');
  });

  el.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !el.contains(e.relatedTarget)) {
      el.querySelectorAll('.leg-group').forEach(g => g.classList.remove('drag-over'));
    }
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    const targetGroup = e.target.closest('.leg-group');
    if (!targetGroup || !_dragKey || targetGroup.dataset.key === _dragKey) {
      cleanupLegDrag(el); return;
    }
    const allKeys = [...el.querySelectorAll('.leg-group')].map(g => g.dataset.key);
    const fromIdx = allKeys.indexOf(_dragKey);
    const toIdx   = allKeys.indexOf(targetGroup.dataset.key);
    allKeys.splice(fromIdx, 1);
    allKeys.splice(toIdx, 0, _dragKey);
    cleanupLegDrag(el);
    await saveLegOrder(allKeys);
    renderFlights();
  });

  el.addEventListener('dragend', () => cleanupLegDrag(el));
}

function cleanupLegDrag(el) {
  _dragKey = null;
  el.querySelectorAll('.leg-group').forEach(g => g.classList.remove('dragging', 'drag-over'));
}
```

- [ ] **Step 2: Call `initLegDrag()` at the end of `renderFlights()`**

In the `renderFlights()` function added in Task 2, add one line at the very end, after the `el.innerHTML = ...` assignment:

```javascript
  initLegDrag();
```

The full end of `renderFlights()` should look like:

```javascript
  el.innerHTML = legs.map(leg => `...`).join('');
  initLegDrag();
}
```

- [ ] **Step 3: Test drag reorder**

1. Have at least two legs (e.g. TLV→BKK and BKK→SYD)
2. Drag the ⠿ handle of TLV→BKK below BKK→SYD — order should reverse
3. Refresh the page — order should persist (loaded from DB / localStorage)

- [ ] **Step 4: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: drag-to-reorder legs with persisted order"
```

---

### Task 5: Update globe animation to use west→east leg order

**Files:**
- Modify: `app.js:2001-2033` — replace `chainFlightsAsRoute()` function

**Interfaces:**
- Consumes: `groupFlightsByLeg(fs)` from Task 1 (which already respects `legOrder`)
- Produces: updated `chainFlightsAsRoute(fs)` — same signature, new implementation

- [ ] **Step 1: Replace `chainFlightsAsRoute()`**

Find `function chainFlightsAsRoute(fs)` (around line 2001) and replace the entire function with:

```javascript
function chainFlightsAsRoute(fs) {
  if (!fs.length) return [];
  // Group by leg (respects saved legOrder, falls back to west→east)
  const legs = groupFlightsByLeg(fs);
  // One representative flight per leg: booked one if available, else first by created_at
  return legs
    .map(leg => leg.flights.find(f => f.booked) || leg.flights[0])
    .filter(Boolean);
}
```

- [ ] **Step 2: Verify the animation uses one arc per leg**

Call `previewTrip()` (the globe animation button). Confirm:
- Each leg appears once (no duplicate arcs for legs with multiple options)
- Legs animate in the saved order (west→east if not manually reordered)
- The preview card shows the correct leg info (airline, date, price from the booked/first flight)

- [ ] **Step 3: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: globe animation uses leg order (west→east, one arc per leg)"
```
