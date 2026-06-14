'use strict';
/**
 * storage.js pure helpers — CSV schema mapping. The file I/O (init/appendLead)
 * is exercised in production; here we pin the header-driven column mapping so a
 * schema change (e.g. the new trailing olx_url column) can't silently misalign
 * old rows written under the previous 14-column header.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../crons/lead-scout/storage');

test('CSV_COLUMNS ends with olx_url (appended last for safe migration)', () => {
  assert.equal(storage.CSV_COLUMNS[storage.CSV_COLUMNS.length - 1], 'olx_url');
  assert.ok(storage.CSV_COLUMNS.includes('phone'));
  assert.ok(storage.CSV_COLUMNS.includes('instagram_url'));
});

test('buildIndexMap reads the actual header order', () => {
  const m = storage.buildIndexMap('id,source,name,phone,website');
  assert.equal(m.phone, 3);
  assert.equal(m.website, 4);
  assert.equal(m.olx_url, undefined);
});

test('rowToLead maps columns by the index map', () => {
  const m = storage.buildIndexMap(storage.CSV_COLUMNS.join(','));
  const row = storage.leadToRow({
    source: 'olx', name: 'Mani X', phone: '+48500600700',
    website: 'https://x.pl', olx_url: 'https://olx.pl/x', district: 'Wola',
  }, 7);
  const cols = storage.parseCsvRow(row);
  const lead = storage.rowToLead(cols, m);
  assert.equal(lead.name, 'Mani X');
  assert.equal(lead.phone, '+48500600700');
  assert.equal(lead.olx_url, 'https://olx.pl/x');
  assert.equal(lead.source, 'olx');
});

test('old 14-column row (no olx_url) still maps phone/website correctly', () => {
  const oldHeader = 'id,source,name,phone,email,address,district,website,instagram_url,booksy_url,maps_url,rating,reviews_count,added_at';
  const m = storage.buildIndexMap(oldHeader);
  const cols = storage.parseCsvRow('1,"duckduckgo","Salon Z","+48111222333","","","Wola","https://z.pl","","","","4.5","20","2026-06-01T00:00:00Z"');
  const lead = storage.rowToLead(cols, m);
  assert.equal(lead.phone, '+48111222333');
  assert.equal(lead.website, 'https://z.pl');
  assert.equal(lead.rating, '4.5');
  assert.equal(lead.olx_url, '');
});

test('parseCsvRow handles quoted commas and escaped quotes', () => {
  const cols = storage.parseCsvRow('1,"Studio ""Lux"", Mokotów","+48500"');
  assert.equal(cols[1], 'Studio "Lux", Mokotów');
  assert.equal(cols[2], '+48500');
});

test('hasContact counts olx_url as a contact', () => {
  assert.equal(storage.hasContact({ olx_url: 'https://olx.pl/x' }), true);
  assert.equal(storage.hasContact({ name: 'no contact' }), false);
});
