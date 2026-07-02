# Budget Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat expense list with a three-drawer envelope budget system: One-off Expenses (booked flights auto-imported), Daily Budget (per-country daily rate × days), and Contingency Budget (buffer with expense log).

**Architecture:** All data lives in existing tables with three new columns: `trips.oneoff_budget`, `trips.contingency_budget`, `countries.daily_budget`. Expenses gain a `drawer` TEXT column (`'oneoff'|'daily'|'contingency'`). A new `loadBudgetPlanned()` function reads from `trips`. `renderBudget()` is replaced entirely. No new tables.

**Tech Stack:** Vanilla JS, Supabase (Postgres), HTML/CSS — no build step.

## Global Constraints

- No build step — edit `app.js` and `index.html` directly
- No emojis — SVG icons only (20×20 stroke, `stroke="currentColor"`, `fill="none"`, `stroke-width="1.5"`, `stroke-linecap="round"`, `stroke-linejoin="round"`)
- Drawer values (strings): `'oneoff'` | `'daily'` | `'contingency'`
- Old `budget_settings` table and `budgetTarget` module var are removed — do not reference them
- Old `CATEGORIES`, `renderBookedFlightsLine`, `openBudgetTarget`, `saveBudgetTarget`, `ov-target` are all removed
- `parsePrice(str)` already exists in `app.js` — reuse it to extract numeric value from free-text prices like `"$820"` or `"~$400"`
- `fmtMoney(n, cur)` already exists — replace usage with a new `fmt(n)` helper (`'$' + toLocaleString`)
- `esc(s)` already exists for XSS-safe HTML templating
- `lsInsert`, `lsUpdate`, `lsDelete`, `lsGet` are existing guest-mode helpers
- `GUEST_MODE`, `TRIP_ID`, `sb` are existing module-level vars
- `openOverlay(id)`, `closeAll()` are existing overlay helpers
- `refreshAll()` is the re-fetch-and-render function — call it after mutations
- Verification: `node --check app.js` must exit with no output after every task

---

### Task 1: DB migrations + module setup + data loading

**Files:**
- Modify: `app.js` — remove `budgetTarget`, add `budgetPlanned`, add `loadBudgetPlanned()`, update `refreshAll()`, update `enterTrip()`

**Interfaces:**
- Produces: `budgetPlanned` (module var `{ oneoff: number|null, contingency: number|null }`), `loadBudgetPlanned()` (async, loads from `trips`), `saveOneoffBudget(val)`, `saveContingencyBudget(val)`, `saveDailyBudget(countryId, val)` — consumed by Tasks 3 and 4

- [ ] **Step 1: Run DB migrations in Supabase dashboard SQL editor**

```sql
-- Add drawer column to expenses (default existing rows to 'oneoff')
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS drawer TEXT NOT NULL DEFAULT 'oneoff';

-- Add planned budget amounts to trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS oneoff_budget NUMERIC;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS contingency_budget NUMERIC;

-- Add daily budget rate to countries
ALTER TABLE countries ADD COLUMN IF NOT EXISTS daily_budget NUMERIC;
```

- [ ] **Step 2: Replace `budgetTarget` module var and add `budgetPlanned`**

Find `let budgetTarget = null;` (around line 16) and replace:

```javascript
let budgetPlanned = { oneoff: null, contingency: null };
```

- [ ] **Step 3: Add `loadBudgetPlanned()` and the three planned-save functions**

Find the block containing `async function loadPreferences()` (around line 740) and add immediately after its closing `}`:

```javascript
async function loadBudgetPlanned() {
  if (!TRIP_ID) return;
  if (GUEST_MODE) {
    const raw = localStorage.getItem('triplanner_budget_planned_' + TRIP_ID);
    budgetPlanned = raw ? JSON.parse(raw) : { oneoff: null, contingency: null };
    return;
  }
  const { data } = await sb.from('trips')
    .select('oneoff_budget,contingency_budget').eq('id', TRIP_ID).single();
  budgetPlanned = {
    oneoff: data?.oneoff_budget ?? null,
    contingency: data?.contingency_budget ?? null,
  };
}

async function saveOneoffBudget(val) {
  const n = parseFloat(val) || null;
  budgetPlanned.oneoff = n;
  if (GUEST_MODE) {
    localStorage.setItem('triplanner_budget_planned_' + TRIP_ID, JSON.stringify(budgetPlanned));
  } else {
    await sb.from('trips').update({ oneoff_budget: n }).eq('id', TRIP_ID);
  }
  renderBudget();
}

async function saveContingencyBudget(val) {
  const n = parseFloat(val) || null;
  budgetPlanned.contingency = n;
  if (GUEST_MODE) {
    localStorage.setItem('triplanner_budget_planned_' + TRIP_ID, JSON.stringify(budgetPlanned));
  } else {
    await sb.from('trips').update({ contingency_budget: n }).eq('id', TRIP_ID);
  }
  renderBudget();
}

async function saveDailyBudget(countryId, val) {
  const n = parseFloat(val) || null;
  const c = countries.find(x => x.id === countryId);
  if (c) c.daily_budget = n;
  if (GUEST_MODE) {
    lsUpdate('countries', countryId, { daily_budget: n });
  } else {
    await sb.from('countries').update({ daily_budget: n }).eq('id', countryId);
  }
  renderBudget();
}
```

- [ ] **Step 4: Update `refreshAll()` to remove `budget_settings` fetch**

In `refreshAll()` find the section that fetches from `budget_settings` and the lines that reference `budgetTarget`. Remove them. The expenses fetch stays.

Specifically, find and remove:
```javascript
sb.from('budget_settings').select('*').eq('trip_id', TRIP_ID).maybeSingle(),
```
And the assignment line:
```javascript
expenses = ex.data || []; budgetTarget = bs.data || null;
```
Replace with:
```javascript
expenses = ex.data || [];
```
(keep `expenses` assignment, just drop `budgetTarget`)

Also remove `const bs = ...` destructuring if it was named.

- [ ] **Step 5: Call `loadBudgetPlanned()` from `enterTrip()`**

Find `enterTrip()` (around line 196). It currently has:
```javascript
await loadLegOrder();
await Promise.all([refreshAll(), loadPreferences()]);
```
Change to:
```javascript
await loadLegOrder();
await Promise.all([refreshAll(), loadPreferences(), loadBudgetPlanned()]);
```

- [ ] **Step 6: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: budget module setup — budgetPlanned, loadBudgetPlanned, planned save functions"
```

---

### Task 2: Budget page HTML + CSS overhaul

**Files:**
- Modify: `index.html` — replace budget page HTML, simplify `ov-expense` modal, remove `ov-target`, add CSS

**Interfaces:**
- Produces: DOM containers `#drawer-oneoff`, `#drawer-daily`, `#drawer-contingency`, `#budget-summary-bar` — consumed by Task 3
- Produces: simplified `ov-expense` modal with `#e-label`, `#e-amount`, `#e-drawer`, `#e-country-id`, `#e-id`, `#e-title` — consumed by Task 4

- [ ] **Step 1: Replace budget page section in `index.html`**

Find:
```html
    <section class="page" id="page-budget">
      <div class="page-head">
        <div><h2>Budget</h2><p>What we're spending, and where.</p></div>
        <div style="display:flex;gap:10px">
          <button class="btn ghost" onclick="openBudgetTarget()">Set target</button>
          <button class="btn" onclick="openExpense()">＋ Add expense</button>
        </div>
      </div>
      <div id="budgetSummary"></div>
      <div id="bookedFlightsLine"></div>
      <div id="budgetByCat"></div>
      <div class="grid flights" id="expenseList" style="margin-top:18px"></div>
    </section>
```

Replace with:
```html
    <section class="page" id="page-budget">
      <div class="page-head">
        <div><h2>Budget</h2><p>Plan and track your spending.</p></div>
      </div>
      <div id="budget-summary-bar"></div>
      <div id="drawer-oneoff"></div>
      <div id="drawer-daily"></div>
      <div id="drawer-contingency"></div>
    </section>
```

- [ ] **Step 2: Replace `ov-expense` modal**

Find the entire `<div class="overlay" id="ov-expense">...</div>` block and replace with:

```html
<div class="overlay" id="ov-expense"><div class="modal">
  <h3 id="e-title">Add expense</h3>
  <label>Description</label>
  <input id="e-label" placeholder="Hotel in Hoi An" autocomplete="off">
  <label>Amount ($)</label>
  <input id="e-amount" type="number" inputmode="decimal" placeholder="240" min="0" step="any">
  <input type="hidden" id="e-drawer">
  <input type="hidden" id="e-country-id">
  <input type="hidden" id="e-id">
  <div class="modal-actions">
    <button class="btn ghost" onclick="closeAll()">Cancel</button>
    <button class="btn" onclick="saveExpense()">Save</button>
  </div>
</div></div>
```

- [ ] **Step 3: Remove `ov-target` overlay**

Find and delete the entire block:
```html
<div class="overlay" id="ov-target"><div class="modal">
  ...
</div></div>
```

- [ ] **Step 4: Add CSS for budget drawers**

Find the closing `</style>` tag and insert before it:

```css
  /* ── Budget redesign ── */
  --red: #d94f4f;
  .budget-drawer{margin-bottom:24px;background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
  .drawer-header{display:flex;align-items:center;gap:10px;padding:16px 18px 12px}
  .drawer-icon{flex-shrink:0;color:var(--ink-soft)}
  .drawer-title{font-family:'Fraunces',serif;font-size:16px;font-weight:600;color:var(--ink);flex:1}
  .drawer-totals{text-align:right;font-size:13px;color:var(--ink-soft);line-height:1.4}
  .drawer-totals .actual{font-family:'Fraunces',serif;font-size:17px;font-weight:600;color:var(--ink)}
  .drawer-totals .actual.over{color:var(--red)}
  .drawer-planned{font-size:12px;color:var(--ink-soft)}
  .budget-meter{height:4px;background:var(--line);margin:0 18px 14px;border-radius:2px;overflow:hidden}
  .budget-meter-fill{height:100%;background:var(--accent);border-radius:2px;transition:width .3s}
  .budget-meter-fill.over{background:var(--red)}
  .expense-row{display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid var(--line);cursor:pointer}
  .expense-row:hover{background:var(--accent-soft)}
  .expense-row-label{flex:1;font-size:15px;color:var(--ink)}
  .expense-row-amount{font-family:'Fraunces',serif;font-size:15px;color:var(--ink);white-space:nowrap}
  .expense-row-del{background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:17px;padding:2px 6px;line-height:1}
  .expense-row-del:hover{color:var(--red)}
  .expense-row.auto{cursor:default;opacity:.75}
  .expense-row.auto:hover{background:none}
  .add-expense-row{display:flex;align-items:center;gap:8px;padding:10px 18px;border-top:1px solid var(--line);color:var(--ink-soft);font-size:14px;cursor:pointer;user-select:none}
  .add-expense-row:hover{color:var(--accent)}
  .budget-planned-edit{display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--ink-soft);font-size:13px;border-bottom:1px dashed var(--line)}
  .budget-planned-edit:hover{color:var(--accent);border-color:var(--accent)}
  .daily-country{border-top:1px solid var(--line)}
  .daily-country-header{display:flex;align-items:center;gap:10px;padding:12px 18px;cursor:pointer;user-select:none}
  .daily-country-header:hover{background:var(--accent-soft)}
  .daily-country-name{font-family:'Fraunces',serif;font-size:15px;font-weight:600;flex:1;color:var(--ink)}
  .daily-country-meta{font-size:13px;color:var(--ink-soft)}
  .daily-country-actual{font-family:'Fraunces',serif;font-size:15px;color:var(--ink);white-space:nowrap}
  .daily-country-actual.over{color:var(--red)}
  .daily-arrow{font-size:11px;color:var(--ink-soft)}
  .budget-summary-bar{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;margin-bottom:18px;box-shadow:var(--shadow)}
  .bsb-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
  .bsb-label{font-size:13px;color:var(--ink-soft)}
  .bsb-amounts{font-family:'Fraunces',serif;font-size:15px;color:var(--ink)}
  .bsb-meter{height:6px;background:var(--line);border-radius:3px;overflow:hidden}
  .bsb-fill{height:100%;background:var(--accent);border-radius:3px;transition:width .3s}
  .bsb-fill.over{background:var(--red)}
  .inline-planned-input{font-size:13px;padding:2px 6px;border:1px solid var(--accent);border-radius:6px;width:80px;text-align:right}
```

Note: `--red` must go inside the existing `:root { }` block, not in the regular CSS block. Find the `:root` rule:
```css
:root{--bg:#f7f5f0;--paper:#fffdf9;--ink:#2c2a26;--ink-soft:#6b675e;--line:#e6e1d6;
    --accent:#3f6f5e;--accent-soft:#e8efe9;--gold:#c2924a;
    --shadow:...;--radius:16px;}
```
Add `--red:#d94f4f;` inside it. Then add the rest of the CSS (without `--red: #d94f4f;`) before `</style>`.

- [ ] **Step 5: Verify page loads without JS errors**

Open the app in browser, go to Budget tab. Expect blank drawers (no render yet — Task 3 handles that). No console errors.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: budget page HTML/CSS — three drawer containers, simplified expense modal"
```

---

### Task 3: `renderBudget()` — three-drawer rendering

**Files:**
- Modify: `app.js` — replace `renderBudget()`, remove `renderBookedFlightsLine()`, remove `CATEGORIES`, add `_collapsedCountries`, add `fmt()`, add `toggleCountrySection()`

**Interfaces:**
- Consumes: `budgetPlanned` (Task 1), `expenses[]`, `flights[]`, `countries[]`, `parsePrice()`, `esc()` from existing app
- Produces: `renderBudget()`, `toggleCountrySection(countryId)` — called from HTML onclick in Task 4

- [ ] **Step 1: Add `fmt()` helper and `_collapsedCountries` near top of budget section**

Find `const CATEGORIES = [...]` (around line 1407) and replace the entire line with:

```javascript
const _collapsedCountries = new Set();

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
```

- [ ] **Step 2: Remove `renderBookedFlightsLine()`**

Find `function renderBookedFlightsLine()` and delete the entire function (from `function renderBookedFlightsLine() {` through its closing `}`).

- [ ] **Step 3: Replace `renderBudget()` with the full three-drawer implementation**

Find the entire `function renderBudget(){...}` block and replace with:

```javascript
function bookedFlightSum() {
  return flights.filter(f => f.booked)
    .map(f => parsePrice(f.price)).filter(n => n !== null)
    .reduce((s, n) => s + n, 0);
}

function renderBudget() {
  _renderBudgetSummaryBar();
  _renderOneoffDrawer();
  _renderDailyDrawer();
  _renderContingencyDrawer();
}

function _renderBudgetSummaryBar() {
  const el = document.getElementById('budget-summary-bar');
  if (!el) return;
  const oneoffActual = bookedFlightSum() +
    expenses.filter(e => e.drawer === 'oneoff').reduce((s, e) => s + Number(e.amount || 0), 0);
  const dailyActual = expenses.filter(e => e.drawer === 'daily').reduce((s, e) => s + Number(e.amount || 0), 0);
  const contActual = expenses.filter(e => e.drawer === 'contingency').reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalActual = oneoffActual + dailyActual + contActual;
  const dailyPlanned = countries.reduce((s, c) =>
    s + Number(c.daily_budget || 0) * Number(c.planned_days || 0), 0);
  const totalPlanned = Number(budgetPlanned.oneoff || 0) + dailyPlanned + Number(budgetPlanned.contingency || 0);
  const hasPlan = totalPlanned > 0;
  const pct = hasPlan ? Math.min(100, Math.round(totalActual / totalPlanned * 100)) : 0;
  const over = hasPlan && totalActual > totalPlanned;
  el.innerHTML = `<div class="budget-summary-bar">
    <div class="bsb-row">
      <span class="bsb-label">Total spent</span>
      <span class="bsb-amounts">${fmt(totalActual)}${hasPlan ? ' of ' + fmt(totalPlanned) : ''}</span>
    </div>
    ${hasPlan ? `<div class="bsb-meter"><div class="bsb-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>` : ''}
  </div>`;
}

function _renderPlannedEdit(type, currentVal, countryId) {
  const id = countryId ? 'daily-' + countryId : type;
  if (currentVal) {
    return `<span class="budget-planned-edit" onclick="startEditPlanned('${type}','${countryId || ''}',this)"
      title="Tap to edit planned">planned ${fmt(currentVal)}</span>`;
  }
  return `<span class="budget-planned-edit" onclick="startEditPlanned('${type}','${countryId || ''}',this)"
    title="Set planned amount">set planned</span>`;
}

function _renderExpenseRows(drawerExpenses, drawer, countryId) {
  return drawerExpenses.map(e => `
    <div class="expense-row" onclick="editExpense('${e.id}')">
      <span class="expense-row-label">${esc(e.label || 'Expense')}</span>
      <span class="expense-row-amount">${fmt(e.amount)}</span>
      <button class="expense-row-del" onclick="event.stopPropagation();delExpense('${e.id}')" title="Delete">×</button>
    </div>`).join('');
}

function _renderAddRow(drawer, countryId) {
  return `<div class="add-expense-row" onclick="openExpense('${drawer}','${countryId || ''}')">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    Add expense
  </div>`;
}

function _renderMeter(actual, planned) {
  if (!planned) return '';
  const pct = Math.min(100, Math.round(actual / planned * 100));
  const over = actual > planned;
  return `<div class="budget-meter"><div class="budget-meter-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>`;
}

function _renderOneoffDrawer() {
  const el = document.getElementById('drawer-oneoff');
  if (!el) return;
  const manualExpenses = expenses.filter(e => e.drawer === 'oneoff');
  const bookedFlights = flights.filter(f => f.booked);
  const autoTotal = bookedFlightSum();
  const manualTotal = manualExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const actual = autoTotal + manualTotal;
  const planned = budgetPlanned.oneoff;
  const over = planned && actual > planned;

  const autoRows = bookedFlights.map(f => {
    const parsed = parsePrice(f.price);
    const label = [f.airline, f.origin && f.destination ? f.origin + ' → ' + f.destination : ''].filter(Boolean).join(' · ') || 'Flight';
    return `<div class="expense-row auto">
      <span class="expense-row-label">${esc(label)}</span>
      <span class="expense-row-amount">${parsed != null ? fmt(parsed) : esc(f.price || '—')}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="drawer-header">
      <span class="drawer-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2H7a2 2 0 0 0-1.41.59L2.59 6.59A2 2 0 0 0 2 8v5a2 2 0 0 0 .59 1.41l7 7a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.82l-7-7A2 2 0 0 0 12 2z"/>
          <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      </span>
      <span class="drawer-title">One-off Expenses</span>
      <div class="drawer-totals">
        <div class="actual${over ? ' over' : ''}">${fmt(actual)}</div>
        <div class="drawer-planned">${_renderPlannedEdit('oneoff', planned, '')}</div>
      </div>
    </div>
    ${_renderMeter(actual, planned)}
    ${autoRows}
    ${_renderExpenseRows(manualExpenses, 'oneoff', '')}
    ${_renderAddRow('oneoff', '')}`;
}

function _renderDailyDrawer() {
  const el = document.getElementById('drawer-daily');
  if (!el) return;
  const dailyExpenses = expenses.filter(e => e.drawer === 'daily');
  const totalActual = dailyExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPlanned = countries.reduce((s, c) =>
    s + Number(c.daily_budget || 0) * Number(c.planned_days || 0), 0);
  const over = totalPlanned > 0 && totalActual > totalPlanned;

  const countrySections = countries.map(c => {
    const cExpenses = dailyExpenses.filter(e => e.country_id === c.id);
    const cActual = cExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const cPlanned = Number(c.daily_budget || 0) * Number(c.planned_days || 0);
    const cOver = cPlanned > 0 && cActual > cPlanned;
    const hasExpenses = cExpenses.length > 0;
    const isCollapsed = !hasExpenses && _collapsedCountries.has(c.id) ||
      (!hasExpenses && !_collapsedCountries.has('open-' + c.id));
    const arrow = isCollapsed ? '▸' : '▾';

    const rateLabel = c.daily_budget
      ? `${fmt(c.daily_budget)}/day${c.planned_days ? ' × ' + c.planned_days + 'd' : ''}`
      : '';
    const plannedLabel = cPlanned ? fmt(cPlanned) : '';

    return `<div class="daily-country">
      <div class="daily-country-header" onclick="toggleCountrySection('${c.id}')">
        <span class="daily-arrow">${arrow}</span>
        <span class="daily-country-name">${esc(c.flag || '')} ${esc(c.name)}</span>
        <span class="daily-country-meta">${_renderPlannedEdit('daily', c.daily_budget, c.id)}${plannedLabel ? ' = ' + plannedLabel : ''}</span>
        <span class="daily-country-actual${cOver ? ' over' : ''}">${cActual ? fmt(cActual) : ''}</span>
      </div>
      ${isCollapsed ? '' : `
        ${_renderExpenseRows(cExpenses, 'daily', c.id)}
        ${_renderAddRow('daily', c.id)}
      `}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="drawer-header">
      <span class="drawer-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      </span>
      <span class="drawer-title">Daily Budget</span>
      <div class="drawer-totals">
        <div class="actual${over ? ' over' : ''}">${fmt(totalActual)}</div>
        ${totalPlanned ? `<div class="drawer-planned">of ${fmt(totalPlanned)}</div>` : ''}
      </div>
    </div>
    ${_renderMeter(totalActual, totalPlanned)}
    ${countrySections || '<div style="padding:14px 18px;color:var(--ink-soft);font-size:14px">No countries yet — add them in the Countries tab.</div>'}`;
}

function _renderContingencyDrawer() {
  const el = document.getElementById('drawer-contingency');
  if (!el) return;
  const cExpenses = expenses.filter(e => e.drawer === 'contingency');
  const actual = cExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const planned = budgetPlanned.contingency;
  const over = planned && actual > planned;

  el.innerHTML = `
    <div class="drawer-header">
      <span class="drawer-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>
        </svg>
      </span>
      <span class="drawer-title">Contingency Budget</span>
      <div class="drawer-totals">
        <div class="actual${over ? ' over' : ''}">${fmt(actual)}</div>
        <div class="drawer-planned">${_renderPlannedEdit('contingency', planned, '')}</div>
      </div>
    </div>
    ${_renderMeter(actual, planned)}
    ${_renderExpenseRows(cExpenses, 'contingency', '')}
    ${_renderAddRow('contingency', '')}`;
}

function toggleCountrySection(countryId) {
  if (_collapsedCountries.has(countryId)) {
    _collapsedCountries.delete(countryId);
    _collapsedCountries.add('open-' + countryId);
  } else if (_collapsedCountries.has('open-' + countryId)) {
    _collapsedCountries.delete('open-' + countryId);
    _collapsedCountries.add(countryId);
  } else {
    // first tap: was showing expanded (default for countries with expenses, or default state)
    // toggle to explicitly collapsed
    _collapsedCountries.add(countryId);
  }
  renderBudget();
}
```

- [ ] **Step 4: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```
Expected: no output.

- [ ] **Step 5: Open browser and check Budget tab**

Three drawers should render. One-off shows booked flights (if any). Daily shows per-country sections. Contingency shows empty. Summary bar shows at top.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: renderBudget — three drawer rendering with progress bars and collapse"
```

---

### Task 4: Expense CRUD + inline planned editing

**Files:**
- Modify: `app.js` — replace `openExpense()`, `saveExpense()`, `delExpense()`, remove `openBudgetTarget()` + `saveBudgetTarget()`, add `editExpense()`, `startEditPlanned()`

**Interfaces:**
- Consumes: `saveOneoffBudget()`, `saveContingencyBudget()`, `saveDailyBudget()` from Task 1; `renderBudget()` from Task 3; DOM from Task 2

- [ ] **Step 1: Add `_editingExpenseId` module var**

Find `let _editingFlightId = null;` (around line 1163) and add below it:

```javascript
let _editingExpenseId = null;
```

- [ ] **Step 2: Replace `openExpense()`, `saveExpense()`, `delExpense()`**

Find the three functions and replace them entirely:

```javascript
function openExpense(drawer, countryId) {
  _editingExpenseId = null;
  document.getElementById('e-title').textContent = 'Add expense';
  document.getElementById('e-label').value = '';
  document.getElementById('e-amount').value = '';
  document.getElementById('e-drawer').value = drawer || 'oneoff';
  document.getElementById('e-country-id').value = countryId || '';
  document.getElementById('e-id').value = '';
  openOverlay('ov-expense');
}

function editExpense(id) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  _editingExpenseId = id;
  document.getElementById('e-title').textContent = 'Edit expense';
  document.getElementById('e-label').value = e.label || '';
  document.getElementById('e-amount').value = e.amount || '';
  document.getElementById('e-drawer').value = e.drawer || 'oneoff';
  document.getElementById('e-country-id').value = e.country_id || '';
  document.getElementById('e-id').value = id;
  openOverlay('ov-expense');
}

async function saveExpense() {
  const label = document.getElementById('e-label').value.trim() || 'Expense';
  const amount = parseFloat(document.getElementById('e-amount').value);
  if (isNaN(amount) || amount <= 0) { alert('Enter a valid amount.'); return; }
  const drawer = document.getElementById('e-drawer').value || 'oneoff';
  const countryId = document.getElementById('e-country-id').value || null;
  const row = { trip_id: TRIP_ID, label, amount, drawer, country_id: countryId };

  if (_editingExpenseId) {
    if (GUEST_MODE) lsUpdate('expenses', _editingExpenseId, row);
    else await sb.from('expenses').update(row).eq('id', _editingExpenseId);
  } else {
    if (GUEST_MODE) lsInsert('expenses', row);
    else {
      const { error } = await sb.from('expenses').insert(row);
      if (error) { alert(error.message); return; }
    }
  }
  _editingExpenseId = null;
  closeAll();
  await refreshAll();
}

async function delExpense(id) {
  if (GUEST_MODE) { lsDelete('expenses', id); await refreshAll(); return; }
  await sb.from('expenses').delete().eq('id', id);
  await refreshAll();
}
```

- [ ] **Step 3: Remove `openBudgetTarget()` and `saveBudgetTarget()`**

Find and delete both functions entirely.

- [ ] **Step 4: Add `startEditPlanned()` function**

Add after `delExpense()`:

```javascript
function startEditPlanned(type, countryId, el) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'inline-planned-input';
  input.placeholder = '0';
  input.min = '0';
  input.step = 'any';
  if (type === 'daily' && countryId) {
    const c = countries.find(x => x.id === countryId);
    input.value = c?.daily_budget || '';
  } else if (type === 'oneoff') {
    input.value = budgetPlanned.oneoff || '';
  } else {
    input.value = budgetPlanned.contingency || '';
  }
  el.replaceWith(input);
  input.focus();
  input.select();

  const save = () => {
    const val = input.value.trim();
    if (type === 'daily' && countryId) saveDailyBudget(countryId, val);
    else if (type === 'oneoff') saveOneoffBudget(val);
    else saveContingencyBudget(val);
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
}
```

- [ ] **Step 5: Verify syntax**

```bash
node --check /Users/lihi.shua/projects/TriPlanner/app.js
```
Expected: no output.

- [ ] **Step 6: End-to-end browser test**

1. Go to Budget tab — three drawers visible, summary bar at top
2. One-off: if you have a booked flight, it appears as an auto row with its price
3. Tap "set planned" on One-off → input appears → type 3000 → Enter → updates to "planned $3,000"
4. Tap "+ Add expense" on One-off → modal opens → fill description + amount → Save → expense appears in list
5. Tap an expense row → modal opens pre-filled → change amount → Save → updates
6. Tap × on an expense → it disappears
7. Daily tab: tap "set planned" on a country → type daily rate → saves → planned total updates in header
8. Tap a country header → collapses/expands
9. Contingency: set planned, add expenses, watch progress bar fill
10. Summary bar updates to reflect all drawers

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: budget CRUD — openExpense, editExpense, saveExpense, delExpense, inline planned editing"
```
