/* app.js — TriPlanner front-end logic */

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TRIPLANNER_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let TRIP_ID = null;
let GUEST_MODE = false;
let myTrips = [];
let countries = [];
let cities = [];
let flights = [];
let expenses = [];
let budgetTarget = null;
let research = [];
let previewMapInstance = null;
let _researchImageFile     = null;
let _researchImageB64      = null;
let _researchExtracted     = null;

/* ---------------- GUEST / LOCAL STORAGE ---------------- */
const GUEST_TRIP_ID = 'guest';

function lsKey(table) { return 'triplanner_' + table; }
function lsGet(table) {
  try { return JSON.parse(localStorage.getItem(lsKey(table)) || '[]'); } catch { return []; }
}
function lsSave(table, rows) { localStorage.setItem(lsKey(table), JSON.stringify(rows)); }
function lsInsert(table, row) {
  const rows = lsGet(table);
  const newRow = { ...row, id: Date.now().toString(36) + Math.random().toString(36).slice(2), created_at: new Date().toISOString() };
  rows.push(newRow);
  lsSave(table, rows);
  return newRow;
}
function lsUpdate(table, id, data) {
  lsSave(table, lsGet(table).map(r => r.id === id ? { ...r, ...data } : r));
}
function lsDelete(table, id) { lsSave(table, lsGet(table).filter(r => r.id !== id)); }

/* ---------------- AUTH ---------------- */
async function init() {
  if (localStorage.getItem('triplanner_guest_mode') === '1') {
    enterAsGuest(false);
    return;
  }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) onLoggedIn();
    else showAuth();
    sb.auth.onAuthStateChange((_e, s) => { if (s) onLoggedIn(); else showAuth(); });
  } catch (e) {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('auth').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

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

async function doLogin() {
  const email = val('au-email'), pw = val('au-pass');
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) return authMsg(error.message);
}
async function doSignup() {
  const email = val('au-email'), pw = val('au-pass');
  const { error } = await sb.auth.signUp({ email, password: pw });
  if (error) return authMsg(error.message);
  authMsg("Account created. If email confirmation is on, confirm then log in. "
        + "Remember: an admin must add you to the shared trip once (see schema.sql).");
}
async function doLogout() {
  if (GUEST_MODE) {
    GUEST_MODE = false;
    TRIP_ID = null;
    localStorage.removeItem('triplanner_guest_mode');
    document.getElementById('logout-btn').textContent = 'Log out';
    showAuth();
    return;
  }
  await sb.auth.signOut();
}
function authMsg(m){ document.getElementById('au-msg').textContent = m; }

async function onLoggedIn() {
  GUEST_MODE = false;
  document.getElementById('auth').style.display = 'none';

  const { data, error } = await sb.from('trips').select('id, name').order('created_at', { ascending: true });
  if (error) { authMsg(error.message); showAuth(); return; }
  myTrips = data || [];

  if (!myTrips.length) {
    showTripOnboarding();
    return;
  }

  const lastId = localStorage.getItem('triplanner_last_trip');
  const last = lastId && myTrips.find(t => t.id === lastId);
  await enterTrip(last || myTrips[0]);
}

function showTripOnboarding() {
  document.getElementById('trip-onboarding').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function enterTrip(trip) {
  TRIP_ID = trip.id;
  localStorage.setItem('triplanner_last_trip', trip.id);
  document.getElementById('trip-onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderTripCarousel();
  await refreshAll();
}

function renderTripCarousel() {
  const el = document.getElementById('trip-carousel');
  if (GUEST_MODE) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = myTrips.map(t =>
    `<button class="trip-chip${t.id === TRIP_ID ? ' active' : ''}" onclick="switchTrip('${t.id}')">${esc(t.name)}</button>`
  ).join('') + `<button class="trip-chip add" onclick="openTripsManager()">＋ New trip</button>`;
}

async function switchTrip(id) {
  const trip = myTrips.find(t => t.id === id);
  if (!trip || trip.id === TRIP_ID) return;
  await enterTrip(trip);
}

function openTripsManager() {
  document.getElementById('mt-new-name').value = '';
  document.getElementById('mt-join-email').value = '';
  document.getElementById('mt-join-name').value = '';
  tripsModalMsg('');
  openOverlay('ov-trips');
}

async function doCreateTrip() {
  const fromOnboarding = document.getElementById('trip-onboarding').style.display !== 'none';
  const nameEl = fromOnboarding ? 'new-trip-name' : 'mt-new-name';
  const name = val(nameEl).trim();
  if (!name) return onboardingMsg('Enter a trip name.');

  const { data, error } = await sb.rpc('create_my_trip', { p_name: name });
  if (error) {
    const m = error.message || JSON.stringify(error);
    return fromOnboarding ? onboardingMsg(m) : tripsModalMsg(m);
  }
  if (!data) return fromOnboarding
    ? onboardingMsg('Trip creation failed — make sure you ran the RPC functions in Supabase SQL editor.')
    : tripsModalMsg('Trip creation failed — RPC functions missing.');

  const newTrip = { id: data, name };
  myTrips.push(newTrip);
  closeAll();
  await enterTrip(newTrip);
}

async function doJoinTrip() {
  const fromOnboarding = document.getElementById('trip-onboarding').style.display !== 'none';
  const email = val(fromOnboarding ? 'join-email' : 'mt-join-email').trim();
  const tripName = val(fromOnboarding ? 'join-trip-name' : 'mt-join-name').trim();
  if (!email || !tripName) return fromOnboarding
    ? onboardingMsg('Enter both the email and trip name.')
    : tripsModalMsg('Enter both the email and trip name.');

  const msg = fromOnboarding ? onboardingMsg : tripsModalMsg;
  msg('Looking up trip…');
  const { data, error } = await sb.rpc('join_trip_by_invite', { p_email: email, p_trip_name: tripName });
  if (error) return msg(error.message);

  const joined = { id: data, name: tripName };
  if (!myTrips.find(t => t.id === data)) myTrips.push(joined);
  closeAll();
  await enterTrip(joined);
}

function onboardingMsg(m) {
  const el = document.getElementById('trip-onboarding-msg');
  el.textContent = m;
  el.style.color = m ? '#b4544a' : '';
  if (m) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function tripsModalMsg(m) { document.getElementById('trips-modal-msg').textContent = m; }

/* ---------------- DATA ---------------- */
async function refreshAll() {
  if (GUEST_MODE) {
    const allCountries = lsGet('countries');
    const allCities    = lsGet('cities');
    const allFlights   = lsGet('flights');
    const allExpenses  = lsGet('expenses');
    const allBudget    = lsGet('budget_settings');
    countries    = allCountries.filter(r => r.trip_id === TRIP_ID);
    cities       = allCities.filter(r => r.trip_id === TRIP_ID);
    flights      = allFlights.filter(r => r.trip_id === TRIP_ID);
    expenses     = allExpenses.filter(r => r.trip_id === TRIP_ID)
                              .sort((a,b) => (b.spent_on||'').localeCompare(a.spent_on||''));
    budgetTarget = allBudget.find(r => r.trip_id === TRIP_ID) || null;
    research     = lsGet('flight_research').filter(r => r.trip_id === TRIP_ID)
                              .sort((a,b) => b.created_at.localeCompare(a.created_at));
    renderCountries(); renderFlights(); renderResearch(); renderBudget();
    return;
  }
  const [c, ci, f, ex, bs, res] = await Promise.all([
    sb.from('countries').select('*').order('created_at'),
    sb.from('cities').select('*').order('created_at'),
    sb.from('flights').select('*').order('created_at'),
    sb.from('expenses').select('*').order('spent_on', { ascending: false }),
    sb.from('budget_settings').select('*').eq('trip_id', TRIP_ID).maybeSingle(),
    sb.from('flight_research').select('*').eq('trip_id', TRIP_ID).order('created_at', { ascending: false }),
  ]);
  countries = c.data || []; cities = ci.data || []; flights = f.data || [];
  expenses = ex.data || []; budgetTarget = bs.data || null; research = res.data || [];
  renderCountries(); renderFlights(); renderResearch(); renderBudget();
}

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

/* geocode a city name via OpenStreetMap Nominatim (free, no key) */
async function geocode(q) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
      + encodeURIComponent(q));
    const j = await r.json();
    if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
  } catch (e) {}
  return { lat: null, lng: null };
}

/* ---------------- CAPTURE (place → auto-detect country) ---------------- */
let _placeDebounce = null;

function onPlaceInput() {
  clearTimeout(_placeDebounce);
  const place = document.getElementById('cap-place').value.trim();
  if (place.length < 2) return;
  document.getElementById('cap-country-status').textContent = 'detecting…';
  _placeDebounce = setTimeout(() => autoDetectCountry(place), 600);
}

async function autoDetectCountry(place) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=6&q='
      + encodeURIComponent(place) + '&addressdetails=1');
    const results = await r.json();
    document.getElementById('cap-country-status').textContent = '';

    const seen = new Set();
    const options = results
      .map(r => r.address?.country)
      .filter(c => c && !seen.has(c) && seen.add(c));

    if (!options.length) return;

    if (options.length === 1) {
      document.getElementById('cap-country').value = options[0];
      document.getElementById('cap-country-suggestions').innerHTML = '';
    } else {
      document.getElementById('cap-country-suggestions').innerHTML =
        options.map(c =>
          `<button class="suggestion-chip" onclick="pickCountry('${esc(c)}')">${FLAGS[c.toLowerCase()]||'🌍'} ${esc(c)}</button>`
        ).join('');
    }
  } catch (e) {
    document.getElementById('cap-country-status').textContent = '';
  }
}

function pickCountry(name) {
  document.getElementById('cap-country').value = name;
  document.getElementById('cap-country-suggestions').innerHTML = '';
}

async function runCapture() {
  const cityName    = document.getElementById('cap-place').value.trim();
  const countryName = document.getElementById('cap-country').value.trim();
  const url         = val('cap-url').trim();

  if (!cityName && !countryName) return capMsg('Enter a place or country name.');

  // Country-only: Place is empty, or Place matches Country
  const isCountryOnly = !cityName || (countryName && cityName.toLowerCase() === countryName.toLowerCase());
  const effectiveCountry = countryName || cityName;

  capMsg('Filing…');
  const country = await ensureCountry(cap(effectiveCountry), FLAGS[effectiveCountry.toLowerCase()] || '🌍');
  if (!country) return;

  if (isCountryOnly) { closeAll(); await refreshAll(); return; }

  capMsg('Looking up location…');
  const geo = await geocode(cityName + ', ' + countryName);

  if (GUEST_MODE) {
    lsInsert('cities', {
      trip_id: TRIP_ID, country_id: country.id, name: cap(cityName),
      lat: geo.lat, lng: geo.lng, source_url: url || null,
    });
    closeAll(); await refreshAll();
    return;
  }

  const { error } = await sb.from('cities').insert({
    trip_id: TRIP_ID, country_id: country.id, name: cap(cityName),
    lat: geo.lat, lng: geo.lng, source_url: url || null,
  });
  if (error) return capMsg(error.message);
  closeAll(); await refreshAll();
}

/* ---------------- RENDER: COUNTRIES ---------------- */
function renderCountries() {
  const el = document.getElementById('countryList');
  if (!countries.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">No countries yet. '
      + 'Use "Capture" with something like "Hoi An, Vietnam".</div>';
  } else {
    el.innerHTML = countries.map(c => {
      const n = cities.filter(ci => ci.country_id === c.id).length;
      const daysLabel = c.planned_days ? ` · ${c.planned_days} days` : '';
      return `<div class="card country-card" onclick="openCountry('${c.id}')">
        <div class="country-flag">${esc(c.flag) || '🌍'}</div>
        <h3>${esc(c.name)}</h3>
        <div class="when">${n} ${n === 1 ? 'place' : 'places'}${daysLabel}</div>
      </div>`;
    }).join('');
  }
}

async function suggestItinerary() {
  openOverlay('ov-plan');
  document.getElementById('plan-ai-out').textContent = 'Asking Claude…';
  const placesData = countries.map(c => ({
    name: c.name, planned_days: c.planned_days || null,
    places: cities.filter(ci => ci.country_id === c.id)
      .map(ci => ({ name: ci.name, planned_days: ci.planned_days || null })),
  }));
  const flightsData = flights.map(f => ({
    from: f.origin, to: f.destination, date: f.depart_date,
    airline: f.airline, price: f.price,
  }));
  try {
    const { data, error } = await sb.functions.invoke('plan-trip', {
      body: { places: placesData, flights: flightsData },
    });
    document.getElementById('plan-ai-out').textContent =
      error ? (error.message || JSON.stringify(error))
      : (data?.suggestion || 'No suggestion returned.');
  } catch (e) {
    document.getElementById('plan-ai-out').textContent = 'Error: ' + String(e);
  }
}

/* ---------------- COUNTRY + CITY DETAIL ---------------- */
function openCountry(id) {
  const c = countries.find(x => x.id === id); if (!c) return;
  const places = cities.filter(ci => ci.country_id === id);
  const placeTotal = places.reduce((s, p) => s + (p.planned_days || 0), 0);
  const over = c.planned_days && placeTotal > c.planned_days;

  document.getElementById('detailTitle').textContent = (c.flag || '') + ' ' + c.name;
  document.getElementById('detailBody').innerHTML = `
    <div class="country-days-row">
      <span style="flex:1">Planning to spend</span>
      <input type="number" min="1" max="365" value="${c.planned_days || ''}" placeholder="?"
        style="width:60px;text-align:center;font-size:15px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;flex-shrink:0"
        onchange="saveCountryDays('${c.id}', this.value)">
      <span>days here</span>
    </div>

    <div class="places-header">Places to visit</div>

    ${places.map(p => `
      <div class="place-item">
        <span class="place-item-name" onclick="openCity('${p.id}')">📍 ${esc(p.name)}</span>
        <input type="number" min="0.5" max="365" step="0.5"
          value="${p.planned_days || ''}" placeholder="days"
          class="place-days-input"
          onchange="savePlaceTime('${p.id}','${c.id}',this.value)">
        <span class="place-days-unit">days</span>
        <button class="del" style="position:static;opacity:.35;font-size:17px;margin-left:2px"
          onclick="deletePlace('${p.id}','${c.id}')">×</button>
      </div>`).join('')}
    ${!places.length ? '<div class="empty" style="margin:8px 0 12px">No places yet — add some below.</div>' : ''}

    ${placeTotal > 0 ? `<div class="places-total">Places total: <b>${placeTotal} days</b>${c.planned_days ? ' of ' + c.planned_days + ' planned' : ''}</div>` : ''}

    ${over ? `<div class="time-warning" id="time-warning">
      Your places add up to <b>${placeTotal} days</b>, but you've planned only <b>${c.planned_days} days</b> for ${esc(c.name)}.
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn small" onclick="saveCountryDays('${c.id}',${placeTotal})">Update to ${placeTotal} days</button>
        <button class="btn ghost small" onclick="document.getElementById('time-warning').remove()">I'll adjust</button>
      </div>
    </div>` : ''}

    <div class="add-place-row">
      <input id="new-place-${c.id}" placeholder="City, park, restaurant, beach…" style="flex:1"
        onkeydown="if(event.key==='Enter')addPlaceToCountry('${c.id}')">
      <button class="btn small" onclick="addPlaceToCountry('${c.id}')">Add</button>
    </div>`;

  openOverlay('ov-detail');
}

async function saveCountryDays(countryId, val) {
  const days = parseFloat(val) || null;
  const country = countries.find(c => c.id === countryId);
  if (!country) return;
  country.planned_days = days;
  if (GUEST_MODE) { lsUpdate('countries', countryId, { planned_days: days }); }
  else await sb.from('countries').update({ planned_days: days }).eq('id', countryId);
  openCountry(countryId);
}

async function savePlaceTime(placeId, countryId, val) {
  const days = parseFloat(val) || null;
  const place = cities.find(c => c.id === placeId);
  if (!place) return;
  place.planned_days = days;
  if (GUEST_MODE) { lsUpdate('cities', placeId, { planned_days: days }); }
  else await sb.from('cities').update({ planned_days: days }).eq('id', placeId);
  openCountry(countryId);
}

async function addPlaceToCountry(countryId) {
  const input = document.getElementById('new-place-' + countryId);
  const name = input?.value.trim();
  if (!name) return;
  const country = countries.find(c => c.id === countryId);
  const geo = await geocode(name + (country ? ', ' + country.name : ''));
  if (GUEST_MODE) {
    const newPlace = lsInsert('cities', { trip_id: TRIP_ID, country_id: countryId, name: cap(name), lat: geo.lat, lng: geo.lng });
    cities.push(newPlace);
  } else {
    const { data, error } = await sb.from('cities')
      .insert({ trip_id: TRIP_ID, country_id: countryId, name: cap(name), lat: geo.lat, lng: geo.lng })
      .select().single();
    if (error) { alert(error.message); return; }
    cities.push(data);
  }
  openCountry(countryId);
}

async function deletePlace(placeId, countryId) {
  cities = cities.filter(c => c.id !== placeId);
  if (GUEST_MODE) { lsDelete('cities', placeId); }
  else await sb.from('cities').delete().eq('id', placeId);
  openCountry(countryId);
}

async function openCity(id) {
  const c = cities.find(x => x.id === id); if (!c) return;
  const country = countries.find(co => co.id === c.country_id);
  document.getElementById('detailTitle').textContent = '📍 ' + c.name;
  const body = document.getElementById('detailBody');
  body.innerHTML = `
    <div id="wx" class="wx">Loading weather…</div>
    ${c.source_url ? `<a class="srclink" href="${esc(c.source_url)}" target="_blank">↗ open saved link</a>` : ''}
    <div class="ai-block">
      <div class="ai-head">
        <span>What to do here</span>
        <button class="btn small" onclick="investigate('${c.id}')">✦ Investigate with AI</button>
      </div>
      <div id="ai-out" class="ai-out">${c.ai_notes ? esc(c.ai_notes) : 'Tap "Investigate with AI" for a kid-friendly briefing.'}</div>
    </div>`;
  openOverlay('ov-detail');
  if (c.lat && c.lng) loadWeather(c.lat, c.lng);
  else document.getElementById('wx').textContent = 'No coordinates saved for weather.';
}

/* ---------------- WEATHER (Open-Meteo, free) ---------------- */
async function loadWeather(lat, lng) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}`
      + `&longitude=${lng}&current=temperature_2m,weather_code&daily=temperature_2m_max,`
      + `temperature_2m_min,weather_code&forecast_days=3&timezone=auto`);
    const j = await r.json();
    const cur = j.current;
    const days = j.daily;
    const wx = document.getElementById('wx');
    if (!cur) { wx.textContent = 'Weather unavailable.'; return; }
    let html = `<div class="wx-now">${wxIcon(cur.weather_code)} ${Math.round(cur.temperature_2m)}°C now</div>`;
    html += '<div class="wx-days">';
    for (let i = 0; i < days.time.length; i++) {
      const d = new Date(days.time[i]).toLocaleDateString(undefined, { weekday: 'short' });
      html += `<div><div>${d}</div>${wxIcon(days.weather_code[i])}<div>${Math.round(days.temperature_2m_max[i])}°/${Math.round(days.temperature_2m_min[i])}°</div></div>`;
    }
    html += '</div>';
    wx.innerHTML = html;
  } catch (e) { document.getElementById('wx').textContent = 'Weather unavailable.'; }
}
function wxIcon(code) {
  if (code === 0) return '☀️';
  if ([1,2,3].includes(code)) return '⛅';
  if ([45,48].includes(code)) return '🌫️';
  if ([51,53,55,61,63,65,80,81,82].includes(code)) return '🌧️';
  if ([71,73,75,85,86].includes(code)) return '❄️';
  if ([95,96,99].includes(code)) return '⛈️';
  return '🌡️';
}

/* ---------------- AI INVESTIGATE (via edge function) ---------------- */
async function investigate(cityId) {
  const c = cities.find(x => x.id === cityId);
  const country = countries.find(co => co.id === c.country_id);
  const out = document.getElementById('ai-out');
  if (GUEST_MODE) {
    out.textContent = 'AI investigation requires a Supabase account. Not available in guest mode.';
    return;
  }
  out.textContent = 'Asking Claude…';
  try {
    const { data, error } = await sb.functions.invoke('investigate', {
      body: { city: c.name, country: country?.name || '' },
    });
    if (error) throw error;
    if (data.error) { out.textContent = data.error; return; }
    out.textContent = data.text;
    await sb.from('cities').update({ ai_notes: data.text }).eq('id', cityId);
    c.ai_notes = data.text;
  } catch (e) {
    out.textContent = 'AI not reachable yet. Make sure the "investigate" function is '
      + 'deployed and ANTHROPIC_API_KEY is set.';
  }
}

/* ---------------- FLIGHTS ---------------- */
let _editingFlightId = null;

function renderFlights() {
  const el = document.getElementById('flightList');
  if (!flights.length) { el.innerHTML = '<div class="empty">No flights yet.</div>'; return; }
  el.innerHTML = flights.map(f => `
    <div class="card" onclick="editFlight('${f.id}')" style="cursor:pointer">
      <button class="del" onclick="event.stopPropagation();delFlight('${f.id}')">×</button>
      <div class="flight-route"><span>${esc(f.origin)||'—'}</span>
        <span class="arrow"></span><span>${esc(f.destination)||'—'}</span></div>
      <div class="flight-meta">
        ${f.airline?`<span><b>${esc(f.airline)}</b> ${esc(f.flight_no)||''}</span>`:''}
        ${f.depart_date?`<span>${esc(f.depart_date)} ${esc(f.depart_time)||''}</span>`:''}
        ${f.price?`<span class="pill">${esc(f.price)}</span>`:''}
      </div>
      ${f.notes?`<div class="flight-meta" style="margin-top:8px">${esc(f.notes)}</div>`:''}
    </div>`).join('');
}

function openFlight() {
  _editingFlightId = null;
  document.querySelector('#ov-flight .modal h3').textContent = 'Add flight';
  document.getElementById('f-save-btn').textContent = 'Save flight';
  ['origin','destination','airline','flight_no','depart_date','depart_time','price','notes']
    .forEach(k => document.getElementById('f-'+k).value = '');
  openOverlay('ov-flight');
}

function editFlight(id) {
  const f = flights.find(x => x.id === id); if (!f) return;
  _editingFlightId = id;
  document.querySelector('#ov-flight .modal h3').textContent = 'Edit flight';
  document.getElementById('f-save-btn').textContent = 'Update flight';
  ['origin','destination','airline','flight_no','depart_date','depart_time','price','notes']
    .forEach(k => document.getElementById('f-'+k).value = f[k] || '');
  ['origin','destination'].forEach(k => {
    const iata = (f[k] || '').toUpperCase();
    const airport = AIRPORTS.find(a => a[0] === iata);
    document.getElementById('f-'+k+'-hint').textContent = airport
      ? airport[2] + ' · ' + airport[1] + ', ' + airport[3] : '';
  });
  openOverlay('ov-flight');
}

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
}

async function delFlight(id){
  if (GUEST_MODE) { lsDelete('flights', id); await refreshAll(); return; }
  await sb.from('flights').delete().eq('id', id); await refreshAll();
}

/* ---------------- BUDGET ---------------- */
const CATEGORIES = ['Flights','Lodging','Food','Transport','Activities','Nanny','Other'];

function fmtMoney(n, cur){
  const v = Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});
  return (cur||'USD') + ' ' + v;
}

function renderBudget(){
  const baseCur = budgetTarget?.base_currency || (expenses[0]?.currency) || 'USD';
  const total = expenses.reduce((s,e)=>s + Number(e.amount||0), 0);
  const target = budgetTarget?.total_budget ? Number(budgetTarget.total_budget) : null;

  const sum = document.getElementById('budgetSummary');
  let pct = target ? Math.min(100, Math.round(total/target*100)) : 0;
  const over = target && total > target;
  sum.innerHTML = `<div class="budget-bar">
    <div class="nums">
      <div class="spent">${fmtMoney(total, baseCur)}</div>
      <div class="target">${target ? 'of '+fmtMoney(target, baseCur)+(over?' · over budget':'') : 'no target set'}</div>
    </div>
    ${target ? `<div class="meter"><span class="${over?'over':''}" style="width:${over?100:pct}%"></span></div>` : ''}
  </div>`;

  const byCat = {};
  expenses.forEach(e=>{ byCat[e.category] = (byCat[e.category]||0) + Number(e.amount||0); });
  const max = Math.max(1, ...Object.values(byCat));
  const cat = document.getElementById('budgetByCat');
  const rows = CATEGORIES.filter(c=>byCat[c]).map(c=>`
    <div class="catrow">
      <span class="cname">${c}</span>
      <span class="cbar"><span style="width:${byCat[c]/max*100}%"></span></span>
      <span class="camt">${fmtMoney(byCat[c], baseCur)}</span>
    </div>`).join('');
  cat.innerHTML = rows ? `<div class="catwrap">${rows}</div>` : '';

  const el = document.getElementById('expenseList');
  if(!expenses.length){ el.innerHTML = '<div class="empty">No expenses yet. Add one to start tracking.</div>'; return; }
  el.innerHTML = expenses.map(e=>{
    const country = countries.find(c=>c.id===e.country_id);
    return `<div class="card">
      <button class="del" onclick="delExpense('${e.id}')">×</button>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
        <span style="font-family:'Fraunces',serif;font-size:18px;font-weight:600">${esc(e.label)}</span>
        <span style="font-family:'Fraunces',serif;font-size:18px">${fmtMoney(e.amount, e.currency)}</span>
      </div>
      <div class="flight-meta" style="margin-top:8px">
        <span class="exp-cat">${esc(e.category)}</span>
        ${country?`<span>${esc(country.flag||'')} ${esc(country.name)}</span>`:''}
        ${e.spent_on?`<span>${esc(e.spent_on)}</span>`:''}
      </div>
      ${e.notes?`<div class="flight-meta" style="margin-top:6px">${esc(e.notes)}</div>`:''}
    </div>`;
  }).join('');
}

function openExpense(){
  ['label','amount','currency','notes'].forEach(k=>document.getElementById('e-'+k).value='');
  document.getElementById('e-currency').value = budgetTarget?.base_currency || 'USD';
  document.getElementById('e-category').value = 'Other';
  document.getElementById('e-date').value = new Date().toISOString().slice(0,10);
  const sel = document.getElementById('e-country');
  sel.innerHTML = '<option value="">— none —</option>' +
    countries.map(c=>`<option value="${c.id}">${esc(c.flag||'')} ${esc(c.name)}</option>`).join('');
  openOverlay('ov-expense');
}
async function saveExpense(){
  const amount = parseFloat(val('e-amount'));
  if(isNaN(amount)){ alert('Enter an amount.'); return; }
  const row = {
    trip_id: TRIP_ID,
    label: val('e-label').trim() || 'Expense',
    amount,
    currency: (val('e-currency').trim() || 'USD').toUpperCase(),
    category: val('e-category'),
    spent_on: val('e-date') || null,
    country_id: val('e-country') || null,
    notes: val('e-notes').trim() || null,
  };
  if (GUEST_MODE) { lsInsert('expenses', row); closeAll(); await refreshAll(); return; }
  const { error } = await sb.from('expenses').insert(row);
  if(error) return alert(error.message);
  closeAll(); await refreshAll();
}
async function delExpense(id){
  if (GUEST_MODE) { lsDelete('expenses', id); await refreshAll(); return; }
  await sb.from('expenses').delete().eq('id', id); await refreshAll();
}

function openBudgetTarget(){
  document.getElementById('t-total').value = budgetTarget?.total_budget || '';
  document.getElementById('t-currency').value = budgetTarget?.base_currency || 'USD';
  openOverlay('ov-target');
}
async function saveBudgetTarget(){
  const row = {
    trip_id: TRIP_ID,
    total_budget: parseFloat(val('t-total')) || null,
    base_currency: (val('t-currency').trim() || 'USD').toUpperCase(),
  };
  if (GUEST_MODE) {
    const existing = lsGet('budget_settings').find(r => r.trip_id === TRIP_ID);
    if (existing) lsUpdate('budget_settings', existing.id, row);
    else lsInsert('budget_settings', row);
    closeAll(); await refreshAll();
    return;
  }
  const { error } = await sb.from('budget_settings').upsert(row);
  if(error) return alert(error.message);
  closeAll(); await refreshAll();
}

/* ---------------- AIRPORT AUTOCOMPLETE ---------------- */
// [iata, city, airportName, country, isPrimary]
const AIRPORTS=[['TLV','Tel Aviv','Ben Gurion International','Israel',1],['VDA','Eilat','Ramon International','Israel',1],['CMB','Colombo','Bandaranaike International','Sri Lanka',1],['GOI','Goa','Manohar International','India',1],['BOM','Mumbai','Chhatrapati Shivaji International','India',1],['DEL','Delhi','Indira Gandhi International','India',1],['BLR','Bangalore','Kempegowda International','India',1],['MAA','Chennai','Chennai International','India',1],['CCU','Kolkata','Netaji Subhas Chandra Bose International','India',1],['HYD','Hyderabad','Rajiv Gandhi International','India',1],['COK','Kochi','Cochin International','India',1],['HAN','Hanoi','Noi Bai International','Vietnam',1],['SGN','Ho Chi Minh City','Tan Son Nhat International','Vietnam',1],['DAD','Da Nang','Da Nang International','Vietnam',1],['BKK','Bangkok','Suvarnabhumi International','Thailand',1],['DMK','Bangkok','Don Mueang International','Thailand',0],['HKT','Phuket','Phuket International','Thailand',1],['CNX','Chiang Mai','Chiang Mai International','Thailand',1],['USM','Koh Samui','Samui Airport','Thailand',1],['DPS','Bali','Ngurah Rai International','Indonesia',1],['CGK','Jakarta','Soekarno-Hatta International','Indonesia',1],['KUL','Kuala Lumpur','KLIA','Malaysia',1],['LGK','Langkawi','Langkawi International','Malaysia',1],['SIN','Singapore','Changi International','Singapore',1],['MNL','Manila','Ninoy Aquino International','Philippines',1],['CEB','Cebu','Mactan-Cebu International','Philippines',1],['NRT','Tokyo','Narita International','Japan',1],['HND','Tokyo','Haneda International','Japan',0],['KIX','Osaka','Kansai International','Japan',1],['FUK','Fukuoka','Fukuoka Airport','Japan',1],['OKA','Okinawa','Naha Airport','Japan',1],['ICN','Seoul','Incheon International','South Korea',1],['GMP','Seoul','Gimpo International','South Korea',0],['PEK','Beijing','Capital International','China',1],['PVG','Shanghai','Pudong International','China',1],['SHA','Shanghai','Hongqiao International','China',0],['CAN','Guangzhou','Baiyun International','China',1],['TPE','Taipei','Taiwan Taoyuan International','Taiwan',1],['PNH','Phnom Penh','Phnom Penh International','Cambodia',1],['REP','Siem Reap','Siem Reap International','Cambodia',1],['KTM','Kathmandu','Tribhuvan International','Nepal',1],['MLE','Male','Velana International','Maldives',1],['DXB','Dubai','Dubai International','UAE',1],['AUH','Abu Dhabi','Zayed International','UAE',1],['SHJ','Sharjah','Sharjah International','UAE',1],['DOH','Doha','Hamad International','Qatar',1],['MCT','Muscat','Muscat International','Oman',1],['AMM','Amman','Queen Alia International','Jordan',1],['IST','Istanbul','Istanbul Airport','Turkey',1],['SAW','Istanbul','Sabiha Gokcen International','Turkey',0],['AYT','Antalya','Antalya Airport','Turkey',1],['CAI','Cairo','Cairo International','Egypt',1],['SSH','Sharm el-Sheikh','Sharm el-Sheikh International','Egypt',1],['HRG','Hurghada','Hurghada International','Egypt',1],['CMN','Casablanca','Mohammed V International','Morocco',1],['RAK','Marrakech','Menara Airport','Morocco',1],['ADD','Addis Ababa','Bole International','Ethiopia',1],['NBO','Nairobi','Jomo Kenyatta International','Kenya',1],['DAR','Dar es Salaam','Julius Nyerere International','Tanzania',1],['ZNZ','Zanzibar','Abeid Amani Karume International','Tanzania',1],['JNB','Johannesburg','OR Tambo International','South Africa',1],['CPT','Cape Town','Cape Town International','South Africa',1],['LHR','London','Heathrow Airport','UK',1],['LGW','London','Gatwick Airport','UK',0],['STN','London','Stansted Airport','UK',0],['MAN','Manchester','Manchester Airport','UK',1],['EDI','Edinburgh','Edinburgh Airport','UK',1],['CDG','Paris','Charles de Gaulle Airport','France',1],['ORY','Paris','Orly Airport','France',0],['NCE','Nice','Nice Côte d\'Azur Airport','France',1],['FRA','Frankfurt','Frankfurt Airport','Germany',1],['MUC','Munich','Munich Airport','Germany',1],['BER','Berlin','Berlin Brandenburg Airport','Germany',1],['MAD','Madrid','Adolfo Suárez Madrid-Barajas','Spain',1],['BCN','Barcelona','El Prat Airport','Spain',1],['AGP','Málaga','Costa del Sol Airport','Spain',1],['PMI','Palma de Mallorca','Son Sant Joan Airport','Spain',1],['IBZ','Ibiza','Ibiza Airport','Spain',1],['FCO','Rome','Fiumicino Airport','Italy',1],['MXP','Milan','Malpensa Airport','Italy',1],['VCE','Venice','Marco Polo Airport','Italy',1],['FLR','Florence','Peretola Airport','Italy',1],['NAP','Naples','Naples International','Italy',1],['ATH','Athens','Eleftherios Venizelos','Greece',1],['HER','Heraklion','Nikos Kazantzakis Airport','Greece',1],['RHO','Rhodes','Diagoras Airport','Greece',1],['CFU','Corfu','Ioannis Kapodistrias Airport','Greece',1],['JMK','Mykonos','Mykonos Airport','Greece',1],['LIS','Lisbon','Humberto Delgado Airport','Portugal',1],['OPO','Porto','Francisco de Sá Carneiro','Portugal',1],['FAO','Faro','Faro Airport','Portugal',1],['AMS','Amsterdam','Amsterdam Schiphol','Netherlands',1],['ZRH','Zurich','Zurich Airport','Switzerland',1],['GVA','Geneva','Geneva Airport','Switzerland',1],['VIE','Vienna','Vienna International','Austria',1],['SPU','Split','Split Airport','Croatia',1],['DBV','Dubrovnik','Dubrovnik Airport','Croatia',1],['PRG','Prague','Václav Havel Airport','Czech Republic',1],['BUD','Budapest','Ferenc Liszt Airport','Hungary',1],['WAW','Warsaw','Chopin Airport','Poland',1],['KEF','Reykjavik','Keflavik International','Iceland',1],['OSL','Oslo','Gardermoen Airport','Norway',1],['ARN','Stockholm','Arlanda Airport','Sweden',1],['CPH','Copenhagen','Copenhagen Airport','Denmark',1],['HEL','Helsinki','Helsinki Airport','Finland',1],['DUB','Dublin','Dublin Airport','Ireland',1],['BRU','Brussels','Brussels Airport','Belgium',1],['JFK','New York','John F. Kennedy International','USA',1],['EWR','New York','Newark Liberty International','USA',0],['LGA','New York','LaGuardia Airport','USA',0],['LAX','Los Angeles','Los Angeles International','USA',1],['ORD','Chicago','O\'Hare International','USA',1],['ATL','Atlanta','Hartsfield-Jackson International','USA',1],['DFW','Dallas','Dallas/Fort Worth International','USA',1],['SFO','San Francisco','San Francisco International','USA',1],['MIA','Miami','Miami International','USA',1],['LAS','Las Vegas','Harry Reid International','USA',1],['MCO','Orlando','Orlando International','USA',1],['YYZ','Toronto','Pearson International','Canada',1],['YVR','Vancouver','Vancouver International','Canada',1],['CUN','Cancún','Cancún International','Mexico',1],['MEX','Mexico City','Benito Juárez International','Mexico',1],['GRU','São Paulo','Guarulhos International','Brazil',1],['GIG','Rio de Janeiro','Galeão International','Brazil',1],['EZE','Buenos Aires','Ministro Pistarini International','Argentina',1],['BOG','Bogotá','El Dorado International','Colombia',1],['LIM','Lima','Jorge Chávez International','Peru',1],['SCL','Santiago','Arturo Merino Benítez International','Chile',1],['SYD','Sydney','Kingsford Smith Airport','Australia',1],['MEL','Melbourne','Tullamarine Airport','Australia',1],['BNE','Brisbane','Brisbane Airport','Australia',1],['AKL','Auckland','Auckland Airport','New Zealand',1],['SVO','Moscow','Sheremetyevo International','Russia',1],['TBS','Tbilisi','Tbilisi International','Georgia',1],['EVN','Yerevan','Zvartnots International','Armenia',1],['TAS','Tashkent','Tashkent International','Uzbekistan',1],['SEZ','Mahé','Seychelles International','Seychelles',1],['MRU','Mauritius','Sir Seewoosagur Ramgoolam International','Mauritius',1],['RGN','Yangon','Yangon International','Myanmar',1],['RUH','Riyadh','King Khalid International','Saudi Arabia',1],['JED','Jeddah','King Abdulaziz International','Saudi Arabia',1],['HAV','Havana','José Martí International','Cuba',1]];

function searchAirports(q, limit = 7) {
  const s = q.toLowerCase().trim();
  if (s.length < 2) return [];
  const scored = AIRPORTS.map(a => {
    const [iata, city, name, country, main] = a;
    const il = iata.toLowerCase(), cl = city.toLowerCase(), nl = name.toLowerCase();
    let score = 0;
    if (il === s) score = 100;
    else if (il.startsWith(s)) score = 80;
    else if (cl === s) score = 70;
    else if (cl.startsWith(s)) score = 55;
    else if (cl.includes(s)) score = 40;
    else if (nl.includes(s)) score = 20;
    else if (country.toLowerCase().includes(s)) score = 10;
    return score > 0 ? { a, score } : null;
  }).filter(Boolean);
  scored.sort((x, y) => y.score - x.score || y.a[4] - x.a[4]);
  return scored.slice(0, limit).map(x => x.a);
}

let _airDebounce = {};
function airportInput(inputId, dropId, hintId) {
  clearTimeout(_airDebounce[inputId]);
  _airDebounce[inputId] = setTimeout(() => {
    const q = document.getElementById(inputId)?.value || '';
    const results = searchAirports(q);
    const drop = document.getElementById(dropId);
    if (!results.length) { drop.classList.remove('open'); return; }
    drop.innerHTML = results.map(([iata, city, name, country, main]) =>
      `<div class="airport-opt${main ? ' primary' : ''}"
        onclick="pickAirport('${inputId}','${dropId}','${hintId}','${iata}','${esc(city)}','${esc(name)}','${esc(country)}')">
        <span class="airport-iata">${iata}</span>
        <span class="airport-info">${esc(name)} · ${esc(city)}, ${esc(country)}</span>
        ${main ? '<span class="airport-badge">main</span>' : ''}
      </div>`
    ).join('');
    drop.classList.add('open');
  }, 280);
}

function pickAirport(inputId, dropId, hintId, iata, city, name, country) {
  document.getElementById(inputId).value = iata;
  document.getElementById(dropId).classList.remove('open');
  document.getElementById(hintId).textContent = name + ' · ' + city + ', ' + country;
}

document.addEventListener('click', e => {
  document.querySelectorAll('.airport-dropdown.open').forEach(d => {
    if (!d.parentElement.contains(e.target)) d.classList.remove('open');
  });
});

/* ---------------- helpers ---------------- */
const FLAGS={vietnam:'🇻🇳',thailand:'🇹🇭',philippines:'🇵🇭',japan:'🇯🇵',italy:'🇮🇹',france:'🇫🇷',spain:'🇪🇸',greece:'🇬🇷',portugal:'🇵🇹',indonesia:'🇮🇩',india:'🇮🇳',turkey:'🇹🇷',mexico:'🇲🇽',israel:'🇮🇱',germany:'🇩🇪',morocco:'🇲🇦',cambodia:'🇰🇭',malaysia:'🇲🇾',singapore:'🇸🇬',croatia:'🇭🇷',australia:'🇦🇺','sri lanka':'🇱🇰',nepal:'🇳🇵',bali:'🇮🇩',egypt:'🇪🇬',jordan:'🇯🇴',kenya:'🇰🇪',tanzania:'🇹🇿',peru:'🇵🇪',colombia:'🇨🇴',argentina:'🇦🇷',brazil:'🇧🇷',chile:'🇨🇱',china:'🇨🇳','south korea':'🇰🇷',taiwan:'🇹🇼',myanmar:'🇲🇲',laos:'🇱🇦',maldives:'🇲🇻',seychelles:'🇸🇨',iceland:'🇮🇸',norway:'🇳🇴',sweden:'🇸🇪',netherlands:'🇳🇱',switzerland:'🇨🇭',austria:'🇦🇹',czechia:'🇨🇿',hungary:'🇭🇺',poland:'🇵🇱',ukraine:'🇺🇦',georgia:'🇬🇪',armenia:'🇦🇲',uzbekistan:'🇺🇿',vietnam:'🇻🇳',usa:'🇺🇸','united states':'🇺🇸',canada:'🇨🇦',uk:'🇬🇧','united kingdom':'🇬🇧',ireland:'🇮🇪',newzealand:'🇳🇿','new zealand':'🇳🇿',southafrica:'🇿🇦','south africa':'🇿🇦',ethiopia:'🇪🇹',cuba:'🇨🇺',iran:'🇮🇷',oman:'🇴🇲',uae:'🇦🇪','united arab emirates':'🇦🇪'};
function val(id){ return document.getElementById(id).value; }
function cap(s){ return (s||'').replace(/\b\w/g,c=>c.toUpperCase()).trim(); }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function showTab(t){
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+t));
}
function openOverlay(id){ document.getElementById(id).classList.add('show'); }
function openCapture(){
  document.getElementById('cap-place').value='';
  document.getElementById('cap-country').value='';
  document.getElementById('cap-url').value='';
  document.getElementById('cap-country-suggestions').innerHTML='';
  document.getElementById('cap-country-status').textContent='';
  capMsg('');
  openOverlay('ov-capture');
}
function capMsg(m){ document.getElementById('cap-msg').textContent=m; }
function closeAll(){ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); closePreview(); } });

/* ---------------- FLIGHT RESEARCH ---------------- */
function renderResearch() {
  const el = document.getElementById('researchList');
  if (!research.length) {
    el.innerHTML = '<div class="empty">Nothing saved yet. Add notes, screenshots or links about flights you\'re considering.</div>';
    return;
  }
  el.innerHTML = research.map(r => {
    const flights = r.extracted_flights;
    const imageBlock = flights?.length
      ? `<div class="ef-header" style="margin-top:0">✦ Extracted flights</div>` + flights.map((f, i) => renderExtractedFlightCard(f, r.id, i)).join('')
        + (r.image_url ? `<div style="margin-top:8px"><a class="research-link" href="${esc(r.image_url)}" target="_blank">↗ View original screenshot</a></div>` : '')
      : r.image_url ? `<img src="${esc(r.image_url)}" class="research-img" onclick="zoomResearchImage('${esc(r.image_url)}')">` : '';
    return `<div class="card research-card">
      <button class="del" onclick="delResearch('${r.id}')">×</button>
      ${imageBlock}
      ${r.content  ? `<div class="research-text">${esc(r.content)}</div>` : ''}
      ${r.link_url ? `<a href="${esc(r.link_url)}" target="_blank" class="research-link">↗ ${esc(r.link_label || r.link_url)}</a>` : ''}
      <div class="research-date">${new Date(r.created_at).toLocaleDateString()}</div>
    </div>`;
  }).join('');
}

function openResearch() {
  document.getElementById('r-content').value = '';
  document.getElementById('r-link-url').value = '';
  document.getElementById('r-link-label').value = '';
  document.getElementById('r-image-input').value = '';
  document.getElementById('r-image-preview').style.display = 'none';
  document.getElementById('r-extracted').innerHTML = '';
  document.getElementById('r-msg').textContent = '';
  _researchImageFile = null; _researchImageB64 = null; _researchExtracted = null;
  openOverlay('ov-research');
}

function onResearchImagePick(input) {
  const file = input.files[0];
  if (file) handleResearchImageFile(file);
}

function onResearchPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) handleResearchImageFile(file);
      break;
    }
  }
}

function handleResearchImageFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    document.getElementById('r-msg').textContent = 'Image too large (max 5 MB). Try a compressed screenshot.';
    return;
  }
  document.getElementById('r-msg').textContent = '';
  _researchImageFile = file;
  const preview = document.getElementById('r-image-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';

  const reader = new FileReader();
  reader.onload = e => {
    _researchImageB64 = e.target.result;
    analyzeFlightImage(_researchImageB64, file.type || 'image/png');
  };
  reader.readAsDataURL(file);
}

async function compressImage(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1280;
      const scale = Math.min(1, maxW / img.width);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = dataUrl;
  });
}

async function analyzeFlightImage(dataUrl, mimeType) {
  if (GUEST_MODE) return;
  _researchExtracted = null;
  const el = document.getElementById('r-extracted');
  el.innerHTML = '<div class="ef-header ef-analyzing">✦ Analyzing with AI…</div>';

  try {
    const compressed = await compressImage(dataUrl);
    const base64 = compressed.split(',')[1];
    const { data, error } = await sb.functions.invoke('extract-flight', {
      body: { imageBase64: base64, mediaType: 'image/jpeg' },
    });
    if (error) {
      el.innerHTML = `<div class="ef-header" style="color:#b4544a">Analysis failed: ${esc(error.message || JSON.stringify(error))}</div>`;
      return;
    }
    if (!data?.flights?.length) {
      el.innerHTML = '<div class="ef-header" style="color:var(--ink-soft)">No flights found in image — add notes manually.</div>';
      return;
    }
    _researchExtracted = data.flights;
    el.innerHTML = '<div class="ef-header">✦ Extracted flights</div>' +
      data.flights.map(renderExtractedFlightCard).join('');
  } catch (e) {
    el.innerHTML = `<div class="ef-header" style="color:#b4544a">Error: ${esc(String(e))}</div>`;
  }
}

function renderExtractedFlightCard(f, researchId = null, idx = null) {
  const stops = f.stops === 0 ? 'Non-stop'
    : `${f.stops} stop${f.stops > 1 ? 's' : ''}${f.stop_airports?.length ? ' via ' + f.stop_airports.join(', ') : ''}`;
  const delBtn = researchId !== null && idx !== null
    ? `<button class="ef-del" onclick="deleteExtractedFlight('${researchId}',${idx})">×</button>`
    : '';
  const addBtn = researchId !== null && idx !== null
    ? `<button class="ef-add-btn" onclick="addResearchFlightToTrip('${researchId}',${idx},this)">＋ Add to trip</button>`
    : '';
  return `<div class="ef-card" style="position:relative">
    ${delBtn}
    <div class="ef-route">${esc(f.from||'')} → ${esc(f.to||'')}${f.date ? ' · ' + esc(f.date) : ''}</div>
    <div class="ef-meta">
      <span>${esc(f.airline||'')}${f.codeshare ? ' · ' + esc(f.codeshare) : ''}</span>
      <span>${esc(f.departure_time||'')} → ${esc(f.arrival_time||'')}</span>
      <span>${esc(f.duration||'')}</span>
      <span>${stops}</span>
    </div>
    ${f.price_per_person ? `<div class="ef-price">${esc(f.price_per_person)} / person</div>` : ''}
    ${addBtn}
  </div>`;
}

async function addResearchFlightToTrip(researchId, idx, btn) {
  const item = research.find(r => r.id === researchId);
  const f = item?.extracted_flights?.[idx];
  if (!f) return;

  const noteParts = [
    f.duration   ? `${f.duration}` : '',
    f.stops === 0 ? 'Non-stop' : f.stops ? `${f.stops} stop(s)${f.stop_airports?.length ? ' via ' + f.stop_airports.join(', ') : ''}` : '',
    f.codeshare  || '',
    f.arrival_time ? `Arrives ${f.arrival_time}` : '',
  ].filter(Boolean);

  const row = {
    trip_id:    TRIP_ID,
    origin:     f.from        || '',
    destination:f.to          || '',
    airline:    f.airline     || '',
    flight_no:  null,
    depart_date:f.date        || '',
    depart_time:f.departure_time || '',
    price:      f.price_per_person || '',
    notes:      noteParts.join(' · ') || null,
  };

  if (GUEST_MODE) {
    lsInsert('flights', row);
    flights = lsGet('flights').filter(r => r.trip_id === TRIP_ID);
    renderFlights();
  } else {
    const { error } = await sb.from('flights').insert(row);
    if (error) { alert(error.message); return; }
    const { data } = await sb.from('flights').select('*').order('created_at');
    flights = data || [];
    renderFlights();
  }

  btn.textContent = '✓ Added to trip';
  btn.disabled = true;
}

async function deleteExtractedFlight(researchId, idx) {
  const item = research.find(r => r.id === researchId);
  if (!item?.extracted_flights) return;
  const updated = item.extracted_flights.filter((_, i) => i !== idx);
  if (GUEST_MODE) {
    lsUpdate('flight_research', researchId, { extracted_flights: updated });
    research = lsGet('flight_research').filter(r => r.trip_id === TRIP_ID)
      .sort((a,b) => b.created_at.localeCompare(a.created_at));
    renderResearch(); return;
  }
  await sb.from('flight_research').update({ extracted_flights: updated }).eq('id', researchId);
  item.extracted_flights = updated;
  renderResearch();
}

async function saveResearch() {
  const content   = document.getElementById('r-content').value.trim();
  const linkUrl   = document.getElementById('r-link-url').value.trim();
  const linkLabel = document.getElementById('r-link-label').value.trim();
  const rMsg = m => document.getElementById('r-msg').textContent = m;

  if (!content && !_researchImageFile && !linkUrl) return rMsg('Add some text, an image, or a link.');

  if (GUEST_MODE) {
    if (_researchImageFile && _researchImageB64) {
      if (_researchImageB64.length > 1.5 * 1024 * 1024)
        return rMsg('Image too large for guest mode. Add a link to the image instead, or sign in to upload.');
    }
    lsInsert('flight_research', {
      trip_id: TRIP_ID, content: content || null,
      image_url: _researchImageB64 || null, link_url: linkUrl || null, link_label: linkLabel || null,
    });
    closeAll(); research = lsGet('flight_research').filter(r => r.trip_id === TRIP_ID)
      .sort((a,b) => b.created_at.localeCompare(a.created_at));
    renderResearch(); return;
  }

  let imageUrl = null;
  if (_researchImageFile) {
    const path = `${TRIP_ID}/${Date.now()}-${_researchImageFile.name}`;
    const { error: upErr } = await sb.storage.from('research').upload(path, _researchImageFile);
    if (upErr) return rMsg('Image upload failed: ' + upErr.message);
    imageUrl = sb.storage.from('research').getPublicUrl(path).data.publicUrl;
  }

  const { error } = await sb.from('flight_research').insert({
    trip_id: TRIP_ID, content: content || null,
    image_url: imageUrl, extracted_flights: _researchExtracted || null,
    link_url: linkUrl || null, link_label: linkLabel || null,
  });
  if (error) return rMsg(error.message);
  closeAll(); await refreshAll();
}

async function delResearch(id) {
  if (GUEST_MODE) {
    lsDelete('flight_research', id);
    research = lsGet('flight_research').filter(r => r.trip_id === TRIP_ID)
      .sort((a,b) => b.created_at.localeCompare(a.created_at));
    renderResearch(); return;
  }
  const item = research.find(r => r.id === id);
  if (item?.image_url?.includes('/research/')) {
    const path = item.image_url.split('/research/').pop().split('?')[0];
    await sb.storage.from('research').remove([path]);
  }
  await sb.from('flight_research').delete().eq('id', id);
  await refreshAll();
}

function zoomResearchImage(url) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:200;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:10px;object-fit:contain';
  ov.appendChild(img);
  ov.onclick = () => document.body.removeChild(ov);
  document.body.appendChild(ov);
}

/* ---------------- TRIP PREVIEW (Mapbox globe animation) ---------------- */

function chainFlightsAsRoute(fs) {
  if (fs.length <= 1) return fs;

  const norm = s => (s || '').toLowerCase().trim();

  // Sort by date, empty dates go last so undated legs don't steal the start
  const byDate = [...fs].sort((a, b) => {
    const da = a.depart_date || '￿';
    const db = b.depart_date || '￿';
    return da.localeCompare(db);
  });

  // Find the leg whose origin is not the destination of any other leg
  const allDests = new Set(fs.map(f => norm(f.destination)));
  const starts   = byDate.filter(f => !allDests.has(norm(f.origin)));
  const seed     = starts.length ? starts[0] : byDate[0];

  const chain     = [seed];
  const remaining = byDate.filter(f => f !== seed);

  while (remaining.length) {
    const last = chain[chain.length - 1];
    const idx  = remaining.findIndex(f => norm(f.origin) === norm(last.destination));
    if (idx !== -1) {
      chain.push(remaining.splice(idx, 1)[0]);
    } else {
      // No direct connection — append the rest in date order
      chain.push(...remaining.splice(0));
    }
  }

  return chain;
}

async function previewTrip() {
  const sorted = chainFlightsAsRoute(
    flights.filter(f => f.origin && f.destination)
  );

  if (!sorted.length) {
    alert('Add some flights first — the preview animates your flight route.');
    return;
  }

  document.getElementById('ov-preview').classList.add('show');
  document.getElementById('preview-loading').style.display = 'flex';

  const { MAPBOX_TOKEN } = window.TRIPLANNER_CONFIG;
  mapboxgl.accessToken = MAPBOX_TOKEN;

  if (previewMapInstance) { previewMapInstance.remove(); previewMapInstance = null; }

  previewMapInstance = new mapboxgl.Map({
    container: 'preview-map',
    style: 'mapbox://styles/mapbox/satellite-v9',
    projection: 'globe',
    zoom: 1.5,
    center: [20, 20],
    interactive: true,
  });

  await new Promise(resolve => previewMapInstance.on('load', resolve));

  previewMapInstance.setFog({
    color: 'rgb(186, 210, 235)',
    'high-color': 'rgb(36, 92, 223)',
    'horizon-blend': 0.02,
    'space-color': 'rgb(11, 11, 25)',
    'star-intensity': 0.6,
  });

  previewMapInstance.addSource('arc-active', { type: 'geojson', data: geoLineEmpty() });
  previewMapInstance.addLayer({ id: 'arc-active', type: 'line', source: 'arc-active',
    paint: { 'line-color': '#c2924a', 'line-width': 2.5, 'line-opacity': 0.95 } });

  previewMapInstance.addSource('arc-done', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  previewMapInstance.addLayer({ id: 'arc-done', type: 'line', source: 'arc-done',
    paint: { 'line-color': '#c2924a', 'line-width': 1.5, 'line-opacity': 0.35 } });

  const dotEl = document.createElement('div');
  dotEl.className = 'preview-dot';
  const dotMarker = new mapboxgl.Marker({ element: dotEl, anchor: 'center' });

  document.getElementById('preview-loading').style.display = 'none';

  const doneFeatures = [];

  for (let i = 0; i < sorted.length; i++) {
    const flight = sorted[i];
    const [from, to] = await Promise.all([geocodePlace(flight.origin), geocodePlace(flight.destination)]);
    if (!from || !to) continue;

    const bounds = [
      [Math.min(from[0], to[0]) - 12, Math.min(from[1], to[1]) - 12],
      [Math.max(from[0], to[0]) + 12, Math.max(from[1], to[1]) + 12],
    ];
    previewMapInstance.fitBounds(bounds, { padding: 90, duration: 900, maxZoom: 5 });
    await sleep(1050);

    dotMarker.setLngLat(from).addTo(previewMapInstance);

    const arc = buildArc(from, to);
    await animateArc(arc, dotMarker);

    doneFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: arc } });
    previewMapInstance.getSource('arc-done').setData({ type: 'FeatureCollection', features: doneFeatures });
    previewMapInstance.getSource('arc-active').setData(geoLineEmpty());

    showPreviewCard(flight, i + 1, sorted.length);
    await sleep(1800);
    hidePreviewCard();
    await sleep(200);
  }

  dotMarker.remove();
  previewMapInstance.flyTo({ zoom: 1.6, center: [20, 20], duration: 1500 });
  await sleep(1600);
  showPreviewCard(null, sorted.length, sorted.length, true);
}

function closePreview() {
  document.getElementById('ov-preview').classList.remove('show');
  hidePreviewCard();
  if (previewMapInstance) { previewMapInstance.remove(); previewMapInstance = null; }
}

function buildArc(from, to, steps = 100) {
  // Always take the shorter path: adjust longitude delta to stay within ±180°
  let dLng = to[0] - from[0];
  if (dLng > 180)  dLng -= 360;
  if (dLng < -180) dLng += 360;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let lng = from[0] + dLng * t;
    if (lng > 180)  lng -= 360;
    if (lng < -180) lng += 360;
    pts.push([lng, from[1] + (to[1] - from[1]) * t]);
  }
  return pts;
}

function animateArc(arcPts, dotMarker) {
  return new Promise(resolve => {
    let step = 1;
    const id = setInterval(() => {
      if (!previewMapInstance) { clearInterval(id); resolve(); return; }
      previewMapInstance.getSource('arc-active').setData({
        type: 'Feature', geometry: { type: 'LineString', coordinates: arcPts.slice(0, step) }
      });
      dotMarker.setLngLat(arcPts[step - 1]);
      step++;
      if (step > arcPts.length) { clearInterval(id); resolve(); }
    }, 10);
  });
}

async function geocodePlace(q) {
  const ql = q.toLowerCase().trim();
  // 1. Match existing trip cities
  const found = cities.find(c => c.name.toLowerCase().includes(ql) || ql.includes(c.name.toLowerCase()));
  if (found?.lat && found?.lng) return [found.lng, found.lat];
  // 2. Match AIRPORTS list (IATA code or city name) — prevents wrong-country Nominatim matches
  const ap = AIRPORTS.find(a => a[0].toLowerCase() === ql || a[1].toLowerCase() === ql);
  if (ap) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
        + encodeURIComponent(ap[1] + ' ' + ap[3]));
      const j = await r.json();
      if (j[0]) return [+j[0].lon, +j[0].lat];
    } catch (e) {}
  }
  // 3. Nominatim fallback
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const j = await r.json();
    if (j[0]) return [+j[0].lon, +j[0].lat];
  } catch (e) {}
  return null;
}

function geoLineEmpty() { return { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showPreviewCard(flight, index, total, summary = false) {
  const card = document.getElementById('preview-card');
  if (summary) {
    card.innerHTML = `<div class="pc-label">${esc(String(total))} ${total === 1 ? 'flight' : 'flights'} · your full route ✈</div>`;
  } else {
    const month = flight.depart_date
      ? new Date(flight.depart_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : '';
    card.innerHTML = `
      <div class="pc-step">${index} of ${total}</div>
      <div class="pc-route">${esc(flight.origin)} → ${esc(flight.destination)}</div>
      ${flight.airline ? `<div class="pc-detail">${esc(flight.airline)}${flight.flight_no ? ' · ' + esc(flight.flight_no) : ''}</div>` : ''}
      ${month ? `<div class="pc-detail">✈ ${month}</div>` : ''}
      ${flight.price ? `<div class="pc-price">${esc(flight.price)}</div>` : ''}
    `;
  }
  card.classList.add('show');
}

function hidePreviewCard() {
  document.getElementById('preview-card').classList.remove('show');
}

init();
