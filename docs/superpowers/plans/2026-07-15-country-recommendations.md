# Country Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-country "Recommendations" section where users paste a link/type a name/attach an image, and Claude classifies it into the right freeform list (nannies, restaurants, drivers…), creating the list on first use.

**Architecture:** A new `recommendations` table (freeform `category` string = the list; no separate lists table). The existing `smart-parse` Supabase edge function gains a `recommendation` mode that returns `{category, title, city}`. The country detail overlay (`openCountry()` in `app.js`) renders a capture row + category-grouped cards. A quick-confirm chip lets the user re-file a wrong guess. Failures fall back to an `"Unsorted"` category so nothing is lost.

**Tech Stack:** Vanilla JS single-file SPA (`app.js`), Supabase (Postgres + RLS + Storage + Deno edge functions), Anthropic Messages API (Claude Haiku).

## Global Constraints

- No build step; `app.js` is loaded directly in the browser. Match existing code style (2-space indent, terse helpers).
- GUEST_MODE must work fully offline via localStorage helpers `lsInsert`/`lsGet`/`lsUpdate`/`lsDelete` — no Supabase calls when `GUEST_MODE === true`.
- Categories are freeform text, matched/grouped **case-insensitively**.
- Reuse the existing `research` Storage bucket for uploaded images. Reuse `esc()`, `cap()`, `openOverlay()`, `closeAll()`, `refreshAll()`.
- Edge function model stays `claude-haiku-4-5-20251001`; return `{...CORS, "content-type": "application/json"}` via the existing `json()` helper.
- No browser unit-test harness exists for `app.js`; verify each UI task by running the app in **guest mode** in a browser and observing behavior.

---

### Task 1: Database schema + RLS for `recommendations`

**Files:**
- Modify: `features.sql` (append new table block at end of file)

**Interfaces:**
- Produces: `recommendations` table with columns `id, trip_id, country_id, category, title, city, link, image_url, created_at, created_by`.

- [ ] **Step 1: Append the table + policy to `features.sql`**

```sql
-- Feature: Per-country recommendations (AI-sorted freeform lists)
create table if not exists recommendations (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  country_id  uuid not null references countries(id) on delete cascade,
  category    text not null,
  title       text not null,
  city        text,
  link        text,
  image_url   text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) default null
);
alter table recommendations enable row level security;
create policy recommendations_all on recommendations for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
```

- [ ] **Step 2: Apply the migration to Supabase**

Run the SQL against the project (via the Supabase SQL editor, or `supabase db push` if a migration file is used). Confirm the table exists:

Run (Supabase SQL editor):
```sql
select column_name from information_schema.columns where table_name = 'recommendations' order by ordinal_position;
```
Expected: rows `id, trip_id, country_id, category, title, city, link, image_url, created_at, created_by`.

- [ ] **Step 3: Commit**

```bash
git add features.sql
git commit -m "feat: recommendations table + RLS"
```

---

### Task 2: Extend `smart-parse` with a `recommendation` mode

**Files:**
- Modify: `supabase/functions/smart-parse/index.ts`

**Interfaces:**
- Consumes: request body `{ mode: "recommendation", text?, imageBase64?, imageMediaType?, context: { country: string, existingCategories: string[] } }`.
- Produces: JSON `{ category: string, title: string, city: string | null }` when `mode === "recommendation"`.

- [ ] **Step 1: Branch on `mode` at the top of the handler**

In `Deno.serve`, after `const { text, imageBase64, imageMediaType, tripContext } = await req.json();`, change the destructure to also read `mode` and `context`, and add an early branch. Replace lines 14–15:

```ts
    const { text, imageBase64, imageMediaType, tripContext, mode, context } = await req.json();
    if (!text && !imageBase64) return json({ error: "Provide text or image" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    if (mode === "recommendation") {
      return await classifyRecommendation({ text, imageBase64, imageMediaType, context, key });
    }
```

(Remove the now-duplicate `const key = ...` / `if (!key)` lines that previously sat lower in the try block, so the key check runs once.)

- [ ] **Step 2: Add the `classifyRecommendation` function**

Add this function below `Deno.serve(...)`, above the existing `json()` helper:

```ts
async function classifyRecommendation(
  { text, imageBase64, imageMediaType, context, key }:
  { text?: string; imageBase64?: string; imageMediaType?: string;
    context?: { country?: string; existingCategories?: string[] }; key: string },
) {
  const country = context?.country || "this country";
  const existing = context?.existingCategories || [];

  const systemPrompt = `You sort local travel recommendations into lists for ${country}.
Existing lists: ${existing.length ? existing.join(", ") : "none yet"}.

Classify the input into a short lowercase category (e.g. "restaurants", "drivers", "nannies", "activities").
Reuse one of the existing lists when the input clearly fits it; otherwise invent a concise new category.

Return ONLY a JSON object — no markdown:
{
  "category": "lowercase list name",
  "title": "the name (restaurant name, person's name, etc.)",
  "city": "city name if this is a place like a restaurant, else null"
}

Rules:
- Restaurants and other places: fill "title" with the name and "city" with the city.
- People (nanny, driver, guide, babysitter): fill "title" with the person's name, set "city" to null.
- If you cannot tell, use category "unsorted" and your best-guess title.`;

  const contentBlocks: unknown[] = [];
  if (imageBase64) {
    contentBlocks.push({
      type: "image",
      source: { type: "base64", media_type: (imageMediaType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageBase64 },
    });
  }
  contentBlocks.push({
    type: "text",
    text: text ? `Classify this recommendation:\n${text}`
               : "Classify the recommendation shown in the image above.",
  });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: contentBlocks }],
    }),
  });

  const data = await r.json();
  if (!r.ok) return json({ error: `Anthropic API error: ${JSON.stringify(data)}` }, 502);
  const raw = (data.content || []).map((b: { text: string }) => b.text).join("").trim();

  let category = "unsorted", title = "", city: string | null = null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      category = (parsed.category || "unsorted").toString().toLowerCase().trim() || "unsorted";
      title = (parsed.title || "").toString().trim();
      city = parsed.city ? parsed.city.toString().trim() : null;
    }
  } catch (_) { /* fall through to defaults */ }

  return json({ category, title, city });
}
```

- [ ] **Step 3: Deploy the function**

Run:
```bash
supabase functions deploy smart-parse
```
Expected: deploy succeeds.

- [ ] **Step 4: Smoke-test the new mode**

Run (replace `<PROJECT_REF>` and `<ANON_KEY>`):
```bash
curl -s -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/smart-parse" \
  -H "Authorization: Bearer <ANON_KEY>" -H "content-type: application/json" \
  -d '{"mode":"recommendation","text":"Maria, amazing nanny, 052-123-4567","context":{"country":"Italy","existingCategories":[]}}'
```
Expected: JSON like `{"category":"nannies","title":"Maria","city":null}`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/smart-parse/index.ts
git commit -m "feat: smart-parse recommendation mode"
```

---

### Task 3: Client data layer — load, cache, guest mode

**Files:**
- Modify: `app.js` (global state near line 17; `refreshAll` lines 354–384; `saveTripCache`/`loadTripCache` lines 390–408; initial cache render line 203)

**Interfaces:**
- Produces: global `let recommendations = [];` populated for the active trip; helper `recsForCountry(countryId)`.

- [ ] **Step 1: Add the global state array**

Near `let research = [];` (line 17), add:

```js
let recommendations = [];
```

- [ ] **Step 2: Load recs in `refreshAll` (guest branch)**

In `refreshAll`, inside the `if (GUEST_MODE)` block (after the `research = ...` assignment, before `renderCountries();`), add:

```js
    recommendations = lsGet('recommendations').filter(r => r.trip_id === TRIP_ID);
```

- [ ] **Step 3: Load recs in `refreshAll` (Supabase branch)**

Add a query to the `Promise.all` array and destructure it. Change the array to include:

```js
    sb.from('recommendations').select('*').eq('trip_id', TRIP_ID).order('created_at'),
```
and update the destructure + assignment:

```js
  const [c, ci, f, h, ex, res, rec] = await Promise.all([ /* ...existing six queries..., */ ]);
  countries = c.data || []; places = ci.data || []; flights = f.data || []; hotels = h.data || [];
  expenses = ex.data || []; research = res.data || []; recommendations = rec.data || [];
```

- [ ] **Step 4: Include recs in the trip cache**

In `saveTripCache`, add `recommendations` to the serialized object:

```js
      JSON.stringify({ countries, places, flights, hotels, expenses, research, recommendations, legOrder }));
```
In `loadTripCache`, restore it:

```js
    hotels = d.hotels || []; expenses = d.expenses || []; research = d.research || [];
    recommendations = d.recommendations || [];
```

- [ ] **Step 5: Add the per-country selector helper**

Near the other helpers (e.g. after `esc()` around line 2010), add:

```js
function recsForCountry(countryId) {
  return recommendations.filter(r => r.country_id === countryId);
}
```

- [ ] **Step 6: Verify load path in guest mode**

Run the app in a browser as a guest. In the console:
```js
lsInsert('recommendations', { trip_id: TRIP_ID, country_id: countries[0].id, category: 'drivers', title: 'Test', city: null });
refreshAll();
recsForCountry(countries[0].id);
```
Expected: the array contains the inserted row.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: load/cache recommendations state"
```

---

### Task 4: Render the Recommendations section in the country detail

**Files:**
- Modify: `app.js` (`openCountry` lines 943–1012; add helpers nearby)
- Modify: `index.html` (CSS block — add rec styles near the `.place-item` rules)

**Interfaces:**
- Consumes: `recsForCountry(countryId)` from Task 3.
- Produces: `renderRecsSection(countryId)` returning an HTML string; `catEmoji(category)`; `deleteRecommendation(id, countryId)`.

- [ ] **Step 1: Add the category-emoji + delete helpers**

Near `recsForCountry` add:

```js
const CAT_EMOJI = {
  restaurants: '🍽', restaurant: '🍽', food: '🍽',
  drivers: '🚗', driver: '🚗', transport: '🚗',
  nannies: '👶', nanny: '👶', babysitters: '👶',
  guides: '🧭', guide: '🧭', activities: '🎟', activity: '🎟',
  hotels: '🏨', shopping: '🛍', unsorted: '📌',
};
function catEmoji(cat) { return CAT_EMOJI[(cat || '').toLowerCase()] || '📌'; }

async function deleteRecommendation(id, countryId) {
  const rec = recommendations.find(r => r.id === id);
  recommendations = recommendations.filter(r => r.id !== id);
  if (GUEST_MODE) lsDelete('recommendations', id);
  else {
    await sb.from('recommendations').delete().eq('id', id);
    if (rec?.image_url && rec.image_url.includes('/research/')) {
      const path = rec.image_url.split('/research/')[1];
      if (path) await sb.storage.from('research').remove([path]);
    }
  }
  openCountry(countryId);
}
```

- [ ] **Step 2: Add `renderRecsSection`**

Add near the helpers above:

```js
function renderRecsSection(countryId) {
  const recs = recsForCountry(countryId);
  const groups = {};
  for (const r of recs) {
    const key = (r.category || 'unsorted').toLowerCase();
    (groups[key] = groups[key] || []).push(r);
  }
  const groupNames = Object.keys(groups).sort();

  const groupsHtml = groupNames.map(key => {
    const items = groups[key].map(r => `
      <div class="rec-item" data-id="${r.id}">
        <span class="rec-title">${esc(r.title || 'Untitled')}${r.city ? ` <span class="rec-city">· ${esc(r.city)}</span>` : ''}</span>
        ${r.link ? `<a href="${esc(r.link)}" target="_blank" style="text-decoration:none">🔗</a>` : ''}
        ${r.image_url ? `<a href="${esc(r.image_url)}" target="_blank" style="text-decoration:none">🖼</a>` : ''}
        <button class="del" style="position:static;opacity:.35;font-size:17px;margin-left:2px"
          onclick="deleteRecommendation('${r.id}','${countryId}')">×</button>
      </div>`).join('');
    return `<div class="rec-group">
      <div class="rec-group-head">${catEmoji(key)} ${esc(cap(key))}</div>${items}</div>`;
  }).join('');

  return `
    <div class="places-header" style="margin-top:24px">Recommendations</div>
    <div class="rec-capture">
      <input id="rec-input-${countryId}" placeholder="Paste a link, a name, or attach a screenshot…" style="flex:1"
        onkeydown="if(event.key==='Enter')submitRecommendation('${countryId}')">
      <input type="file" accept="image/*" id="rec-file-${countryId}" style="display:none"
        onchange="submitRecommendation('${countryId}', this.files[0])">
      <button class="btn ghost small" onclick="document.getElementById('rec-file-${countryId}').click()">📎</button>
      <button class="btn small" onclick="submitRecommendation('${countryId}')">Add</button>
    </div>
    <div id="rec-status-${countryId}" class="rec-status"></div>
    ${groupsHtml || '<div class="empty" style="margin:8px 0 12px">Paste a link, name, or screenshot — I\\'ll sort it into the right list.</div>'}
  `;
}
```

- [ ] **Step 3: Inject the section into `openCountry`**

In `openCountry`, at the end of the `detailBody.innerHTML` template (just before the closing `` ` `` after the "Add hotel" `add-place-row` div, line ~1008), append:

```js
    <div class="add-place-row">
      <button class="btn small" onclick="openAddHotel('${c.id}')">＋ Add hotel</button>
    </div>
    ${renderRecsSection(c.id)}`;
```

- [ ] **Step 4: Add CSS in `index.html`**

After the `.place-item` rules, add:

```css
  .rec-capture{display:flex;gap:8px;align-items:center;margin:10px 0}
  .rec-status{font-size:13px;color:var(--ink-soft);min-height:16px;margin-bottom:6px}
  .rec-group{margin-bottom:14px}
  .rec-group-head{font-family:'Fraunces',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:var(--ink);margin-bottom:6px}
  .rec-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px}
  .rec-title{flex:1;font-size:14px;color:var(--ink)}
  .rec-city{color:var(--ink-soft);font-size:13px}
```

- [ ] **Step 5: Verify rendering in guest mode**

In the browser (guest), insert a rec via console (as in Task 3 Step 6), then open that country's detail. Expected: a "Recommendations" section with a `🚗 Drivers` group containing "Test", a capture row, and a working `×` delete.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html
git commit -m "feat: recommendations section UI in country detail"
```

---

### Task 5: Classify + save flow (`submitRecommendation`)

**Files:**
- Modify: `app.js` (add flow functions near `renderRecsSection`; add module-level `_recPendingId`)

**Interfaces:**
- Consumes: `smart-parse` `recommendation` mode (Task 2); `recsForCountry` (Task 3); `openCountry`, `renderRecsSection` (Task 4).
- Produces: `submitRecommendation(countryId, file?)`; `saveRecommendation(countryId, {category,title,city,link,image_url})` returning the saved row; module var `let _recPendingId = null;`.

- [ ] **Step 1: Add the save helper (guest + Supabase, image upload)**

```js
let _recPendingId = null;

async function saveRecommendation(countryId, fields) {
  const row = {
    trip_id: TRIP_ID, country_id: countryId,
    category: (fields.category || 'unsorted').toLowerCase(),
    title: fields.title || 'Untitled',
    city: fields.city || null,
    link: fields.link || null,
    image_url: fields.image_url || null,
    created_by: _myUserId,
  };
  if (GUEST_MODE) {
    const saved = lsInsert('recommendations', row);
    recommendations.push(saved);
    return saved;
  }
  const { data } = await sb.from('recommendations').insert(row).select().single();
  if (data) recommendations.push(data);
  return data;
}
```

- [ ] **Step 2: Add `submitRecommendation` (classify, fallback, image handling)**

```js
async function submitRecommendation(countryId, file) {
  const inputEl = document.getElementById(`rec-input-${countryId}`);
  const statusEl = document.getElementById(`rec-status-${countryId}`);
  const text = (inputEl?.value || '').trim();
  if (!text && !file) { if (statusEl) statusEl.textContent = 'Type something or attach an image.'; return; }

  if (statusEl) statusEl.textContent = 'Asking Claude…';

  // Read image (base64 for classify; File kept for upload)
  let imageBase64 = null, imageMediaType = null;
  if (file) {
    imageMediaType = file.type || 'image/jpeg';
    imageBase64 = await new Promise(res => {
      const rd = new FileReader();
      rd.onload = e => res(e.target.result.split(',')[1]);
      rd.readAsDataURL(file);
    });
  }

  const link = text.startsWith('http') ? text : null;
  const existingCategories = [...new Set(recsForCountry(countryId).map(r => (r.category || '').toLowerCase()))];
  const country = countries.find(c => c.id === countryId);

  let result = { category: 'unsorted', title: text && !link ? text : '', city: null };
  let failed = false;
  try {
    const body = { mode: 'recommendation', context: { country: country?.name || '', existingCategories } };
    if (text) body.text = text;
    if (imageBase64) { body.imageBase64 = imageBase64; body.imageMediaType = imageMediaType; }
    const { data, error } = await sb.functions.invoke('smart-parse', { body });
    if (error || !data || data.error) throw error || new Error('parse failed');
    result = { category: data.category || 'unsorted', title: data.title || result.title, city: data.city || null };
  } catch (_) { failed = true; result.category = 'unsorted'; }

  // Upload image to the shared research bucket (Supabase only)
  let image_url = null;
  if (file && !GUEST_MODE) {
    const path = `${TRIP_ID}/${Date.now()}-${file.name}`;
    const { error: upErr } = await sb.storage.from('research').upload(path, file);
    if (!upErr) image_url = sb.storage.from('research').getPublicUrl(path).data.publicUrl;
  } else if (file && GUEST_MODE) {
    image_url = `data:${imageMediaType};base64,${imageBase64}`;
  }

  const saved = await saveRecommendation(countryId, { ...result, link, image_url });
  _recPendingId = saved?.id || null;

  if (inputEl) inputEl.value = '';
  openCountry(countryId);
  showRecChip(countryId, saved, failed);
}
```

- [ ] **Step 3: Add a temporary no-op `showRecChip` (real one lands in Task 6)**

```js
function showRecChip(_countryId, _rec, _failed) { /* implemented in Task 6 */ }
```

- [ ] **Step 4: Verify the happy path in guest mode**

In a browser as guest, open a country, type `Trattoria da Luigi, Rome` in the capture input, press Enter. Expected: `Asking Claude…` appears, then a `🍽 Restaurants` group with "Trattoria Da Luigi · Rome". (Requires the deployed function from Task 2; guest mode still calls the edge function for classification, which is fine — only DB/storage are local.)

- [ ] **Step 5: Verify the fallback**

Temporarily disable network (DevTools offline) and submit `Some Driver Guy`. Expected: item still appears under `📌 Unsorted`. Re-enable network.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: classify + save recommendations"
```

---

### Task 6: Quick-confirm chip (re-file a wrong guess)

**Files:**
- Modify: `app.js` (replace the no-op `showRecChip`; add `changeRecCategory`)
- Modify: `index.html` (chip CSS)

**Interfaces:**
- Consumes: `_recPendingId`, `recommendations`, `openCountry`, `recsForCountry`.
- Produces: `showRecChip(countryId, rec, failed)`; `moveRec(id, newCategory, countryId)`.

- [ ] **Step 1: Replace `showRecChip` with the real implementation**

```js
function showRecChip(countryId, rec, failed) {
  const statusEl = document.getElementById(`rec-status-${countryId}`);
  if (!statusEl || !rec) return;
  const label = failed ? "Couldn't auto-sort — pick a list" : `Added to ${cap(rec.category)}`;
  statusEl.innerHTML = `<span class="rec-chip">${esc(label)}
    <button class="rec-chip-btn" onclick="promptRecCategory('${rec.id}','${countryId}')">change</button></span>`;
}

function promptRecCategory(id, countryId) {
  const existing = [...new Set(recsForCountry(countryId).map(r => (r.category || '').toLowerCase()))];
  const suggestion = existing.filter(c => c !== 'unsorted').join(', ');
  const next = prompt(`Move to which list?${suggestion ? ` (existing: ${suggestion})` : ''}`, '');
  if (next && next.trim()) moveRec(id, next.trim().toLowerCase(), countryId);
}

async function moveRec(id, newCategory, countryId) {
  const rec = recommendations.find(r => r.id === id);
  if (!rec) return;
  rec.category = newCategory;
  if (GUEST_MODE) lsUpdate('recommendations', id, { category: newCategory });
  else await sb.from('recommendations').update({ category: newCategory }).eq('id', id);
  openCountry(countryId);
}
```

- [ ] **Step 2: Add chip CSS in `index.html`**

```css
  .rec-chip{display:inline-flex;align-items:center;gap:8px;background:var(--accent-soft);color:var(--ink);
    padding:4px 10px;border-radius:20px;font-size:13px}
  .rec-chip-btn{background:none;border:none;color:var(--accent);font-weight:600;cursor:pointer;font-size:13px;padding:0}
```

- [ ] **Step 3: Verify the chip**

In guest mode, submit a recommendation. Expected: after it files, a chip "Added to Restaurants — change" appears. Click "change", enter `favorites`, and confirm the item moves to a `Favorites` group and the section re-renders.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: quick-confirm chip for recommendations"
```

---

## Self-Review

**Spec coverage:**
- Per-country lists → Task 1 (`country_id`), Task 4 (grouped render). ✓
- Freeform categories, list-on-first-item → no lists table; `renderRecsSection` derives groups. ✓
- AI classify text/link/image → Task 2 mode + Task 5 flow. ✓
- Category-aware extraction (restaurant name+city, person name only) → Task 2 system prompt. ✓
- Original link/image always attached → Task 5 (`link`, `image_url`). ✓
- Quick-confirm chip → Task 6. ✓
- "Unsorted" fallback on failure/offline → Task 5 Steps 2 & 5. ✓
- GUEST_MODE localStorage + base64 images → Task 3, Task 5 Step 2. ✓
- Delete + image cleanup → Task 4 Step 1. ✓
- Case-insensitive grouping/reuse → Task 4 (`toLowerCase`), Task 2 (lowercased category). ✓

**Placeholder scan:** The only intentional stub is `showRecChip` in Task 5 Step 3, explicitly replaced in Task 6 Step 1 so Task 5 is independently runnable. No TODO/TBD remain.

**Type consistency:** `saveRecommendation` returns the row with `id`; `submitRecommendation` reads `saved.id` into `_recPendingId`; `showRecChip(countryId, rec, failed)` signature matches its call site; `moveRec`/`deleteRecommendation` both take `(id, …, countryId)` and re-render via `openCountry`. Categories are lowercased on write (Task 5 `saveRecommendation`) and on group key (Task 4). Consistent.
