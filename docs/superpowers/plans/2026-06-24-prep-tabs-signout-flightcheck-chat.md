# Prep Tabs, Sign-out Redesign, Native Booked Checkbox, Chat Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Prep checklist into tabs (Todos / Drugs & First Aid / Shopping List / unlimited custom tabs), redesign the sign-out control (small circular icon, confirmation prompt), swap the flight card's booked indicator for a real checkbox, and remove the Chat tab.

**Architecture:** Single-file vanilla JS app (`app.js` + `index.html`, no build step). Each change is additive to the existing patterns already used in the file — no new abstractions, no framework introduced.

**Tech Stack:** Vanilla JS, Supabase JS client (Postgres + RLS + Edge Functions), localStorage for guest mode.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-24-prep-tabs-signout-flightcheck-chat-design.md`.
- This codebase has **no automated test runner for UI code** (confirmed: the only test file, `update-digest.test.js`, covers one pure text-formatting function via plain `node assert`). Every prior accepted spec in this repo (see `docs/superpowers/specs/2026-06-21-update-center-design.md`) states the testing approach is **manual verification** — this plan follows that same convention. Each task's verification step is a concrete manual check (guest mode in a browser via the `run` skill, or — for the one DB/edge-function-dependent task — a code-level sanity check plus instructions for the user to verify live).
- Any new Supabase `select`/query against a trip-scoped table **must** include `.eq('trip_id', TRIP_ID)`. (A real bug was just fixed in this codebase — `app.js` previously queried `countries`/`places`/`flights`/`hotels`/`expenses` with no trip filter, leaking data across trips via RLS. Do not repeat that mistake in the new `prep_tabs` queries.)
- SQL changes go into `features.sql` (the existing append-only, `if not exists`-guarded migration log for this project) and are **not** applied by Claude directly against the live database — there is no local Supabase/Docker running, and the configured project is the user's real production data. The user runs new SQL manually in the Supabase SQL editor, exactly as the existing in-app error message at `app.js` already tells them to do for other features.
- Commit directly to `main` after each task (no feature branches/PRs), per this project's established workflow.
- Follow existing code style: no semicolons-only-sometimes inconsistency — match whatever the surrounding function already does (this file is consistently semicolon-terminated).

---

### Task 1: Remove the Chat section

**Files:**
- Modify: `index.html` (nav button, `#page-chat` section, chat CSS block)
- Modify: `app.js` (chat state/functions, `showTab` override)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. Confirms `chat-plan` edge function and the `mode: 'todo'` path (used by AI Suggest, kept) are untouched — later tasks rely on `sb.functions.invoke('chat-plan', { ..., mode: 'todo' })` continuing to work exactly as today.

- [ ] **Step 1: Remove the Chat nav button**

In `index.html`, find:

```html
      <button data-tab="prep" onclick="showTab('prep')">Prep</button>
      <button data-tab="chat" onclick="showTab('chat')">✦ Chat</button>
    </nav>
```

Replace with:

```html
      <button data-tab="prep" onclick="showTab('prep')">Prep</button>
    </nav>
```

- [ ] **Step 2: Remove the `#page-chat` section**

In `index.html`, find:

```html
    </section>

    <!-- CHAT TAB -->
    <section class="page" id="page-chat">
      <div class="page-head">
        <div><h2>Plan with AI</h2><p>Ask anything about your trip.</p></div>
        <button class="btn ghost small" onclick="clearChat()">Clear history</button>
      </div>
      <div id="chatMessages" class="chat-messages"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" rows="2" placeholder="Find me a kid-friendly beach in Sri Lanka… or: What should we do first in Goa?"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea>
        <button class="btn" onclick="sendChat()">Send</button>
      </div>
    </section>

    <footer>
```

Replace with:

```html
    </section>

    <footer>
```

- [ ] **Step 3: Remove the chat CSS block**

In `index.html`, find:

```css
  .todo-ai-actions{display:flex;gap:8px}

  /* CHAT */
  .chat-messages{display:flex;flex-direction:column;gap:14px;margin-bottom:16px;
    min-height:100px;max-height:60vh;overflow-y:auto;padding-right:4px}
  .chat-msg{max-width:88%;border-radius:16px;padding:12px 16px;font-size:15px;line-height:1.55}
  .chat-msg.user{background:var(--accent);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
  .chat-msg.assistant{background:var(--paper);border:1px solid var(--line);align-self:flex-start;border-bottom-left-radius:4px}
  .chat-input-row{display:flex;gap:10px;align-items:flex-end;position:sticky;bottom:0;
    background:var(--bg);padding:12px 0 4px}
  .chat-input-row textarea{flex:1;resize:none;font-size:15px;border-radius:12px;padding:10px 14px;
    border:1px solid var(--line);font-family:'Newsreader',serif}
  .chat-sugg-cards{display:flex;flex-direction:column;gap:8px;margin-top:10px}
  .sugg-card{background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .sugg-card-img{width:100%;height:120px;object-fit:cover;display:block;background:var(--accent-soft)}
  .sugg-card-body{padding:10px 12px}
  .sugg-card-name{font-family:'Fraunces',serif;font-weight:600;font-size:16px;margin-bottom:3px}
  .sugg-card-desc{font-size:13px;color:var(--ink-soft);margin-bottom:8px}
  .sugg-card-actions{display:flex;gap:8px;flex-wrap:wrap}

  /* UPDATE CENTER */
```

Replace with:

```css
  .todo-ai-actions{display:flex;gap:8px}

  /* UPDATE CENTER */
```

- [ ] **Step 4: Remove the chat state/functions block from `app.js`**

In `app.js`, find this entire block (it starts right after `hidePreviewCard()`'s closing brace and ends right before the `FEATURE 2: PRE-TRIP TODO LIST` comment):

```js

/* ================================================================
   FEATURE 1: PLANNING CHAT
   ================================================================ */
let chatHistory = [];
let chatLoaded  = false;

async function loadChat() {
  if (chatLoaded || GUEST_MODE) return;
  const { data } = await sb.from('trip_chat').select('*')
    .eq('trip_id', TRIP_ID).order('created_at');
  chatHistory = data || [];
  chatLoaded = true;
  renderChat();
}

function renderChat() {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  if (!chatHistory.length) {
    el.innerHTML = '<div style="color:var(--ink-soft);font-style:italic;font-size:14px;padding:20px 0">Ask me anything about your trip — places to visit, what to do with kids, how to split your time…</div>';
    return;
  }
  el.innerHTML = chatHistory.map(m => {
    let html = `<div class="chat-msg ${m.role}">`;
    html += `<div>${esc(m.content)}</div>`;
    if (m.role === 'assistant' && m.suggestions?.length) {
      html += `<div class="chat-sugg-cards">`;
      m.suggestions.forEach((s, i) => {
        const mid = `${m.id}_${i}`;
        html += renderSuggCard(s, mid);
      });
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function renderSuggCard(s, mid) {
  const mapsUrl = `https://www.google.com/maps/search/?q=${encodeURIComponent(s.name + (s.country ? ' ' + s.country : ''))}`;
  const wikiImg = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s.name)}`;
  const confirmed = s.confirmed;
  return `<div class="sugg-card" id="sugg-${mid}">
    <img class="sugg-card-img" src="" alt="${esc(s.name)}"
      onerror="this.style.display='none'"
      onload="this.style.display='block'"
      data-wiki="${esc(wikiImg)}"
      style="display:none">
    <div class="sugg-card-body">
      <div class="sugg-card-name">${esc(s.name)}${s.country ? `<span style="color:var(--ink-soft);font-weight:400;font-size:13px"> · ${esc(s.country)}</span>` : ''}</div>
      <div class="sugg-card-desc">${esc(s.description || '')}</div>
      <div class="sugg-card-actions">
        <a href="${mapsUrl}" target="_blank" class="btn ghost small">🔍 Google Maps</a>
        ${confirmed
          ? `<button class="btn small ghost" disabled style="color:var(--accent)">✓ Added</button>`
          : `<button class="btn small" onclick="confirmSuggestion('${mid}')">✓ Add to trip</button>`}
      </div>
    </div>
  </div>`;
}

// Lazy-load Wikipedia photos
function loadWikiPhotos() {
  document.querySelectorAll('[data-wiki]').forEach(async img => {
    if (img.dataset.loaded) return;
    img.dataset.loaded = '1';
    try {
      const r = await fetch(img.dataset.wiki);
      const d = await r.json();
      if (d.thumbnail?.source) { img.src = d.thumbnail.source; }
    } catch (_) {}
  });
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const userMsg = { role: 'user', content: text };
  chatHistory.push(userMsg);
  renderChat();

  // Thinking indicator
  const el = document.getElementById('chatMessages');
  el.innerHTML += `<div class="chat-msg assistant" id="chat-thinking"><em style="color:var(--ink-soft)">Thinking…</em></div>`;
  el.scrollTop = el.scrollHeight;

  const tripContext = {
    countries: countries.map(c => ({ name: c.name, planned_days: c.planned_days })),
    flights: flights.map(f => ({ from: f.origin, to: f.destination, date: f.depart_date })),
  };

  const messages = chatHistory.slice(-12).map(m => ({ role: m.role, content: m.content }));

  try {
    const { data, error } = await sb.functions.invoke('chat-plan', {
      body: { messages, tripContext, preferences: tripPreferences, mode: 'chat' },
    });

    document.getElementById('chat-thinking')?.remove();

    if (error || !data) {
      chatHistory.push({ role: 'assistant', content: error?.message || 'Could not reach AI.', suggestions: [] });
    } else {
      const assistantMsg = {
        role: 'assistant',
        content: data.reply || '',
        suggestions: data.suggestions || [],
        _tempId: Date.now(),
      };
      chatHistory.push(assistantMsg);

      // Save to DB
      if (!GUEST_MODE) {
        const saves = [
          sb.from('trip_chat').insert({ trip_id: TRIP_ID, role: 'user', content: text }),
          sb.from('trip_chat').insert({ trip_id: TRIP_ID, role: 'assistant', content: data.reply, suggestions: data.suggestions || [] }),
        ];
        const [, { data: saved }] = await Promise.all(saves);
        if (saved?.[0]?.id) assistantMsg.id = saved[0].id;
      }
    }
    renderChat();
    setTimeout(loadWikiPhotos, 300);
  } catch (e) {
    document.getElementById('chat-thinking')?.remove();
    chatHistory.push({ role: 'assistant', content: 'Error: ' + String(e), suggestions: [] });
    renderChat();
  }
}

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

async function clearChat() {
  if (!confirm('Clear all chat history?')) return;
  chatHistory = [];
  chatLoaded = false;
  if (!GUEST_MODE) await sb.from('trip_chat').delete().eq('trip_id', TRIP_ID);
  renderChat();
}
```

Replace with nothing (delete the whole block, leaving a single blank line between `hidePreviewCard()`'s closing brace and the `FEATURE 2: PRE-TRIP TODO LIST` comment).

- [ ] **Step 5: Remove the chat branch from the `showTab` override**

In `app.js`, find:

```js
  if (t === 'prep') refreshTodos();
  if (t === 'chat') { loadChat(); setTimeout(loadWikiPhotos, 400); }
}
```

Replace with:

```js
  if (t === 'prep') refreshTodos();
}
```

- [ ] **Step 6: Verify**

Run: `node --check app.js` — expect no syntax errors.

Run: `grep -n "chat\|Chat" app.js index.html` — expect zero matches inside `app.js`/`index.html` (the `chat-plan` edge function under `supabase/functions/` is untouched and out of scope for this grep).

Manual check via the `run` skill (guest mode, no Supabase needed): load the app, confirm there is no "Chat" tab in the nav, no console errors on load, and that "✦ AI suggest" on the Prep tab still works end-to-end (proves the shared `chat-plan` edge function survived).

- [ ] **Step 7: Commit**

```bash
git add app.js index.html
git commit -m "Remove the Chat tab; keep AI Suggest's shared edge function intact"
```

---

### Task 2: Native checkbox for the flight "Booked" indicator

**Files:**
- Modify: `app.js:884-903` (`renderFlights`)

**Interfaces:**
- Consumes: `toggleFlightBooked(id)` (already exists, unchanged: `app.js:905-911`).
- Produces: nothing new.

- [ ] **Step 1: Swap the custom checkbox span for a real `<input type="checkbox">`**

In `app.js`, inside `renderFlights()`, find:

```js
      <div class="flight-meta">
        <span style="display:inline-flex;align-items:center;gap:6px;cursor:pointer" onclick="event.stopPropagation();toggleFlightBooked('${f.id}')">
          <span class="todo-check${f.booked ? ' done' : ''}" style="width:18px;height:18px">${f.booked ? '✓' : ''}</span>
          <span>Booked</span>
        </span>
```

Replace with:

```js
      <div class="flight-meta">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer" onclick="event.stopPropagation()">
          <input type="checkbox" ${f.booked ? 'checked' : ''} onchange="toggleFlightBooked('${f.id}')">
          <span>Booked</span>
        </label>
```

(No CSS change needed — `index.html` already has a global `input[type=checkbox]{width:auto;padding:0;border:none;background:none;accent-color:var(--accent);transform:scale(1.1)}` rule, currently used by the hotel "Booked" checkbox, that will style this one identically.)

- [ ] **Step 2: Verify**

Run: `node --check app.js` — expect no syntax errors.

Manual check via the `run` skill (guest mode): add a flight, confirm a native checkbox (not a green square) appears next to "Booked", toggling it updates immediately and persists after switching tabs and back, and clicking it does **not** open the edit-flight modal (the card's own `onclick="editFlight(...)"` must not fire).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Use a native checkbox for the flight Booked toggle"
```

---

### Task 3: Sign-out redesign (smaller, higher, with confirmation)

**Files:**
- Modify: `index.html` (header CSS, header markup)
- Modify: `app.js` (`doLogout`, `enterAsGuest`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Restyle the header and the button into a circle**

In `index.html`, find:

```css
  header.top{display:flex;align-items:baseline;justify-content:space-between;padding:34px 0 10px;gap:16px;flex-wrap:wrap}
  #logout-btn{margin-left:auto}
```

Replace with:

```css
  header.top{display:flex;align-items:center;justify-content:space-between;padding:34px 0 10px;gap:16px;flex-wrap:wrap}
  #logout-btn{margin-left:auto;width:34px;height:34px;border-radius:50%;padding:0;
    display:flex;align-items:center;justify-content:center;flex-shrink:0}
```

- [ ] **Step 2: Replace the button's text with an icon**

In `index.html`, find:

```html
    <header class="top">
      <div class="brand"><span class="dot"></span><h1>TriPlan</h1><small>plan your trip. together.</small></div>
      <button id="logout-btn" class="btn ghost small" onclick="doLogout()">Sign out</button>
    </header>
```

Replace with:

```html
    <header class="top">
      <div class="brand"><span class="dot"></span><h1>TriPlan</h1><small>plan your trip. together.</small></div>
      <button id="logout-btn" class="btn ghost small" onclick="doLogout()" title="Sign out" aria-label="Sign out">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
    </header>
```

- [ ] **Step 3: Add the confirmation prompt, and stop stomping the icon with text**

In `app.js`, find:

```js
function enterAsGuest(persist = true) {
  GUEST_MODE = true;
  TRIP_ID = GUEST_TRIP_ID;
  if (persist) localStorage.setItem('triplanner_guest_mode', '1');
  document.getElementById('auth').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.querySelector('footer').textContent = 'Guest mode · data is saved only on this device.';
  document.getElementById('logout-btn').textContent = 'Exit guest';
  refreshAll();
}
```

Replace with:

```js
function enterAsGuest(persist = true) {
  GUEST_MODE = true;
  TRIP_ID = GUEST_TRIP_ID;
  if (persist) localStorage.setItem('triplanner_guest_mode', '1');
  document.getElementById('auth').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.querySelector('footer').textContent = 'Guest mode · data is saved only on this device.';
  document.getElementById('logout-btn').title = 'Exit guest';
  refreshAll();
}
```

Then find:

```js
async function doLogout() {
  if (GUEST_MODE) {
    GUEST_MODE = false;
    TRIP_ID = null;
    localStorage.removeItem('triplanner_guest_mode');
    document.getElementById('logout-btn').textContent = 'Sign out';
    showAuth();
    return;
  }
  await sb.auth.signOut();
}
```

Replace with:

```js
async function doLogout() {
  if (GUEST_MODE) {
    if (!confirm('Exit guest mode?')) return;
    GUEST_MODE = false;
    TRIP_ID = null;
    localStorage.removeItem('triplanner_guest_mode');
    document.getElementById('logout-btn').title = 'Sign out';
    showAuth();
    return;
  }
  if (!confirm('Sign out?')) return;
  await sb.auth.signOut();
}
```

- [ ] **Step 4: Verify**

Run: `node --check app.js` — expect no syntax errors.

Manual check via the `run` skill: confirm the button is now a small circle with a door/arrow icon, vertically centered with "TriPlan" (not hanging below the baseline). Click it and confirm a "Sign out?" browser confirm dialog appears; clicking Cancel keeps you logged in, clicking OK signs you out. Enter guest mode and confirm the same button shows "Exit guest" as its tooltip and prompts "Exit guest mode?".

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "Redesign sign-out as a small circular icon button with a confirm prompt"
```

---

### Task 4: Prep tabs — schema and sub-tab navigation

**Files:**
- Modify: `features.sql` (new column + new table)
- Modify: `index.html` (sub-tab bar markup, add-tab modal, CSS)
- Modify: `app.js` (`refreshTodos`, `renderTodos`, `saveTodo`, new tab-state/render functions)

**Interfaces:**
- Consumes: `lsGet`/`lsInsert` (existing generic localStorage helpers, `app.js:25-35`), `closeAll()`/`openOverlay(id)` (existing generic modal helpers, `app.js:1180,1191`), `esc()` (`app.js:1175`).
- Produces (for Task 5 to consume):
  - `let activePrepTab` — string, currently-selected tab id (`'todos'`, `'first_aid'`, `'shopping'`, or a `prep_tabs.id`).
  - `let prepTabs` — array of `{id, trip_id, name, created_at}` (custom tabs only).
  - `const PREP_BUILTIN_TABS` — array of `{id, name}`, the 3 fixed tabs.
  - `function activePrepTabName()` — returns the display name (string) of whichever tab is active.
  - `let todos` — now each row carries `category` (string).

- [ ] **Step 1: Append the migration to `features.sql`**

In `features.sql`, after the existing "Feature 4: Hotels" block (end of file), append:

```sql

-- Feature 5: Prep tabs (split the pre-trip checklist into categories)
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

This is not run automatically — flag to the user at the end of this task that they need to paste this block into the Supabase SQL editor for their project before the real (non-guest) Prep tabs will persist correctly.

- [ ] **Step 2: Add tab state, built-in tab list, and the tab-bar/modal render functions**

In `app.js`, find:

```js
let todos = [];

async function refreshTodos() {
  if (GUEST_MODE) { todos = lsGet('todos').filter(r => r.trip_id === TRIP_ID); renderTodos(); return; }
  const { data } = await sb.from('trip_todos').select('*').eq('trip_id', TRIP_ID).order('deadline').order('created_at');
  todos = data || [];
  renderTodos();
}
```

Replace with:

```js
let todos = [];
let prepTabs = [];
let activePrepTab = 'todos';
const PREP_BUILTIN_TABS = [
  { id: 'todos', name: 'Todos' },
  { id: 'first_aid', name: 'Drugs & First Aid' },
  { id: 'shopping', name: 'Shopping List' },
];

function activePrepTabName() {
  const builtin = PREP_BUILTIN_TABS.find(t => t.id === activePrepTab);
  if (builtin) return builtin.name;
  return prepTabs.find(t => t.id === activePrepTab)?.name || 'Todos';
}

async function refreshTodos() {
  if (GUEST_MODE) {
    todos = lsGet('todos').filter(r => r.trip_id === TRIP_ID);
    prepTabs = lsGet('prep_tabs').filter(r => r.trip_id === TRIP_ID);
    renderPrepTabs(); renderTodos();
    return;
  }
  const [t, pt] = await Promise.all([
    sb.from('trip_todos').select('*').eq('trip_id', TRIP_ID).order('deadline').order('created_at'),
    sb.from('prep_tabs').select('*').eq('trip_id', TRIP_ID).order('created_at'),
  ]);
  todos = t.data || [];
  prepTabs = pt.data || [];
  renderPrepTabs(); renderTodos();
}

function renderPrepTabs() {
  const el = document.getElementById('prepTabBar');
  if (!el) return;
  const allTabs = [...PREP_BUILTIN_TABS, ...prepTabs.map(t => ({ id: t.id, name: t.name }))];
  if (!allTabs.find(t => t.id === activePrepTab)) activePrepTab = 'todos';
  el.innerHTML = allTabs.map(t =>
    `<button class="prep-tab${t.id === activePrepTab ? ' active' : ''}" onclick="switchPrepTab('${t.id}')">${esc(t.name)}</button>`
  ).join('') + `<button class="prep-tab add" onclick="openAddPrepTab()">＋</button>`;
}

function switchPrepTab(id) {
  activePrepTab = id;
  renderPrepTabs();
  renderTodos();
}

function openAddPrepTab() {
  document.getElementById('prep-tab-name').value = '';
  openOverlay('ov-prep-tab');
}

async function savePrepTab() {
  const name = document.getElementById('prep-tab-name').value.trim();
  if (!name) return;
  const row = { trip_id: TRIP_ID, name };
  let newTab;
  if (GUEST_MODE) {
    newTab = lsInsert('prep_tabs', row);
  } else {
    const { data, error } = await sb.from('prep_tabs').insert(row).select().single();
    if (error) { alert(error.message); return; }
    newTab = data;
  }
  prepTabs.push(newTab);
  activePrepTab = newTab.id;
  closeAll();
  renderPrepTabs();
  renderTodos();
}
```

- [ ] **Step 3: Filter the rendered list by the active tab**

In `app.js`, find:

```js
function renderTodos() {
  const el = document.getElementById('todoList');
  if (!el) return;
  if (!todos.length) {
    el.innerHTML = '<div class="empty">No tasks yet. Add things you need to do before the trip, or ask AI to suggest some.</div>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = todos.map(t => {
```

Replace with:

```js
function renderTodos() {
  const el = document.getElementById('todoList');
  if (!el) return;
  const items = todos.filter(t => (t.category || 'todos') === activePrepTab);
  if (!items.length) {
    el.innerHTML = '<div class="empty">No tasks yet. Add things you need to do before the trip, or ask AI to suggest some.</div>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = items.map(t => {
```

- [ ] **Step 4: Tag new todos with the active tab's category**

In `app.js`, inside `saveTodo()`, find:

```js
    const row = { trip_id: TRIP_ID, title, deadline, done: false };
```

Replace with:

```js
    const row = { trip_id: TRIP_ID, title, deadline, done: false, category: activePrepTab };
```

- [ ] **Step 5: Add the sub-tab bar to the Prep page markup**

In `index.html`, find:

```html
    <!-- PREP TAB -->
    <section class="page" id="page-prep">
      <div class="page-head">
        <div><h2>Prep</h2><p>Things to do before you go.</p></div>
        <div style="display:flex;gap:10px">
          <button class="btn ghost" onclick="suggestTodos()">✦ AI suggest</button>
          <button class="btn" onclick="openAddTodo()">＋ Add task</button>
        </div>
      </div>
      <div id="todoList"></div>
    </section>
```

Replace with:

```html
    <!-- PREP TAB -->
    <section class="page" id="page-prep">
      <div class="page-head">
        <div><h2>Prep</h2><p>Things to do before you go.</p></div>
        <div style="display:flex;gap:10px">
          <button class="btn ghost" onclick="suggestTodos()">✦ AI suggest</button>
          <button class="btn" onclick="openAddTodo()">＋ Add task</button>
        </div>
      </div>
      <div id="prepTabBar" class="prep-tab-bar"></div>
      <div id="todoList"></div>
    </section>
```

- [ ] **Step 6: Add the "new tab" modal**

In `index.html`, find:

```html
<!-- Add Todo modal -->
<div class="overlay" id="ov-todo"><div class="modal">
  <h3>Add task</h3>
  <label>Task</label>
  <input id="todo-title" placeholder="e.g. Book pet sitter, Get travel insurance">
  <label>Deadline (optional)</label>
  <input id="todo-deadline" type="date">
  <div class="modal-actions">
    <button class="btn ghost" onclick="closeAll()">Cancel</button>
    <button class="btn" onclick="saveTodo()">Add</button>
  </div>
</div></div>
```

Replace with:

```html
<!-- Add Todo modal -->
<div class="overlay" id="ov-todo"><div class="modal">
  <h3>Add task</h3>
  <label>Task</label>
  <input id="todo-title" placeholder="e.g. Book pet sitter, Get travel insurance">
  <label>Deadline (optional)</label>
  <input id="todo-deadline" type="date">
  <div class="modal-actions">
    <button class="btn ghost" onclick="closeAll()">Cancel</button>
    <button class="btn" onclick="saveTodo()">Add</button>
  </div>
</div></div>

<!-- Add Prep tab modal -->
<div class="overlay" id="ov-prep-tab"><div class="modal">
  <h3>New tab</h3>
  <label>Tab name</label>
  <input id="prep-tab-name" placeholder="e.g. Kids' stuff">
  <div class="modal-actions">
    <button class="btn ghost" onclick="closeAll()">Cancel</button>
    <button class="btn" onclick="savePrepTab()">Add</button>
  </div>
</div></div>
```

- [ ] **Step 7: Add the sub-tab bar CSS**

In `index.html`, find:

```css
  /* TODO LIST */
```

Replace with:

```css
  /* PREP TABS */
  .prep-tab-bar{display:flex;gap:6px;margin-bottom:16px;overflow-x:auto;touch-action:pan-x;
    scrollbar-width:none;-ms-overflow-style:none}
  .prep-tab-bar::-webkit-scrollbar{display:none}
  .prep-tab{font-family:'Fraunces',serif;font-size:14px;color:var(--ink-soft);background:var(--paper);
    border:1px solid var(--line);border-radius:20px;padding:7px 14px;cursor:pointer;flex-shrink:0;white-space:nowrap}
  .prep-tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .prep-tab.add{color:var(--accent);border-style:dashed}

  /* TODO LIST */
```

- [ ] **Step 8: Verify**

Run: `node --check app.js` — expect no syntax errors.

Manual check via the `run` skill (guest mode — exercises the full localStorage path with no SQL needed): open Prep, confirm 3 tabs (Todos, Drugs & First Aid, Shopping List) plus a "＋" are shown; add a task under "Todos", switch to "Shopping List", confirm the list is empty there (the Todos item doesn't leak across tabs); add a custom tab named "Test tab", confirm it appears in the bar and becomes active; add an item to it; refresh the page (still guest mode) and confirm the custom tab and its item persisted.

- [ ] **Step 9: Commit**

```bash
git add app.js index.html features.sql
git commit -m "Split Prep into Todos / Drugs & First Aid / Shopping List / custom tabs"
```

After this commit, tell the user: run the new `features.sql` "Feature 5" block in the Supabase SQL editor before testing Prep tabs in the real (non-guest) app.

---

### Task 5: Prep tabs — AI suggest per category

**Files:**
- Modify: `supabase/functions/chat-plan/index.ts` (`buildTodoSystemPrompt`, request destructuring)
- Modify: `app.js` (`getSeenTodoTitles`, `addSeenTodoTitle`, `suggestTodos`, `acceptAiTodo`)

**Interfaces:**
- Consumes: `activePrepTab`, `activePrepTabName()` (from Task 4).
- Produces: nothing new for later tasks (this is the last task).

- [ ] **Step 1: Make the edge function's todo prompt category-aware**

In `supabase/functions/chat-plan/index.ts`, find:

```ts
    const { messages, tripContext, preferences, mode } = await req.json();
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    const isTodo = mode === "todo";

    const systemPrompt = isTodo
      ? buildTodoSystemPrompt(tripContext, preferences)
      : buildChatSystemPrompt(tripContext, preferences);
```

Replace with:

```ts
    const { messages, tripContext, preferences, mode, category } = await req.json();
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    const isTodo = mode === "todo";

    const systemPrompt = isTodo
      ? buildTodoSystemPrompt(tripContext, preferences, category)
      : buildChatSystemPrompt(tripContext, preferences);
```

Then find:

```ts
function buildTodoSystemPrompt(ctx: any, prefs: any) {
  const destList = (ctx?.countries || []).map((c: any) => c.name).join(", ");
  const prefText = prefs?.notes || "";

  const alreadySeen = (ctx?.existingTodos || []).slice(0, 30).join(", ");
  return `You are helping a family prepare for a trip to: ${destList || "various destinations"}.
${prefText ? `Family notes: ${prefText}` : ""}
${alreadySeen ? `Already suggested or added (do NOT repeat these): ${alreadySeen}` : ""}

Suggest 4-6 NEW practical pre-trip todos not already in the list above. Return JSON:
{
  "reply": "brief intro sentence",
  "todos": [
    {"title": "What to do", "deadline": "YYYY-MM-DD or null", "reason": "one short reason"}
  ]
}
Deadlines should be realistic (2-8 weeks before departure). Return ONLY valid JSON.`;
}
```

Replace with:

```ts
function buildTodoSystemPrompt(ctx: any, prefs: any, category?: string) {
  const destList = (ctx?.countries || []).map((c: any) => c.name).join(", ");
  const prefText = prefs?.notes || "";
  const categoryLabel = category || "Todos";

  const alreadySeen = (ctx?.existingTodos || []).slice(0, 30).join(", ");
  return `You are helping a family prepare for a trip to: ${destList || "various destinations"}.
${prefText ? `Family notes: ${prefText}` : ""}
${alreadySeen ? `Already suggested or added (do NOT repeat these): ${alreadySeen}` : ""}

Suggest 4-6 NEW practical items for the "${categoryLabel}" checklist for this trip, not already in the list above. Return JSON:
{
  "reply": "brief intro sentence",
  "todos": [
    {"title": "What to do", "deadline": "YYYY-MM-DD or null", "reason": "one short reason"}
  ]
}
Deadlines should be realistic (2-8 weeks before departure) — use null where a deadline doesn't make sense (e.g. shopping list items). Return ONLY valid JSON.`;
}
```

- [ ] **Step 2: Scope the "already seen" localStorage key per category**

In `app.js`, find:

```js
// Track suggested/skipped todos so AI doesn't repeat them
function getSeenTodoTitles() {
  const key = 'triplan_seen_todos_' + TRIP_ID;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function addSeenTodoTitle(title) {
  const key = 'triplan_seen_todos_' + TRIP_ID;
  const seen = getSeenTodoTitles();
  if (!seen.includes(title)) { seen.push(title); localStorage.setItem(key, JSON.stringify(seen)); }
}
```

Replace with:

```js
// Track suggested/skipped todos so AI doesn't repeat them, scoped per tab
function getSeenTodoTitles() {
  const key = 'triplan_seen_todos_' + TRIP_ID + '_' + activePrepTab;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function addSeenTodoTitle(title) {
  const key = 'triplan_seen_todos_' + TRIP_ID + '_' + activePrepTab;
  const seen = getSeenTodoTitles();
  if (!seen.includes(title)) { seen.push(title); localStorage.setItem(key, JSON.stringify(seen)); }
}
```

- [ ] **Step 3: Send the active tab's name and scope "existing titles" to that tab**

In `app.js`, find:

```js
async function suggestTodos() {
  const el = document.getElementById('todoList');
  el.innerHTML = '<div style="color:var(--ink-soft);font-style:italic;padding:20px 0">AI is thinking of what you need to prepare…</div>';

  const existingTitles = [
    ...todos.map(t => t.title),
    ...getSeenTodoTitles(),
  ];
  const tripContext = { countries: countries.map(c => ({ name: c.name })), existingTodos: existingTitles };

  try {
    const { data, error } = await sb.functions.invoke('chat-plan', {
      body: { messages: [{ role: 'user', content: 'Suggest pre-trip todos for my family trip.' }],
              tripContext, preferences: tripPreferences, mode: 'todo' },
    });
    if (error || !data?.todos?.length) { await refreshTodos(); return; }
    window._aiTodos = data.todos;

    // Pre-mark all as seen so next call skips them
    data.todos.forEach(t => addSeenTodoTitle(t.title));

    renderAiTodos(data.reply, data.todos);
  } catch (e) { await refreshTodos(); }
}
```

Replace with:

```js
async function suggestTodos() {
  const el = document.getElementById('todoList');
  el.innerHTML = '<div style="color:var(--ink-soft);font-style:italic;padding:20px 0">AI is thinking of what you need to prepare…</div>';

  const category = activePrepTabName();
  const existingTitles = [
    ...todos.filter(t => (t.category || 'todos') === activePrepTab).map(t => t.title),
    ...getSeenTodoTitles(),
  ];
  const tripContext = { countries: countries.map(c => ({ name: c.name })), existingTodos: existingTitles };

  try {
    const { data, error } = await sb.functions.invoke('chat-plan', {
      body: { messages: [{ role: 'user', content: `Suggest items for the ${category} checklist for my family trip.` }],
              tripContext, preferences: tripPreferences, mode: 'todo', category },
    });
    if (error || !data?.todos?.length) { await refreshTodos(); return; }
    window._aiTodos = data.todos;

    // Pre-mark all as seen so next call skips them
    data.todos.forEach(t => addSeenTodoTitle(t.title));

    renderAiTodos(data.reply, data.todos);
  } catch (e) { await refreshTodos(); }
}
```

- [ ] **Step 4: Tag accepted AI suggestions with the active tab's category**

In `app.js`, find:

```js
async function acceptAiTodo(idx, btn) {
  const t = window._aiTodos?.[idx]; if (!t) return;
  const row = { trip_id: TRIP_ID, title: t.title, deadline: t.deadline || null, done: false };
  if (GUEST_MODE) lsInsert('todos', row);
  else await sb.from('trip_todos').insert(row);
  todos.push({ ...row, id: Date.now().toString(36) });
```

Replace with:

```js
async function acceptAiTodo(idx, btn) {
  const t = window._aiTodos?.[idx]; if (!t) return;
  const row = { trip_id: TRIP_ID, title: t.title, deadline: t.deadline || null, done: false, category: activePrepTab };
  if (GUEST_MODE) lsInsert('todos', row);
  else await sb.from('trip_todos').insert(row);
  todos.push({ ...row, id: Date.now().toString(36) });
```

- [ ] **Step 5: Verify**

Run: `node --check app.js` — expect no syntax errors.

Run: `deno check supabase/functions/chat-plan/index.ts` if Deno is installed locally; otherwise visually re-read the diff for matching braces/parens (there is no local Supabase functions runtime available in this environment — Docker isn't running — so this cannot be executed end-to-end here).

Manual check (cannot be fully exercised without deploying the edge function, since AI Suggest always calls the live `chat-plan` function regardless of guest/auth mode): after deploying with `supabase functions deploy chat-plan`, click "✦ AI suggest" on the "Shopping List" tab and confirm the suggestions read as shopping items (not generic pre-trip todos), and that skipping/accepting one and reopening AI suggest on "Todos" doesn't show it as already-seen there.

- [ ] **Step 6: Commit**

```bash
git add app.js supabase/functions/chat-plan/index.ts
git commit -m "Make AI Suggest category-aware for Prep tabs"
```

After this commit, tell the user: deploy the updated edge function with `supabase functions deploy chat-plan` before AI Suggest reflects the per-tab prompts live.

---

## Final pass

After all 5 tasks are committed, do one more full manual walkthrough via the `run` skill in guest mode covering every change at once (Prep tab switching + custom tab + AI suggest framing where deployable, sign-out icon/position/confirm, native flight checkbox, absence of the Chat tab) to catch any interaction between the changes that per-task testing might have missed.
