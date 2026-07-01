/* app.js — TriPlan front-end logic */

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TRIPLAN_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let TRIP_ID = null;
let GUEST_MODE = false;
let _myUserId = null;
let _appReady = false;
let myTrips = [];
let countries = [];
let places = [];
let flights = [];
let hotels = [];
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
let _passwordRecoveryPending = window.location.hash.includes('type=recovery');
let _pendingInviteToken = new URLSearchParams(window.location.search).get('invite');

async function init() {
  if (localStorage.getItem('triplanner_guest_mode') === '1' && !_passwordRecoveryPending && !_pendingInviteToken) {
    enterAsGuest(false);
    return;
  }
  // Register listener BEFORE getSession so token refreshes are never missed
  sb.auth.onAuthStateChange((e, s) => {
    if (e === 'PASSWORD_RECOVERY') { _passwordRecoveryPending = true; showAuth(); openOverlay('ov-reset-pass'); return; }
    if (_passwordRecoveryPending) return;
    if (s) onLoggedIn(); else showAuth();
  });
  try {
    // getSession triggers a token refresh if the access token is expired;
    // onAuthStateChange will fire once the refresh completes
    const { data: { session } } = await sb.auth.getSession();
    if (_passwordRecoveryPending) { showAuth(); openOverlay('ov-reset-pass'); }
    else if (!session) showAuth(); // no session at all — show login
    // if session exists, onAuthStateChange already called onLoggedIn()
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
  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.title = 'Exit guest';
  logoutBtn.setAttribute('aria-label', 'Exit guest');
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
async function doForgotPassword() {
  const email = val('au-email').trim();
  if (!email) return authMsg('Enter your email above, then tap "Forgot password?" again.');
  authMsg('Sending reset link…');
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  authMsg(error ? error.message : 'Check your email for a password reset link.');
}
function rpMsg(m) { document.getElementById('rp-msg').textContent = m; }
async function doSetNewPassword() {
  const pw = val('rp-password'), pw2 = val('rp-confirm');
  if (!pw || pw.length < 6) return rpMsg('Password must be at least 6 characters.');
  if (pw !== pw2) return rpMsg('Passwords do not match.');
  rpMsg('Saving…');
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) return rpMsg(error.message);
  _passwordRecoveryPending = false;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  closeAll();
  await onLoggedIn();
}
function skipPasswordReset() {
  _passwordRecoveryPending = false;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  closeAll();
  onLoggedIn();
}
async function doLogout() {
  if (GUEST_MODE) {
    if (!confirm('Exit guest mode?')) return;
    GUEST_MODE = false;
    TRIP_ID = null;
    localStorage.removeItem('triplanner_guest_mode');
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.title = 'Sign out';
    logoutBtn.setAttribute('aria-label', 'Sign out');
    showAuth();
    return;
  }
  if (!confirm('Sign out?')) return;
  _appReady = false;
  await sb.auth.signOut();
}
function authMsg(m){ document.getElementById('au-msg').textContent = m; }
function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.querySelector('svg').innerHTML = show
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 12s4-8 11-8"/><path d="M1 12s1.67 3.33 4.5 5.5M17.5 17.5C19.5 15.5 23 12 23 12"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

async function onLoggedIn() {
  if (_appReady) return;
  _appReady = true;
  GUEST_MODE = false;
  document.getElementById('auth').style.display = 'none';
  const { data: { user: _u } } = await sb.auth.getUser();
  _myUserId = _u?.id || null;

  if (_pendingInviteToken) {
    const token = _pendingInviteToken;
    _pendingInviteToken = null;
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    const { data: tripId, error: joinError } = await sb.rpc('join_trip_by_token', { p_token: token });
    if (joinError) alert(joinError.message);
    else if (tripId) {
      const { data: trips } = await sb.from('trips').select('id, name').order('created_at', { ascending: true });
      myTrips = trips || [];
      const joined = myTrips.find(t => t.id === tripId) || { id: tripId, name: 'Shared trip' };
      await enterTrip(joined);
      return;
    }
  }

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
  await Promise.all([refreshAll(), loadPreferences(), loadLegOrder()]);
  loadUpdateCenter();
}

function renderTripCarousel() {
  const el = document.getElementById('trip-carousel');
  el.style.display = 'flex';
  if (GUEST_MODE) {
    el.innerHTML = `<button class="trip-chip add" onclick="doLogout()">＋ Sign in to create or join a trip</button>`;
    return;
  }
  el.innerHTML = myTrips.map(t =>
    `<button class="trip-chip${t.id === TRIP_ID ? ' active' : ''}" onclick="switchTrip('${t.id}')">
      ${esc(t.name)}<span class="trip-chip-x" onclick="event.stopPropagation();doLeaveTripById('${t.id}')">×</span>
    </button>`
  ).join('') + `<button class="trip-chip add" onclick="openTripsManager()">＋ New trip</button>`;
}

async function switchTrip(id) {
  const trip = myTrips.find(t => t.id === id);
  if (!trip || trip.id === TRIP_ID) return;
  await enterTrip(trip);
}

async function openTripsManager() {
  document.getElementById('mt-new-name').value = '';
  document.getElementById('mt-join-email').value = '';
  document.getElementById('mt-join-name').value = '';
  tripsModalMsg('');
  document.getElementById('mt-invite-section').style.display = GUEST_MODE ? 'none' : '';
  document.getElementById('mt-invite-link').value = GUEST_MODE ? '' : 'Loading…';
  openOverlay('ov-trips');
  if (GUEST_MODE) return;
  const { data } = await sb.from('trips').select('invite_token').eq('id', TRIP_ID).single();
  document.getElementById('mt-invite-link').value = data?.invite_token
    ? `${window.location.origin}${window.location.pathname}?invite=${data.invite_token}`
    : '';
}

async function doLeaveTrip() { await doLeaveTripById(TRIP_ID); }

async function doLeaveTripById(id) {
  const trip = myTrips.find(t => t.id === id);
  const name = trip?.name || 'this trip';
  if (!confirm(`Remove "${name}" from your account?\n\nIt will continue to exist for other contributors.`)) return;
  if (GUEST_MODE) {
    localStorage.removeItem('triplanner_guest_mode');
    localStorage.removeItem('triplanner_last_trip');
    window.location.reload();
    return;
  }
  const { error } = await sb.rpc('leave_trip', { p_trip_id: id });
  if (error) { alert(error.message); return; }
  myTrips = myTrips.filter(t => t.id !== id);
  closeAll();
  const next = myTrips.find(t => t.id !== id) || myTrips[0];
  if (next) await enterTrip(next);
  else showTripOnboarding();
}

async function shareTrip() {
  if (GUEST_MODE) { alert('Sign in to share a trip.'); return; }
  const { data } = await sb.from('trips').select('invite_token').eq('id', TRIP_ID).single();
  if (!data?.invite_token) return;
  const link = `${window.location.origin}${window.location.pathname}?invite=${data.invite_token}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Join my trip on TriPlan', url: link }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(link); }
  catch { prompt('Copy this invite link:', link); return; }
  const btn = document.getElementById('share-btn');
  const orig = btn.innerHTML;
  btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
}

async function copyInviteLink() {
  const el = document.getElementById('mt-invite-link');
  if (!el.value) return;
  try { await navigator.clipboard.writeText(el.value); }
  catch { el.select(); document.execCommand('copy'); }
  tripsModalMsg('Link copied!');
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
    const allCities    = lsGet('places');
    const allFlights   = lsGet('flights');
    const allHotels    = lsGet('hotels');
    const allExpenses  = lsGet('expenses');
    const allBudget    = lsGet('budget_settings');
    countries    = allCountries.filter(r => r.trip_id === TRIP_ID);
    places       = allCities.filter(r => r.trip_id === TRIP_ID);
    flights      = allFlights.filter(r => r.trip_id === TRIP_ID);
    hotels       = allHotels.filter(r => r.trip_id === TRIP_ID);
    expenses     = allExpenses.filter(r => r.trip_id === TRIP_ID)
                              .sort((a,b) => (b.spent_on||'').localeCompare(a.spent_on||''));
    budgetTarget = allBudget.find(r => r.trip_id === TRIP_ID) || null;
    research     = lsGet('flight_research').filter(r => r.trip_id === TRIP_ID)
                              .sort((a,b) => b.created_at.localeCompare(a.created_at));
    renderCountries(); renderFlights(); renderResearch(); renderBudget();
    return;
  }
  const [c, ci, f, h, ex, bs, res] = await Promise.all([
    sb.from('countries').select('*').eq('trip_id', TRIP_ID).order('created_at'),
    sb.from('places').select('*').eq('trip_id', TRIP_ID).order('created_at'),
    sb.from('flights').select('*').eq('trip_id', TRIP_ID).order('created_at'),
    sb.from('hotels').select('*').eq('trip_id', TRIP_ID).order('created_at'),
    sb.from('expenses').select('*').eq('trip_id', TRIP_ID).order('spent_on', { ascending: false }),
    sb.from('budget_settings').select('*').eq('trip_id', TRIP_ID).maybeSingle(),
    sb.from('flight_research').select('*').eq('trip_id', TRIP_ID).order('created_at', { ascending: false }),
  ]);
  countries = c.data || []; places = ci.data || []; flights = f.data || []; hotels = h.data || [];
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
  logActivity('added_country', name, 'country', data.id);
  return data;
}

async function ensurePlace(cityName, countryId) {
  const found = places.find(p => p.name.toLowerCase() === cityName.toLowerCase() && p.country_id === countryId);
  if (found) return found;
  const country = countries.find(c => c.id === countryId);
  const geo = await geocode(cityName + (country ? ', ' + country.name : ''));
  const row = { trip_id: TRIP_ID, country_id: countryId, name: cap(cityName), lat: geo.lat, lng: geo.lng, source_url: null };
  if (GUEST_MODE) {
    const newPlace = lsInsert('places', row);
    places.push(newPlace);
    return newPlace;
  }
  const { data, error } = await sb.from('places').insert(row).select().single();
  if (error) return null;
  places.push(data);
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
let _urlDebounce   = null;
let _capType       = 'place'; // 'place' | 'hotel' | 'flight'
let _smartImageFile = null;
let _smartImageB64  = null;
let _smartImageType = null;
let _smartParseResult = null;
let _smartDestination = null;

const HOTEL_URL_PATTERNS  = ['booking.com/hotel','airbnb.com/room','airbnb.com/h/','hotels.com','hostelworld.com','agoda.com/','trivago.com','marriott.com','hilton.com','hyatt.com','ihg.com','radisson.com','accorhotels.com'];
const FLIGHT_URL_PATTERNS = ['skyscanner.','kayak.com/flight','google.com/travel/flights','expedia.com/flight','momondo.','kiwi.com','flightaware.','ryanair.com','easyjet.com','wizzair.','airasia.com/flight'];

function detectUrlType(url) {
  const u = url.toLowerCase();
  if (FLIGHT_URL_PATTERNS.some(p => u.includes(p))) return 'flight';
  if (HOTEL_URL_PATTERNS.some(p => u.includes(p))) return 'hotel';
  return 'place';
}

function setCaptureMode(type) {
  _capType = type;
  const title = document.getElementById('cap-title');
  const label = document.getElementById('cap-place-label');
  const cityRow = document.getElementById('cap-city-row');
  const hint = document.getElementById('cap-type-hint');
  if (type === 'hotel') {
    title.textContent = 'Add hotel';
    label.textContent = 'Hotel name';
    cityRow.style.display = '';
    hint.textContent = '🏨 Hotel link — will save to your hotels';
    hint.style.display = 'block';
  } else if (type === 'flight') {
    title.textContent = 'Capture a place';
    label.textContent = 'Place';
    cityRow.style.display = 'none';
    hint.textContent = '✈ Flight link — tap "File it" to open the flights form';
    hint.style.display = 'block';
  } else {
    title.textContent = 'Capture a place';
    label.textContent = 'Place';
    cityRow.style.display = 'none';
    hint.style.display = 'none';
  }
}

function onUrlInput() {
  clearTimeout(_urlDebounce);
  const url = document.getElementById('cap-url').value.trim();
  if (!url.startsWith('http')) { setCaptureMode('place'); return; }
  const detected = detectUrlType(url);
  setCaptureMode(detected);
  if (detected === 'flight') return; // no parse needed for flights
  if (document.getElementById('cap-place').value.trim()) return;
  document.getElementById('cap-url-status').textContent = 'extracting…';
  _urlDebounce = setTimeout(() => parseLink(url), 800);
}

async function parseLink(url) {
  const statusEl = document.getElementById('cap-url-status');
  if (GUEST_MODE) { statusEl.textContent = ''; return; }
  try {
    const { data, error } = await sb.functions.invoke('parse-link', { body: { url } });
    if (error) { statusEl.textContent = '⚠ type manually'; return; }

    const { name, place, country, type } = data || {};

    // Upgrade to hotel mode if parse-link detected a hotel listing
    if (type === 'hotel' && _capType !== 'hotel') setCaptureMode('hotel');

    if (!name && !place && !country) {
      statusEl.textContent = '⚠ type below';
      document.getElementById('cap-place').focus();
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
      return;
    }

    if (_capType === 'hotel') {
      if (name && !document.getElementById('cap-place').value.trim())
        document.getElementById('cap-place').value = name;
      if (place && !document.getElementById('cap-city').value.trim())
        document.getElementById('cap-city').value = place;
    } else {
      if (place && !document.getElementById('cap-place').value.trim())
        document.getElementById('cap-place').value = place;
    }
    if (country && !document.getElementById('cap-country').value.trim()) {
      document.getElementById('cap-country').value = country;
      document.getElementById('cap-country-suggestions').innerHTML = '';
    }
    statusEl.textContent = '✓ extracted';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  } catch (e) {
    statusEl.textContent = '⚠ type manually';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }
}

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
    document.getElementById('cap-country-suggestions').innerHTML = '';
    const drop = document.getElementById('cap-place-drop');
    if (!results.length) { drop.classList.remove('open'); return; }

    // Show suggestions in dropdown on the place input
    drop.innerHTML = results.slice(0, 5).map(res => {
      const name    = res.name || res.display_name.split(',')[0];
      const country = res.address?.country || '';
      const state   = res.address?.state || res.address?.county || '';
      const sub     = [state, country].filter(Boolean).join(', ');
      return `<div class="airport-opt" onclick="pickCapPlace('${esc(name)}','${esc(country)}')">
        <span class="airport-iata">${FLAGS[country.toLowerCase()]||'🌍'}</span>
        <span class="airport-info">${esc(name)}${sub ? ' · '+esc(sub) : ''}</span>
      </div>`;
    }).join('');
    drop.classList.add('open');

    // Auto-fill country if unambiguous
    const seen = new Set();
    const countryList = results.map(r => r.address?.country).filter(c => c && !seen.has(c) && seen.add(c));
    if (countryList.length === 1 && !document.getElementById('cap-country').value.trim())
      document.getElementById('cap-country').value = countryList[0];
  } catch (e) {
    document.getElementById('cap-country-status').textContent = '';
  }
}

function pickCapPlace(name, country) {
  document.getElementById('cap-place').value = name;
  if (country) document.getElementById('cap-country').value = country;
  document.getElementById('cap-place-drop').classList.remove('open');
  document.getElementById('cap-country-suggestions').innerHTML = '';
  document.getElementById('cap-country-status').textContent = '';
}

function pickPlace(name, country) {
  document.getElementById('cap-place').value = name;
  if (country) document.getElementById('cap-country').value = country;
  document.getElementById('cap-country-suggestions').innerHTML = '';
}

function pickCountry(name) {
  document.getElementById('cap-country').value = name;
  document.getElementById('cap-country-suggestions').innerHTML = '';
}

async function runCapture() {
  const url = val('cap-url').trim();

  // Flight → open flight form
  if (_capType === 'flight') {
    closeAll();
    openFlight();
    if (url) document.getElementById('f-notes').value = url;
    return;
  }

  // Hotel → save to hotels section
  if (_capType === 'hotel') {
    // If name isn't filled yet (user tapped "File it" before extraction finished), run it now
    if (!document.getElementById('cap-place').value.trim() && url && !GUEST_MODE) {
      clearTimeout(_urlDebounce);
      capMsg('Extracting hotel info…');
      await parseLink(url);
    }
    const hotelName   = document.getElementById('cap-place').value.trim();
    const cityInput   = document.getElementById('cap-city').value.trim();
    const countryName = document.getElementById('cap-country').value.trim();
    const effectiveCountry = countryName || cityInput;
    if (!effectiveCountry) return capMsg('Enter the country or city.');
    capMsg('Saving hotel…');
    const country = await ensureCountry(cap(effectiveCountry), FLAGS[effectiveCountry.toLowerCase()] || '🌍');
    if (!country) return;
    let place = null;
    if (cityInput) place = await ensurePlace(cityInput, country.id);
    const row = { trip_id: TRIP_ID, country_id: country.id, place_id: place?.id || null,
      name: cap(hotelName) || 'Untitled hotel', link: url || null, booked: false };
    if (GUEST_MODE) { lsInsert('hotels', row); }
    else {
      const { error } = await sb.from('hotels').insert(row);
      if (error) return capMsg(error.message);
    }
    closeAll(); await refreshAll();
    return;
  }

  // Place / country
  const cityName    = document.getElementById('cap-place').value.trim();
  const countryName = document.getElementById('cap-country').value.trim();
  if (!cityName && !countryName) return capMsg('Enter a place or country name.');

  const isCountryOnly = !cityName || (countryName && cityName.toLowerCase() === countryName.toLowerCase());
  const effectiveCountry = countryName || cityName;

  capMsg('Filing…');
  const country = await ensureCountry(cap(effectiveCountry), FLAGS[effectiveCountry.toLowerCase()] || '🌍');
  if (!country) return;

  if (isCountryOnly) { closeAll(); await refreshAll(); return; }

  capMsg('Looking up location…');
  const geo = await geocode(cityName + ', ' + countryName);

  if (GUEST_MODE) {
    lsInsert('places', {
      trip_id: TRIP_ID, country_id: country.id, name: cap(cityName),
      lat: geo.lat, lng: geo.lng, source_url: url || null,
    });
    closeAll(); await refreshAll();
    return;
  }

  const { data, error } = await sb.from('places').insert({
    trip_id: TRIP_ID, country_id: country.id, name: cap(cityName),
    lat: geo.lat, lng: geo.lng, source_url: url || null,
  }).select().single();
  if (error) return capMsg(error.message);
  closeAll(); await refreshAll();
  logActivity('added_place', cap(cityName) + ', ' + cap(countryName), 'place', data.id);
}

/* ---------------- RENDER: COUNTRIES ---------------- */
function renderCountries() {
  const el = document.getElementById('countryList');
  if (!countries.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">No countries yet. '
      + 'Use "Capture" with something like "Hoi An, Vietnam".</div>';
  } else {
    el.innerHTML = countries.map(c => {
      const n = places.filter(ci => ci.country_id === c.id).length;
      const daysLabel = c.planned_days ? ` · ${c.planned_days} days` : '';
      return `<div class="card country-card" onclick="openCountry('${c.id}')">
        <div class="country-card-top">
          <span class="country-flag">${esc(c.flag) || '🌍'}</span>
          <h3>${esc(c.name)}</h3>
        </div>
        <div class="when">${n} ${n === 1 ? 'place' : 'places'}${daysLabel}</div>
      </div>`;
    }).join('');
  }
}

/* ---------------- TRAVEL PREFERENCES ---------------- */
let tripPreferences = { likes: [], dislikes: [], notes: '', nationality: '' };

const PREF_LIKE_SUGGESTIONS = ['Nature & outdoors','Beaches','Mountains','Scenic views','National parks',
  'Luxury hotels','Local food','Kid-friendly','Adventure','Quiet places','Boutique stays','Swimming'];
const PREF_DISLIKE_SUGGESTIONS = ['Crowded cities','Tourist traps','Long drives','Party scene',
  'Museums','Very hot weather','Cold weather','Busy markets'];

function renderPrefChips() {
  const likesEl   = document.getElementById('pref-likes');
  const dislikesEl = document.getElementById('pref-dislikes');
  if (!likesEl) return;

  likesEl.innerHTML = tripPreferences.likes.map((t, i) =>
    `<span class="pref-chip like">${esc(t)}<button onclick="removePref('like',${i})">×</button></span>`
  ).join('');
  dislikesEl.innerHTML = tripPreferences.dislikes.map((t, i) =>
    `<span class="pref-chip dislike">${esc(t)}<button onclick="removePref('dislike',${i})">×</button></span>`
  ).join('');

  // Suggestions (hide ones already added)
  const likeSugg    = PREF_LIKE_SUGGESTIONS.filter(s => !tripPreferences.likes.includes(s));
  const dislikeSugg = PREF_DISLIKE_SUGGESTIONS.filter(s => !tripPreferences.dislikes.includes(s));

  document.getElementById('pref-like-sugg').innerHTML =
    likeSugg.map(s => `<button class="pref-sugg" onclick="quickAddPref('like','${esc(s)}')">${esc(s)}</button>`).join('');
  document.getElementById('pref-dislike-sugg').innerHTML =
    dislikeSugg.map(s => `<button class="pref-sugg" onclick="quickAddPref('dislike','${esc(s)}')">${esc(s)}</button>`).join('');

  document.getElementById('pref-notes').value = tripPreferences.notes || '';
  document.getElementById('pref-nationality').value = tripPreferences.nationality || '';
}

function addPref(type) {
  const inputId = type === 'like' ? 'pref-like-input' : 'pref-dislike-input';
  const text = document.getElementById(inputId).value.trim();
  if (!text) return;
  document.getElementById(inputId).value = '';
  tripPreferences[type === 'like' ? 'likes' : 'dislikes'].push(text);
  renderPrefChips();
  savePreferences();
}

function quickAddPref(type, text) {
  tripPreferences[type === 'like' ? 'likes' : 'dislikes'].push(text);
  renderPrefChips();
  savePreferences();
}

function removePref(type, idx) {
  const key = type === 'like' ? 'likes' : 'dislikes';
  tripPreferences[key].splice(idx, 1);
  renderPrefChips();
  savePreferences();
}

function savePrefNotes() {
  tripPreferences.notes = document.getElementById('pref-notes').value;
  savePreferences();
}

function savePrefNationality() {
  tripPreferences.nationality = document.getElementById('pref-nationality').value;
  savePreferences();
}

async function savePreferences() {
  if (GUEST_MODE) { lsUpdate('trips_prefs', TRIP_ID, tripPreferences); return; }
  await sb.from('trips').update({ preferences: tripPreferences }).eq('id', TRIP_ID);
}

async function loadPreferences() {
  if (!TRIP_ID) return;
  if (GUEST_MODE) {
    const stored = lsGet('trips_prefs').find(r => r.id === TRIP_ID);
    tripPreferences = { likes: [], dislikes: [], notes: '', nationality: '', ...(stored || {}) };
    return;
  }
  const { data } = await sb.from('trips').select('preferences').eq('id', TRIP_ID).single();
  tripPreferences = { likes: [], dislikes: [], notes: '', nationality: '', ...(data?.preferences || {}) };
}

async function suggestItinerary() {
  openOverlay('ov-plan');
  await loadPreferences();
  renderPrefChips();
  document.getElementById('plan-ai-out').style.display = 'none';
}

async function generatePlan() {
  const out = document.getElementById('plan-ai-out');
  out.style.display = 'block';
  out.innerHTML = '<em style="color:var(--ink-soft)">Asking Claude…</em>';

  const placesData = countries.map(c => ({
    name: c.name, planned_days: c.planned_days || null,
    places: places.filter(ci => ci.country_id === c.id)
      .map(ci => ({ name: ci.name, planned_days: ci.planned_days || null })),
  }));
  const flightsData = flights.map(f => ({
    from: f.origin, to: f.destination, date: f.depart_date,
    airline: f.airline, price: f.price,
  }));

  const wantsVisaInfo = countries.length > 0 && !!tripPreferences.nationality?.trim();

  try {
    const [planResult, visaResult] = await Promise.all([
      sb.functions.invoke('plan-trip', {
        body: { places: placesData, flights: flightsData, preferences: tripPreferences },
      }),
      wantsVisaInfo
        ? sb.functions.invoke('visa-info', {
            body: { countries: countries.map(c => c.name), nationality: tripPreferences.nationality },
          })
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (planResult.error) { out.textContent = planResult.error.message || JSON.stringify(planResult.error); return; }
    const data = planResult.data;

    // Render narrative
    out.innerHTML = `<div style="white-space:pre-wrap;line-height:1.6">${esc(data.suggestion || '')}</div>`;

    // Render actionable suggestions
    const suggestions = data.actionable || [];
    if (suggestions.length) {
      out.innerHTML += `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
        <div style="font-family:'Fraunces',serif;font-weight:600;font-size:14px;margin-bottom:10px;color:var(--ink-soft)">Worth adding</div>
        ${suggestions.map((s, i) => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="flex:1">
              <span style="font-family:'Fraunces',serif;font-weight:600;font-size:16px">${esc(s.name)}</span>
              ${s.days ? `<span style="color:var(--ink-soft);font-size:13px;margin-left:8px">~${s.days} days</span>` : ''}
              <div style="color:var(--ink-soft);font-size:13px;margin-top:2px">${esc(s.reason || '')}</div>
            </div>
            <button id="sugg-btn-${i}" class="btn small" onclick="addSuggestedCountry('${esc(s.name)}',${s.days||0},${i})">✓ Add</button>
          </div>`).join('')}
      </div>`;
    }

    // Render visa & bureaucracy section
    out.innerHTML += `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <div style="font-family:'Fraunces',serif;font-weight:600;font-size:14px;margin-bottom:10px;color:var(--ink-soft)">Visa & bureaucracy</div>
      ${renderVisaSection(wantsVisaInfo, visaResult)}
    </div>`;
  } catch (e) {
    out.textContent = 'Error: ' + String(e);
  }
}

function renderVisaSection(wantsVisaInfo, visaResult) {
  if (!wantsVisaInfo) {
    return `<div style="color:var(--ink-soft);font-size:14px">Add your nationality in preferences above to get visa requirements for each country.</div>`;
  }
  if (visaResult?.error) {
    return `<div style="color:var(--ink-soft);font-size:14px">Couldn't look up visa info: ${esc(visaResult.error.message || String(visaResult.error))}</div>`;
  }
  const visas = visaResult?.data?.visas || [];
  if (!visas.length) {
    return `<div style="color:var(--ink-soft);font-size:14px">No visa information found.</div>`;
  }
  return visas.map(v => `
    <div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div style="font-family:'Fraunces',serif;font-weight:600;font-size:15px">
        ${esc(v.country)}
        ${v.max_stay ? `<span style="color:var(--ink-soft);font-weight:400;font-size:13px"> · ${esc(v.max_stay)}</span>` : ''}
      </div>
      <div style="font-size:14px;margin-top:2px">${esc(v.summary || '')}</div>
    </div>`).join('') +
    `<div style="color:var(--ink-soft);font-size:12px;font-style:italic;margin-top:8px">Always confirm with the official embassy/immigration site before booking — rules change.</div>`;
}

async function addSuggestedCountry(name, days, btnIdx) {
  const country = await ensureCountry(cap(name), FLAGS[name.toLowerCase()] || '🌍');
  if (country && days) {
    country.planned_days = days;
    if (!GUEST_MODE) await sb.from('countries').update({ planned_days: days }).eq('id', country.id);
    else lsUpdate('countries', country.id, { planned_days: days });
  }
  await refreshAll();
  const btn = document.getElementById('sugg-btn-' + btnIdx);
  if (btn) { btn.textContent = '✓ Added'; btn.disabled = true; btn.classList.add('ghost'); }
}

/* ---------------- COUNTRY + CITY DETAIL ---------------- */
function openCountry(id) {
  const c = countries.find(x => x.id === id); if (!c) return;
  const pts = places.filter(ci => ci.country_id === id);
  const hts = hotels.filter(h => h.country_id === id);
  const placeTotal = pts.reduce((s, p) => s + (p.planned_days || 0), 0);
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

    ${pts.map(p => `
      <div class="place-item" data-id="${p.id}">
        <span class="place-item-name" onclick="openCity('${p.id}')">📍 ${esc(p.name)}</span>
        <input type="number" min="0.5" max="365" step="0.5"
          value="${p.planned_days || ''}" placeholder="days"
          class="place-days-input"
          onchange="savePlaceTime('${p.id}','${c.id}',this.value)">
        <span class="place-days-unit">days</span>
        <button class="del" style="position:static;opacity:.35;font-size:17px;margin-left:2px"
          onclick="deletePlace('${p.id}','${c.id}')">×</button>
      </div>`).join('')}
    ${!pts.length ? '<div class="empty" style="margin:8px 0 12px">No places yet — add some below.</div>' : ''}

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
    </div>

    <div class="places-header" style="margin-top:24px">Hotels</div>

    ${hts.map(h => `
      <div class="place-item" data-id="${h.id}">
        <span class="place-item-name" onclick="openHotel('${h.id}')" style="flex:2">${esc(h.name)}</span>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" ${h.booked ? 'checked' : ''} onchange="toggleHotelBooked('${h.id}')">
          <span style="font-size:13px;color:var(--ink-soft)">Booked</span>
        </label>
        ${h.price ? `<span class="pill">${esc(h.price)}</span>` : ''}
        ${h.link ? `<a href="${esc(h.link)}" target="_blank" style="text-decoration:none;font-size:15px">🔗</a>` : ''}
        <button class="del" style="position:static;opacity:.35;font-size:17px;margin-left:2px"
          onclick="deleteHotel('${h.id}','${c.id}')">×</button>
      </div>`).join('')}
    ${!hts.length ? '<div class="empty" style="margin:8px 0 12px">No hotels yet — add some below.</div>' : ''}

    <div class="add-place-row">
      <button class="btn small" onclick="openAddHotel('${c.id}')">＋ Add hotel</button>
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
  const place = places.find(c => c.id === placeId);
  if (!place) return;
  place.planned_days = days;
  if (GUEST_MODE) { lsUpdate('places', placeId, { planned_days: days }); }
  else await sb.from('places').update({ planned_days: days }).eq('id', placeId);
  openCountry(countryId);
}

async function addPlaceToCountry(countryId) {
  const input = document.getElementById('new-place-' + countryId);
  const name = input?.value.trim();
  if (!name) return;
  const country = countries.find(c => c.id === countryId);
  const geo = await geocode(name + (country ? ', ' + country.name : ''));
  if (GUEST_MODE) {
    const newPlace = lsInsert('places', { trip_id: TRIP_ID, country_id: countryId, name: cap(name), lat: geo.lat, lng: geo.lng });
    places.push(newPlace);
  } else {
    const { data, error } = await sb.from('places')
      .insert({ trip_id: TRIP_ID, country_id: countryId, name: cap(name), lat: geo.lat, lng: geo.lng })
      .select().single();
    if (error) { alert(error.message); return; }
    places.push(data);
  }
  openCountry(countryId);
}

async function deletePlace(placeId, countryId) {
  places = places.filter(c => c.id !== placeId);
  if (GUEST_MODE) { lsDelete('places', placeId); }
  else await sb.from('places').delete().eq('id', placeId);
  openCountry(countryId);
}

async function savePlaceNotes(placeId, notes) {
  const place = places.find(p => p.id === placeId);
  if (!place) return;
  place.notes = notes;
  if (GUEST_MODE) { lsUpdate('places', placeId, { notes }); return; }
  await sb.from('places').update({ notes }).eq('id', placeId);
}

async function openCity(id) {
  const c = places.find(x => x.id === id); if (!c) return;
  const country = countries.find(co => co.id === c.country_id);
  document.getElementById('detailTitle').textContent = '📍 ' + c.name;
  const body = document.getElementById('detailBody');
  const cityHotels = hotels.filter(h => h.place_id === id);
  body.innerHTML = `
    <div id="wx" class="wx">Loading weather…</div>
    ${c.source_url ? `<a class="srclink" href="${esc(c.source_url)}" target="_blank">↗ open saved link</a>` : ''}
    <div style="margin:12px 0">
      <textarea id="place-notes-input" rows="2"
        placeholder="Add notes — what it is, why you want to go, tips…"
        style="font-family:'Newsreader',serif;font-size:15px;resize:vertical"
        onchange="savePlaceNotes('${c.id}', this.value)">${c.notes ? esc(c.notes) : ''}</textarea>
    </div>
    <div class="ai-block">
      <div class="ai-head">
        <span>What to do here</span>
        <button class="btn small" onclick="investigate('${c.id}')">✦ Investigate with AI</button>
      </div>
      <div id="ai-out" class="ai-out">${c.ai_notes ? esc(c.ai_notes) : 'Tap "Investigate with AI" for a kid-friendly briefing.'}</div>
    </div>
    <div class="places-header" style="margin-top:24px">Hotels</div>
    ${cityHotels.map(h => `
      <div class="place-item" data-id="${h.id}">
        <span class="place-item-name" onclick="openHotel('${h.id}')" style="flex:2">${esc(h.name)}</span>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" ${h.booked ? 'checked' : ''} onchange="toggleHotelBooked('${h.id}')">
          <span style="font-size:13px;color:var(--ink-soft)">Booked</span>
        </label>
        ${h.price ? `<span class="pill">${esc(h.price)}</span>` : ''}
        ${h.link ? `<a href="${esc(h.link)}" target="_blank" style="text-decoration:none;font-size:15px">🔗</a>` : ''}
        <button class="del" style="position:static;opacity:.35;font-size:17px;margin-left:2px"
          onclick="deleteHotel('${h.id}','${c.country_id}')">×</button>
      </div>`).join('')}
    ${!cityHotels.length ? '<div class="empty" style="margin:8px 0 12px">No hotels yet.</div>' : ''}
    <div class="add-place-row">
      <button class="btn small" onclick="openAddHotel('${c.country_id}','${c.id}')">＋ Add hotel</button>
    </div>`;
  openOverlay('ov-detail');
  if (c.lat && c.lng) loadWeather(c.lat, c.lng);
  else document.getElementById('wx').textContent = 'No coordinates saved for weather.';
}

/* ---------------- HOTELS ---------------- */
let _editingHotelId = null;
let _hotelCountryId = null;
let _hotelPlaceId   = null;

function openAddHotel(countryId, placeId = null) {
  _editingHotelId = null;
  _hotelCountryId = countryId;
  _hotelPlaceId   = placeId;
  document.getElementById('hotel-modal-title').textContent = 'Add hotel';
  document.getElementById('h-save-btn').textContent = 'Save hotel';
  ['name','link','price','notes'].forEach(k => document.getElementById('h-'+k).value = '');
  openOverlay('ov-hotel');
}

function openHotel(id) {
  const h = hotels.find(x => x.id === id); if (!h) return;
  _editingHotelId = id;
  _hotelCountryId = h.country_id;
  document.getElementById('hotel-modal-title').textContent = 'Edit hotel';
  document.getElementById('h-save-btn').textContent = 'Update hotel';
  document.getElementById('h-name').value = h.name || '';
  document.getElementById('h-link').value = h.link || '';
  document.getElementById('h-price').value = h.price || '';
  document.getElementById('h-notes').value = h.notes || '';
  openOverlay('ov-hotel');
}

async function saveHotel() {
  let name = val('h-name').trim();
  const link = val('h-link').trim() || null;
  if (!name) {
    if (!link) { alert('Enter a hotel name or a link.'); return; }
    name = 'Untitled hotel';
  }
  const countryId = _hotelCountryId;
  const fields = {
    name,
    link,
    price: val('h-price').trim() || null,
    notes: val('h-notes').trim() || null,
  };

  if (_editingHotelId) {
    const h = hotels.find(x => x.id === _editingHotelId);
    if (h) Object.assign(h, fields);
    if (GUEST_MODE) { lsUpdate('hotels', _editingHotelId, fields); }
    else { await sb.from('hotels').update(fields).eq('id', _editingHotelId); }
  } else {
    const row = { ...fields, trip_id: TRIP_ID, country_id: countryId, place_id: _hotelPlaceId || null };
    if (GUEST_MODE) {
      hotels.push(lsInsert('hotels', row));
    } else {
      const { data, error } = await sb.from('hotels').insert(row).select().single();
      if (error) { alert(error.message); return; }
      hotels.push(data);
    }
  }
  _editingHotelId = null;
  const placeId = _hotelPlaceId;
  _hotelPlaceId = null;
  closeAll();
  if (placeId) openCity(placeId);
  else openCountry(countryId);
}

async function deleteHotel(id, countryId) {
  hotels = hotels.filter(h => h.id !== id);
  if (GUEST_MODE) { lsDelete('hotels', id); }
  else await sb.from('hotels').delete().eq('id', id);
  openCountry(countryId);
}

async function toggleHotelBooked(id) {
  const h = hotels.find(x => x.id === id); if (!h) return;
  h.booked = !h.booked;
  if (GUEST_MODE) { lsUpdate('hotels', id, { booked: h.booked }); }
  else { await sb.from('hotels').update({ booked: h.booked }).eq('id', id); }
  openCountry(h.country_id);
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
  const c = places.find(x => x.id === cityId);
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
    await sb.from('places').update({ ai_notes: data.text }).eq('id', cityId);
    c.ai_notes = data.text;
  } catch (e) {
    out.textContent = 'AI not reachable yet. Make sure the "investigate" function is '
      + 'deployed and ANTHROPIC_API_KEY is set.';
  }
}

/* ---------------- FLIGHTS ---------------- */
let legOrder = []; // ordered array of leg keys like ["TLV-BKK","BKK-SYD"]
let _editingFlightId = null;

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
        <span class="drag-handle" draggable="true" data-key="${esc(leg.key)}" title="Drag to reorder">⠿</span>
      </div>
      <div class="leg-flights">
        ${leg.flights.map(f => renderFlightCard(f)).join('')}
      </div>
    </div>
  `).join('');
  initLegDrag();
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
    saveLegOrder(allKeys);
    renderFlights();
  });

  el.addEventListener('dragend', () => cleanupLegDrag(el));
}

function cleanupLegDrag(el) {
  _dragKey = null;
  el.querySelectorAll('.leg-group').forEach(g => g.classList.remove('dragging', 'drag-over'));
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

async function delFlight(id){
  if (GUEST_MODE) { lsDelete('flights', id); await refreshAll(); return; }
  await sb.from('flights').delete().eq('id', id); await refreshAll();
}

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

/* ---------------- BUDGET ---------------- */
const CATEGORIES = ['Flights','Lodging','Food','Transport','Activities','Nanny','Other'];

function fmtMoney(n, cur){
  const v = Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});
  return (cur||'USD') + ' ' + v;
}

// Best-effort: flight prices are free-text (e.g. "$176", "~$400", "TBD"),
// not structured numbers, so this can't be merged into the real expense total.
function parsePrice(str) {
  const n = parseFloat((str || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function renderBookedFlightsLine() {
  const el = document.getElementById('bookedFlightsLine');
  if (!el) return;
  const booked = flights.filter(f => f.booked);
  if (!booked.length) { el.innerHTML = ''; return; }
  const parsed = booked.map(f => parsePrice(f.price)).filter(n => n !== null);
  const sum = parsed.reduce((s, n) => s + n, 0);
  const symbol = (booked.find(f => f.price?.includes('$'))) ? '$'
    : (booked.find(f => f.price?.includes('€'))) ? '€'
    : (booked.find(f => f.price?.includes('£'))) ? '£' : '';
  const unparsed = booked.length - parsed.length;
  el.innerHTML = `<div class="catwrap" style="margin-bottom:16px">
    <div class="catrow"><span class="cname">Booked flights</span>
      <span style="flex:1;color:var(--ink-soft);font-size:14px">
        ${booked.length} flight${booked.length === 1 ? '' : 's'} marked booked
        ${unparsed ? ` · ${unparsed} without a clear price` : ''}
      </span>
      <span class="camt">${symbol}${sum.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
    </div>
  </div>`;
}

function renderBudget(){
  const baseCur = budgetTarget?.base_currency || (expenses[0]?.currency) || 'USD';
  const total = expenses.reduce((s,e)=>s + Number(e.amount||0), 0);
  const target = budgetTarget?.total_budget ? Number(budgetTarget.total_budget) : null;

  renderBookedFlightsLine();

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
  document.getElementById('cap-city').value='';
  document.getElementById('cap-country').value='';
  document.getElementById('cap-url').value='';
  document.getElementById('cap-country-suggestions').innerHTML='';
  document.getElementById('cap-country-status').textContent='';
  document.getElementById('cap-place-drop').classList.remove('open');
  setCaptureMode('place');
  capMsg('');
  openOverlay('ov-capture');
}
function capMsg(m){ document.getElementById('cap-msg').textContent=m; }
function closeAll(){ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); closePreview(); } });
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
    _smartImageType = file.type || 'image/jpeg';
    document.getElementById('si-image-thumb').src = e.target.result;
    document.getElementById('si-image-preview').style.display = '';
    document.getElementById('si-msg').textContent = '';
  };
  reader.readAsDataURL(file);
}

function clearSmartImage() {
  _smartImageFile = null;
  _smartImageB64  = null;
  _smartImageType = null;
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
  if (_smartImageB64) body.imageMediaType = _smartImageType || 'image/jpeg';

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
  const text = result.extractedData?.text || rawText || result.summary || '';
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
    trip_id: TRIP_ID, title: text, done: false,
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

/* ---------------- FLIGHT RESEARCH ---------------- */
function renderResearch() {
  const el = document.getElementById('researchList');
  if (!el) return;
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

  let newId = null;
  if (GUEST_MODE) {
    newId = lsInsert('flights', row).id;
    flights = lsGet('flights').filter(r => r.trip_id === TRIP_ID);
    renderFlights();
  } else {
    const { data, error } = await sb.from('flights').insert(row).select().single();
    if (error) { alert(error.message); return; }
    newId = data?.id;
    const { data: allFlights } = await sb.from('flights').select('*').eq('trip_id', TRIP_ID).order('created_at');
    flights = allFlights || [];
    renderFlights();
  }

  logActivity('added_flight',
    `${row.origin || '?'} → ${row.destination || '?'}${row.depart_date ? ' · ' + row.depart_date : ''}${row.airline ? ' · ' + row.airline : ''}`,
    'flight', newId, { origin: row.origin || '?', destination: row.destination || '?' });

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

  const { MAPBOX_TOKEN } = window.TRIPLAN_CONFIG;
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
  // 1. Match existing trip places
  const found = places.find(c => c.name.toLowerCase().includes(ql) || ql.includes(c.name.toLowerCase()));
  if (found?.lat && found?.lng) return [found.lng, found.lat];
  // 2. Match AIRPORTS list (IATA code or city name) — prevents wrong-country Nominatim matches
  const ap = AIRPORTS.find(a => a[0].toLowerCase() === ql || a[1].toLowerCase() === ql);
  if (ap) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
        + encodeURIComponent(ap[1] + ', ' + ap[3]));
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

/* ================================================================
   FEATURE 2: PRE-TRIP TODO LIST
   ================================================================ */
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
  todos = (t.data || []).filter(x => !x.private || x.created_by === _myUserId);
  prepTabs = (pt.data || []).filter(x => !x.private || x.created_by === _myUserId);
  renderPrepTabs(); renderTodos();
}

function renderPrepTabs() {
  const el = document.getElementById('prepTabBar');
  if (!el) return;
  const allTabs = [...PREP_BUILTIN_TABS, ...prepTabs.map(t => ({ id: t.id, name: t.name, private: t.private }))];
  if (!allTabs.find(t => t.id === activePrepTab)) activePrepTab = 'todos';
  const lockSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.5;margin-left:3px;vertical-align:middle"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  el.innerHTML = allTabs.map(t =>
    `<button class="prep-tab${t.id === activePrepTab ? ' active' : ''}" onclick="switchPrepTab('${t.id}')">
      ${esc(t.name)}${t.private ? lockSvg : ''}<span class="prep-tab-x" onclick="event.stopPropagation();deletePrepTab('${t.id}')">×</span>
    </button>`
  ).join('') + `<button class="prep-tab add" onclick="openAddPrepTab()">＋</button>`;
}

async function deletePrepTab(id) {
  const builtin = PREP_BUILTIN_TABS.find(t => t.id === id);
  const custom  = prepTabs.find(t => t.id === id);
  const tabName = builtin?.name || custom?.name || id;
  const msg = builtin
    ? `Clear all tasks in "${tabName}"?`
    : `Delete the "${tabName}" tab and all its tasks?`;
  if (!confirm(msg)) return;

  todos = todos.filter(t => (t.category || 'todos') !== id);
  if (GUEST_MODE) {
    lsSave('todos', lsGet('todos').filter(t => (t.category || 'todos') !== id));
  } else {
    await sb.from('trip_todos').delete().eq('category', id).eq('trip_id', TRIP_ID);
  }

  if (custom) {
    prepTabs = prepTabs.filter(t => t.id !== id);
    if (!GUEST_MODE) await sb.from('prep_tabs').delete().eq('id', id);
    else lsDelete('prep_tabs', id);
  }

  if (activePrepTab === id) activePrepTab = 'todos';
  renderPrepTabs();
  renderTodos();
}

function switchPrepTab(id) {
  activePrepTab = id;
  renderPrepTabs();
  renderTodos();
}

function openAddPrepTab() {
  document.getElementById('prep-tab-name').value = '';
  document.getElementById('prep-tab-private').checked = false;
  document.getElementById('prep-tab-private-row').style.display = GUEST_MODE ? 'none' : '';
  openOverlay('ov-prep-tab');
}

async function savePrepTab() {
  const name = document.getElementById('prep-tab-name').value.trim();
  if (!name) return;
  const isPrivate = !GUEST_MODE && document.getElementById('prep-tab-private').checked;
  const row = { trip_id: TRIP_ID, name, private: isPrivate, created_by: GUEST_MODE ? null : _myUserId };
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

function renderTodos() {
  const el = document.getElementById('todoList');
  if (!el) return;
  const items = todos.filter(t => (t.category || 'todos') === activePrepTab)
    .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  if (!items.length) {
    const isPrivateTab = prepTabs.find(t => t.id === activePrepTab)?.private;
    const emptyMsg = isPrivateTab
      ? 'Add items visible just for you — like a present you want to buy them, or things to sort out before you go.'
      : 'No tasks yet. Add things you need to do before the trip, or ask AI to suggest some.';
    el.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = items.map(t => {
    const overdue = t.deadline && !t.done && t.deadline < today;
    const deadlineLabel = t.deadline
      ? new Date(t.deadline + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '';
    return `<div class="todo-item" data-id="${t.id}">
      <div class="todo-check${t.done ? ' done' : ''}" onclick="toggleTodo('${t.id}')">
        ${t.done ? '✓' : ''}
      </div>
      <span class="todo-title${t.done ? ' done' : ''}" onclick="openEditTodo('${t.id}')">${esc(t.title)}${t.private ? ' <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.45;vertical-align:middle"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}</span>
      ${deadlineLabel ? `<span class="todo-deadline${overdue ? ' overdue' : ''}" onclick="openEditTodo('${t.id}')">${overdue ? '⚠ ' : ''}${deadlineLabel}</span>` : ''}
      <button class="del" style="position:static;opacity:.3;font-size:16px" onclick="deleteTodo('${t.id}')">×</button>
    </div>`;
  }).join('');
}

let _editingTodoId = null;

function openAddTodo() {
  _editingTodoId = null;
  const isNoDate = activePrepTab === 'first_aid' || activePrepTab === 'shopping';
  const title = activePrepTab === 'todos' ? 'Add todo' : 'Add item';
  document.getElementById('todo-modal-title').textContent = title;
  document.getElementById('todo-label').textContent = activePrepTab === 'todos' ? 'Task' : 'Item';
  document.getElementById('todo-deadline-row').style.display = isNoDate ? 'none' : '';
  document.getElementById('todo-title').value = '';
  document.getElementById('todo-deadline').value = '';
  const isPrivateTab = prepTabs.find(t => t.id === activePrepTab)?.private;
  document.getElementById('todo-private-row').style.display = (GUEST_MODE || isPrivateTab) ? 'none' : '';
  document.getElementById('todo-private').checked = false;
  document.getElementById('todo-save-btn').textContent = 'Add';
  openOverlay('ov-todo');
}

function openEditTodo(id) {
  const t = todos.find(x => x.id === id); if (!t) return;
  _editingTodoId = id;
  const isNoDate = activePrepTab === 'first_aid' || activePrepTab === 'shopping';
  document.getElementById('todo-modal-title').textContent = activePrepTab === 'todos' ? 'Edit todo' : 'Edit item';
  document.getElementById('todo-label').textContent = activePrepTab === 'todos' ? 'Task' : 'Item';
  document.getElementById('todo-deadline-row').style.display = isNoDate ? 'none' : '';
  document.getElementById('todo-title').value = t.title;
  document.getElementById('todo-deadline').value = t.deadline || '';
  document.getElementById('todo-private-row').style.display = 'none';
  document.getElementById('todo-save-btn').textContent = 'Save';
  openOverlay('ov-todo');
}

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
    const isPrivateTab = prepTabs.find(t => t.id === activePrepTab)?.private;
    const isPrivate = !GUEST_MODE && (isPrivateTab || document.getElementById('todo-private').checked);
    const row = { trip_id: TRIP_ID, title, deadline, done: false, category: activePrepTab,
      private: isPrivate, created_by: GUEST_MODE ? null : _myUserId };
    let newId = null;
    if (GUEST_MODE) { newId = lsInsert('todos', row).id; }
    else {
      const { data } = await sb.from('trip_todos').insert(row).select().single();
      newId = data?.id;
    }
    logActivity('added_todo', title, 'todo', newId);
  }
  _editingTodoId = null;
  closeAll();
  await refreshTodos();
}

async function toggleTodo(id) {
  const t = todos.find(x => x.id === id); if (!t) return;
  t.done = !t.done;
  if (GUEST_MODE) { lsUpdate('todos', id, { done: t.done }); }
  else { await sb.from('trip_todos').update({ done: t.done }).eq('id', id); }
  renderTodos();
}

async function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  if (GUEST_MODE) { lsDelete('todos', id); }
  else { await sb.from('trip_todos').delete().eq('id', id); }
  renderTodos();
}

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

function renderAiTodos(reply, aiTodos) {
  const el = document.getElementById('todoList');
  el.innerHTML =
    (reply ? `<div style="color:var(--ink-soft);font-size:14px;margin-bottom:14px">${esc(reply)}</div>` : '') +
    `<div id="ai-todo-cards">` +
    aiTodos.map((t, i) => `
      <div class="todo-ai-card" id="ai-todo-${i}">
        <div class="todo-ai-title">${esc(t.title)}</div>
        ${t.deadline ? `<div style="font-size:12px;color:var(--ink-soft);margin-bottom:2px">By ${esc(t.deadline)}</div>` : ''}
        ${t.reason ? `<div class="todo-ai-reason">${esc(t.reason)}</div>` : ''}
        <div class="todo-ai-actions">
          <button class="btn small" onclick="acceptAiTodo(${i}, this)">✓ Add</button>
          <button class="btn ghost small" onclick="skipAiTodo(${i}, this)">✗ Skip</button>
        </div>
      </div>`).join('') +
    `</div>` +
    `<div style="margin-top:16px;text-align:right"><button class="btn ghost small" onclick="refreshTodos();renderTodos()">View my list →</button></div>`;
}

async function acceptAiTodo(idx, btn) {
  const t = window._aiTodos?.[idx]; if (!t) return;
  const row = { trip_id: TRIP_ID, title: t.title, deadline: t.deadline || null, done: false, category: activePrepTab };
  if (GUEST_MODE) lsInsert('todos', row);
  else await sb.from('trip_todos').insert(row);
  todos.push({ ...row, id: Date.now().toString(36) });
  // Update card in place — show "✓ Added", disable buttons
  btn.textContent = '✓ Added';
  btn.disabled = true;
  btn.nextElementSibling?.remove(); // remove Skip button
}

async function skipAiTodo(idx, btn) {
  addSeenTodoTitle(window._aiTodos?.[idx]?.title || '');
  const card = document.getElementById('ai-todo-' + idx);
  if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
  btn.closest('.todo-ai-actions').innerHTML = '<span style="color:var(--ink-soft);font-size:13px">Skipped</span>';
}

/* ================================================================
   FEATURE 3: ACTIVITY FEED
   ================================================================ */
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

// Override tab show to load data lazily
const _origShowTab = showTab;
function showTab(t) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + t));
  if (t === 'prep') refreshTodos();
  document.querySelector('.fab').style.display = t === 'countries' ? '' : 'none';
}

init();
