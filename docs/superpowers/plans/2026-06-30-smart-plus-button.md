# Smart "+" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FAB "Capture a place" button with a universal smart input that accepts text, URLs, and images, classifies them with AI, and routes to the correct section after a confirmation step.

**Architecture:** A new `smart-parse` Supabase edge function accepts free-form input (text + optional image) alongside trip context and returns a classification + structured data. The front-end opens a single modal that transitions through three states (input → thinking → confirmation), then routes the confirmed result to the appropriate existing save function.

**Tech Stack:** Vanilla JS, Supabase (Edge Functions + Storage + DB), Anthropic Claude Haiku (vision-capable)

## Global Constraints

- No build step — edit `index.html` and `app.js` directly
- Reuse existing save helpers: `ensureCountry()`, `ensurePlace()`, `openFlight()`, storage pattern from `saveResearch()`
- Research items save to table `flight_research`, storage bucket `research`
- Todos save to table `trip_todos` with field `category` = prep tab id
- Claude model: `claude-haiku-4-5-20251001`
- Image size limit: 5 MB (consistent with existing research flow)
- FAB only visible on Countries tab — hidden on Flights, Budget, Prep

---

### Task 1: Hide FAB on non-Countries tabs

**Files:**
- Modify: `app.js:2350-2356` (the `showTab` override near bottom of file)

**Interfaces:**
- Produces: `showTab(t)` toggles `.fab` visibility based on `t === 'countries'`

- [ ] **Step 1: Edit the `showTab` override**

Find this block (around line 2350):
```javascript
const _origShowTab = showTab;
function showTab(t) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + t));
  if (t === 'prep') refreshTodos();
}
```

Replace with:
```javascript
const _origShowTab = showTab;
function showTab(t) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + t));
  if (t === 'prep') refreshTodos();
  document.querySelector('.fab').style.display = t === 'countries' ? '' : 'none';
}
```

- [ ] **Step 2: Verify in browser**

Open the app. The `+` FAB should be visible on Countries tab. Switch to Flights, Budget, Prep — FAB disappears. Switch back to Countries — FAB reappears.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: hide FAB on non-Countries tabs"
```

---

### Task 2: `smart-parse` edge function

**Files:**
- Create: `supabase/functions/smart-parse/index.ts`

**Interfaces:**
- Consumes: `{ text?: string, imageBase64?: string, tripContext: { countries: string[], prepTabs: { id: string, name: string }[] } }`
- Produces: `{ type: 'flight'|'hotel'|'place'|'todo'|'unknown', summary: string, destination: string, extractedData: object }`

- [ ] **Step 1: Create the edge function file**

Create `supabase/functions/smart-parse/index.ts`:

```typescript
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { text, imageBase64, tripContext } = await req.json();
    if (!text && !imageBase64) return json({ error: "Provide text or image" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    const countries: string[] = tripContext?.countries || [];
    const prepTabs: { id: string; name: string }[] = tripContext?.prepTabs || [
      { id: "todos", name: "Todos" },
    ];

    const systemPrompt = `You are a travel app assistant. Parse the user's input and classify it.

Existing countries in this trip: ${countries.length ? countries.join(", ") : "none yet"}
Available prep tabs: ${prepTabs.map((t) => `${t.id} ("${t.name}")`).join(", ")}

Return ONLY a JSON object — no markdown, no explanation:
{
  "type": "flight | hotel | place | todo | unknown",
  "summary": "one sentence describing what was found, e.g. 'Flight TLV → BKK on Aug 12'",
  "destination": "flight_research | hotels | countries | <prep-tab-id>",
  "extractedData": {}
}

extractedData by type:
- flight: { "origin": "IATA or city", "destination": "IATA or city", "depart_date": "YYYY-MM-DD or null", "depart_time": "HH:MM or null", "airline": "string or null", "flight_no": "string or null", "price": "string or null", "notes": "string or null" }
- hotel: { "name": "hotel name or null", "city": "city or null", "country": "country name or null", "link": "url or null" }
- place: { "name": "city/place name", "country": "country name or null" }
- todo: { "text": "the task text, translated to English if in another language" }
- unknown: {}

For destination, use the prep tab id that best fits (e.g. "todos" for general tasks, "shopping" for items to buy, "first_aid" for medical items). If no prep tab fits, use "todos".

For unknown content, still make a best guess at type and destination.`;

    const contentBlocks: unknown[] = [];
    if (imageBase64) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
      });
    }
    contentBlocks.push({
      type: "text",
      text: text
        ? `Parse this input:\n${text}`
        : "Parse the image above and extract travel-related information.",
    });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    const data = await r.json();
    const raw = (data.content || []).map((b: { text: string }) => b.text).join("").trim();

    let type = "unknown", summary = "Could not parse", destination = "todos";
    let extractedData: Record<string, unknown> = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        type = parsed.type || "unknown";
        summary = parsed.summary || "Could not parse";
        destination = parsed.destination || "todos";
        extractedData = parsed.extractedData || {};
      }
    } catch (_) {}

    return json({ type, summary, destination, extractedData });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
```

- [ ] **Step 2: Deploy the function**

```bash
supabase functions deploy smart-parse
```

Expected output: `Deployed smart-parse`

- [ ] **Step 3: Smoke test with curl**

```bash
curl -X POST "$(cat supabase/.temp/linked-project.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('https://'+d['project_ref']+'.supabase.co/functions/v1/smart-parse')" )" \
  -H "Authorization: Bearer $(cat supabase/.temp/linked-project.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('anon_key','ANON_KEY'))")" \
  -H "Content-Type: application/json" \
  -d '{"text":"flight from TLV to Bangkok on August 12","tripContext":{"countries":["Thailand"],"prepTabs":[{"id":"todos","name":"Todos"}]}}'
```

Expected: JSON with `type: "flight"`, `destination: "flight_research"`, and `extractedData` containing `origin`, `destination`, `depart_date`.

Also test a todo:
```bash
-d '{"text":"לדאוג לכלבה","tripContext":{"countries":[],"prepTabs":[{"id":"todos","name":"Todos"},{"id":"shopping","name":"Shopping List"}]}}'
```

Expected: `type: "todo"`, `destination: "todos"`, `extractedData.text: "Take care of the dog"` (or similar).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/smart-parse/index.ts
git commit -m "feat: add smart-parse edge function"
```

---

### Task 3: Smart input modal HTML + CSS

**Files:**
- Modify: `index.html` — add CSS block, add overlay before closing `</body>`

**Interfaces:**
- Produces: overlay `#ov-smart-input` with three child divs: `#si-input-state`, `#si-thinking-state`, `#si-confirm-state`

- [ ] **Step 1: Add CSS**

In `index.html`, find the closing `</style>` tag and insert before it:

```css
  /* Smart input modal */
  #si-image-preview{display:flex;align-items:center;gap:8px;margin-top:8px}
  #si-image-thumb{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border)}
  #si-clear-img{background:none;border:none;font-size:18px;cursor:pointer;color:var(--ink-soft);padding:0;line-height:1}
  #si-msg{color:var(--accent);font-size:14px;min-height:18px;margin-top:8px}
  #si-thinking{text-align:center;padding:24px 0;color:var(--ink-soft);font-style:italic}
  #si-summary{font-size:15px;line-height:1.5;margin-bottom:12px;color:var(--ink)}
  .si-tab-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .si-tab-pill{padding:4px 12px;border-radius:20px;border:1.5px solid var(--border);background:none;cursor:pointer;font-size:13px;color:var(--ink-soft)}
  .si-tab-pill.active{border-color:var(--accent);color:var(--accent);font-weight:600}
  #si-file-label{padding:8px 12px;font-size:20px;cursor:pointer;border:1.5px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;background:none;color:var(--ink-soft)}
  #si-file-label:hover{border-color:var(--accent);color:var(--accent)}
```

- [ ] **Step 2: Add the overlay HTML**

Find the existing FAB button line in `index.html`:
```html
  <button class="fab" onclick="openCapture()">＋</button>
```

Replace it with:
```html
  <button class="fab" onclick="openSmartInput()">＋</button>
```

Then add the new overlay just before `</body>`:

```html
<!-- Smart universal input -->
<div class="overlay" id="ov-smart-input"><div class="modal">

  <!-- State: input -->
  <div id="si-input-state">
    <h3>Add anything</h3>
    <textarea id="si-text" rows="4" placeholder="Paste a link, type a note, describe a flight… anything" style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
    <div id="si-image-preview" style="display:none">
      <img id="si-image-thumb" src="" alt="preview">
      <button id="si-clear-img" onclick="clearSmartImage()" title="Remove image">×</button>
    </div>
    <div id="si-msg"></div>
    <div class="modal-actions" style="gap:8px">
      <button class="btn ghost" onclick="closeAll()">Cancel</button>
      <label id="si-file-label" title="Attach image">
        📎
        <input type="file" id="si-file" accept="image/*" style="display:none" onchange="onSmartImagePick(this)">
      </label>
      <button class="btn" onclick="submitSmartInput()">✓</button>
    </div>
  </div>

  <!-- State: thinking -->
  <div id="si-thinking-state" style="display:none">
    <div id="si-thinking">thinking…</div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeAll()">Cancel</button>
    </div>
  </div>

  <!-- State: confirmation -->
  <div id="si-confirm-state" style="display:none">
    <div id="si-summary"></div>
    <div id="si-flight-controls" style="display:none;margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="si-booked"> Already booked
      </label>
    </div>
    <div id="si-tab-controls" style="display:none;margin-bottom:12px">
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:6px">Save to tab:</div>
      <div id="si-tab-pills" class="si-tab-pills"></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeAll()">Cancel</button>
      <button class="btn" onclick="confirmSmartInput()">OK</button>
    </div>
  </div>

</div></div>
```

- [ ] **Step 3: Verify modal renders**

Open the app on Countries tab. Tap `+`. The modal should open with a textarea, 📎 button, and ✓ button. Cancel should close it. Switching to Prep tab should hide the FAB entirely.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add smart input modal HTML and CSS"
```

---

### Task 4: Smart input JS — open, image handling, API call

**Files:**
- Modify: `app.js` — add new functions after the `openCapture` block (around line 1470)

**Interfaces:**
- Consumes: `#ov-smart-input` overlay from Task 3; `sb.functions.invoke('smart-parse', ...)` from Task 2
- Consumes: globals `countries`, `prepTabs`, `PREP_BUILTIN_TABS`, `TRIP_ID`, `GUEST_MODE`
- Produces: `openSmartInput()`, `setSmartState(state)`, `onSmartImagePick(input)`, `handleSmartImageFile(file)`, `clearSmartImage()`, `submitSmartInput()` — all consumed by Task 5

- [ ] **Step 1: Add module-level state variables**

Find the line `let _capType = 'place';` (near line 428) and add after it:

```javascript
let _smartImageFile = null;
let _smartImageB64  = null;
let _smartParseResult = null;
let _smartDestination = null;
```

- [ ] **Step 2: Add smart input functions**

Find `function openCapture(){` (around line 1456) and add the following block immediately after the closing `}` of `openCapture`:

```javascript
/* ---------------- SMART UNIVERSAL INPUT ---------------- */

function openSmartInput() {
  document.getElementById('si-text').value = '';
  document.getElementById('si-msg').textContent = '';
  document.getElementById('si-image-preview').style.display = 'none';
  document.getElementById('si-image-thumb').src = '';
  document.getElementById('si-file').value = '';
  _smartImageFile = null;
  _smartImageB64  = null;
  _smartParseResult = null;
  _smartDestination = null;
  setSmartState('input');
  openOverlay('ov-smart-input');
}

function setSmartState(state) {
  document.getElementById('si-input-state').style.display    = state === 'input'   ? '' : 'none';
  document.getElementById('si-thinking-state').style.display = state === 'thinking' ? '' : 'none';
  document.getElementById('si-confirm-state').style.display  = state === 'confirm'  ? '' : 'none';
}

function onSmartImagePick(input) {
  const file = input.files[0];
  if (file) handleSmartImageFile(file);
}

function handleSmartImageFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    document.getElementById('si-msg').textContent = 'Image too large (max 5 MB).';
    return;
  }
  _smartImageFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    _smartImageB64 = e.target.result.split(',')[1];
    document.getElementById('si-image-thumb').src = e.target.result;
    document.getElementById('si-image-preview').style.display = '';
    document.getElementById('si-msg').textContent = '';
  };
  reader.readAsDataURL(file);
}

function clearSmartImage() {
  _smartImageFile = null;
  _smartImageB64  = null;
  document.getElementById('si-image-preview').style.display = 'none';
  document.getElementById('si-image-thumb').src = '';
  document.getElementById('si-file').value = '';
}

async function submitSmartInput() {
  const text = document.getElementById('si-text').value.trim();
  if (!text && !_smartImageB64) {
    document.getElementById('si-msg').textContent = 'Type something or attach an image.';
    return;
  }

  setSmartState('thinking');

  const allPrepTabs = [
    ...PREP_BUILTIN_TABS,
    ...prepTabs.map(t => ({ id: t.id, name: t.name })),
  ];
  const tripContext = {
    countries: countries.map(c => c.name),
    prepTabs: allPrepTabs,
  };

  const body = { tripContext };
  if (text)         body.text        = text;
  if (_smartImageB64) body.imageBase64 = _smartImageB64;

  try {
    const { data, error } = await sb.functions.invoke('smart-parse', { body });
    if (error) throw error;
    _smartParseResult = data;
    _smartDestination = data.destination;
    showSmartConfirmation(data);
  } catch (_) {
    setSmartState('input');
    document.getElementById('si-msg').textContent = '⚠ Could not parse. Try rephrasing.';
  }
}

function showSmartConfirmation(result) {
  document.getElementById('si-summary').textContent = result.summary;

  const flightCtrl = document.getElementById('si-flight-controls');
  const tabCtrl    = document.getElementById('si-tab-controls');

  if (result.type === 'flight') {
    flightCtrl.style.display = '';
    document.getElementById('si-booked').checked = false;
    tabCtrl.style.display = 'none';
  } else if (result.type === 'todo' || result.destination === 'todos' ||
             ['todos','shopping','first_aid'].includes(result.destination) ||
             prepTabs.find(t => t.id === result.destination)) {
    flightCtrl.style.display = 'none';
    const allPrepTabs = [
      ...PREP_BUILTIN_TABS,
      ...prepTabs.map(t => ({ id: t.id, name: t.name })),
    ];
    document.getElementById('si-tab-pills').innerHTML = allPrepTabs.map(t =>
      `<button class="si-tab-pill${t.id === _smartDestination ? ' active' : ''}"
        onclick="selectSmartDest('${t.id}',this)">${esc(t.name)}</button>`
    ).join('');
    tabCtrl.style.display = '';
  } else {
    flightCtrl.style.display = 'none';
    tabCtrl.style.display = 'none';
  }

  setSmartState('confirm');
}

function selectSmartDest(id, btn) {
  _smartDestination = id;
  document.querySelectorAll('#si-tab-pills .si-tab-pill')
    .forEach(b => b.classList.toggle('active', b === btn));
}
```

- [ ] **Step 3: Register paste listener for the smart modal**

Find the line `document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); closePreview(); } });` (around line 1472) and add after it:

```javascript
document.addEventListener('paste', e => {
  if (!document.getElementById('ov-smart-input').classList.contains('show')) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      handleSmartImageFile(item.getAsFile());
      return;
    }
  }
});
```

- [ ] **Step 4: Verify in browser**

1. Open Countries tab, tap `+` → modal opens
2. Type some text, tap ✓ → modal shows "thinking…"
3. If AI is not yet deployed, verify the error state: modal returns to input with warning text
4. Attach an image via 📎 → thumbnail appears; tap × → thumbnail disappears
5. Paste an image (⌘V) into the open modal → thumbnail appears

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: smart input open/image/submit flow"
```

---

### Task 5: Smart input JS — confirmation routing and save

**Files:**
- Modify: `app.js` — add `confirmSmartInput()` and save helpers after `showSmartConfirmation`

**Interfaces:**
- Consumes: `_smartParseResult`, `_smartDestination`, `_smartImageFile` (from Task 4)
- Consumes: `ensureCountry(name, flag)`, `ensurePlace(cityName, countryId)`, `openFlight()`, `refreshAll()`, `refreshTodos()`, `showTab(t)`, `GUEST_MODE`, `TRIP_ID`, `FLAGS`, `cap()`
- Consumes: `flight_research` table, `research` storage bucket, `hotels` table, `countries` table, `places` table, `trip_todos` table

- [ ] **Step 1: Add `confirmSmartInput` and save helpers**

Directly after `selectSmartDest` (from Task 4), add:

```javascript
async function confirmSmartInput() {
  const result = _smartParseResult;
  if (!result) return;
  const dest    = _smartDestination;
  const booked  = document.getElementById('si-booked')?.checked;
  const rawText = document.getElementById('si-text').value.trim();

  closeAll();

  if (result.type === 'flight' && booked) {
    openFlight();
    const d = result.extractedData || {};
    if (d.origin)      document.getElementById('f-origin').value      = d.origin;
    if (d.destination) document.getElementById('f-destination').value  = d.destination;
    if (d.depart_date) document.getElementById('f-depart_date').value  = d.depart_date;
    if (d.depart_time) document.getElementById('f-depart_time').value  = d.depart_time;
    if (d.airline)     document.getElementById('f-airline').value      = d.airline;
    if (d.flight_no)   document.getElementById('f-flight_no').value    = d.flight_no;
    if (d.price)       document.getElementById('f-price').value        = d.price;
    if (d.notes)       document.getElementById('f-notes').value        = d.notes;
    return;
  }

  if (result.type === 'flight') {
    const d = result.extractedData || {};
    const content = [d.origin, d.destination, d.depart_date, d.airline, d.flight_no, d.price]
      .filter(Boolean).join(' · ') || rawText;
    await saveSmartResearch(content, _smartImageFile);
    showTab('flights');
    return;
  }

  if (result.type === 'hotel') {
    await saveSmartHotel(result.extractedData || {}, rawText);
    return;
  }

  if (result.type === 'place') {
    const d = result.extractedData || {};
    const countryName = d.country || d.name;
    if (countryName) {
      const c = await ensureCountry(cap(countryName), FLAGS[countryName.toLowerCase()] || '🌍');
      if (c && d.name && d.name.toLowerCase() !== countryName.toLowerCase()) {
        await ensurePlace(cap(d.name), c.id);
      }
    }
    await refreshAll();
    return;
  }

  // todo / unknown — save to selected prep tab
  const text = result.extractedData?.text || rawText;
  await saveSmartTodo(text, dest);
}

async function saveSmartResearch(content, imageFile) {
  if (GUEST_MODE) {
    lsInsert('flight_research', {
      trip_id: TRIP_ID, content: content || null,
      image_url: _smartImageB64 || null,
      created_at: new Date().toISOString(),
    });
    research = lsGet('flight_research').filter(r => r.trip_id === TRIP_ID)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    renderResearch();
    return;
  }

  let imageUrl = null;
  if (imageFile) {
    const path = `${TRIP_ID}/${Date.now()}-${imageFile.name}`;
    const { error: upErr } = await sb.storage.from('research').upload(path, imageFile);
    if (!upErr) {
      imageUrl = sb.storage.from('research').getPublicUrl(path).data.publicUrl;
    }
  }

  await sb.from('flight_research').insert({
    trip_id: TRIP_ID,
    content: content || null,
    image_url: imageUrl,
  });
  await refreshAll();
}

async function saveSmartHotel({ name, city, country, link }, fallbackText) {
  const effectiveCountry = country || city || fallbackText;
  if (!effectiveCountry) return;
  const c = await ensureCountry(cap(effectiveCountry), FLAGS[effectiveCountry.toLowerCase()] || '🌍');
  if (!c) return;
  let place = null;
  if (city && city.toLowerCase() !== effectiveCountry.toLowerCase()) {
    place = await ensurePlace(cap(city), c.id);
  }
  const row = {
    trip_id: TRIP_ID, country_id: c.id, place_id: place?.id || null,
    name: cap(name) || 'Untitled hotel', link: link || null, booked: false,
  };
  if (GUEST_MODE) lsInsert('hotels', row);
  else await sb.from('hotels').insert(row);
  await refreshAll();
}

async function saveSmartTodo(text, category) {
  if (!text) return;
  const row = {
    trip_id: TRIP_ID, text, done: false,
    category: category || 'todos',
    created_at: new Date().toISOString(),
  };
  if (GUEST_MODE) lsInsert('todos', row);
  else await sb.from('trip_todos').insert(row);
  await refreshTodos();
  showTab('prep');
  activePrepTab = category || 'todos';
  renderPrepTabs();
  renderTodos();
}
```

- [ ] **Step 2: End-to-end test — flight (not booked)**

1. Open Countries tab → tap `+`
2. Type: `flight from TLV to Bangkok on August 12 with El Al`
3. Tap ✓ → wait for result
4. Confirmation shows "Flight TLV → BKK on Aug 12" (or similar), no "Booked?" checked
5. Tap OK → app navigates to Flights tab → research card appears

- [ ] **Step 3: End-to-end test — flight (booked)**

1. Open Countries tab → tap `+`
2. Type the same flight text
3. Tap ✓ → in confirmation, check "Already booked"
4. Tap OK → flight form opens with origin, destination, date pre-filled

- [ ] **Step 4: End-to-end test — todo (Hebrew)**

1. Open Countries tab → tap `+`
2. Type: `לדאוג לכלבה`
3. Tap ✓ → confirmation shows translated summary, tab picker shows Todos selected
4. Tap OK → app navigates to Prep tab → item appears in Todos

- [ ] **Step 5: End-to-end test — todo (switch tab)**

1. Repeat the todo test above
2. In confirmation, tap "Shopping List" pill
3. Tap OK → item appears in Shopping List tab, not Todos

- [ ] **Step 6: End-to-end test — hotel link**

1. Open Countries tab → tap `+`
2. Paste a Booking.com hotel URL
3. Tap ✓ → confirmation shows hotel name and destination country
4. Tap OK → country/city auto-created if needed, hotel card appears

- [ ] **Step 7: End-to-end test — flight screenshot**

1. Open Countries tab → tap `+`
2. Tap 📎 and attach a flight screenshot (or paste one)
3. Tap ✓ → confirmation shows extracted flight info
4. Tap OK → research card with image appears in Flights tab

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat: smart input confirmation routing and save helpers"
```
