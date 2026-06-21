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
