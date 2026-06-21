'use strict';
/**
 * crons/lead-scout/index.js — corpus invariants.
 *
 * These pin the lead-scout collection corpus after the 2026-06-21 unstall:
 *   - dead web-search sources (google/bing) are out of the rotation;
 *   - geography is no longer Warsaw-only (top PL cities added) so the 5000
 *     target is reachable once Warsaw saturates;
 *   - query templates no longer hardcode "Warszawa" (broke for other cities).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { LOCATIONS, QUERY_TEMPLATES, SOURCES, CORPUS } = require('../crons/lead-scout/index');

test('SOURCES: only productive scrapers in rotation (google/bing retired)', () => {
  assert.deepEqual(SOURCES, ['google_maps', 'booksy', 'olx']);
  assert.ok(!SOURCES.includes('google'), 'plain google search must be out of rotation');
  assert.ok(!SOURCES.includes('bing'), 'bing must be out of rotation');
});

test('LOCATIONS: geography expanded beyond Warsaw', () => {
  // Warsaw districts still present (carry the city suffix now)...
  assert.ok(LOCATIONS.some((l) => l.includes('Mokotów')), 'Warsaw districts retained');
  // ...plus other major PL cities — the headroom past saturation.
  for (const city of ['Kraków', 'Wrocław', 'Łódź', 'Poznań', 'Gdańsk']) {
    assert.ok(LOCATIONS.includes(city), `expected ${city} in LOCATIONS`);
  }
  assert.ok(LOCATIONS.length > 14, 'must be more than the original 14 Warsaw districts');
});

test('QUERY_TEMPLATES: take a full geo phrase, never hardcode Warszawa', () => {
  for (const tpl of QUERY_TEMPLATES) {
    const q = tpl('Kraków');
    assert.ok(q.includes('Kraków'), `template must interpolate the location: "${q}"`);
    assert.ok(!/Warszawa/.test(q), `template must not hardcode Warszawa: "${q}"`);
  }
});

test('CORPUS: counts derive from the live arrays', () => {
  assert.equal(CORPUS.districts, LOCATIONS.length);
  assert.equal(CORPUS.queries, QUERY_TEMPLATES.length);
  assert.equal(CORPUS.sources, SOURCES.length);
  assert.equal(CORPUS.sources, 3);
});
