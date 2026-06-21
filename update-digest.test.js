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
