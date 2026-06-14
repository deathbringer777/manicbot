'use strict';
/**
 * dedup.js — pure dedup-key logic shared by live storage append and the
 * offline base cleaner.
 *
 * The key regression these tests pin: a second lead for the same business that
 * has only a WEBSITE or INSTAGRAM (no phone) must be detected as a duplicate.
 * The legacy storage.js keyed only on phone/booksy_url/maps_url and silently
 * let those through — that is the source of the duplicates in leads.csv.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const dedup = require('../crons/lead-scout/dedup');

test('normalizePhone: strips +48/spaces/dashes to 9 PL digits', () => {
  assert.equal(dedup.normalizePhone('+48 123-456-789'), '123456789');
  assert.equal(dedup.normalizePhone('48123456789'), '123456789');
  assert.equal(dedup.normalizePhone('(12) 345 67 89'), '123456789');
  assert.equal(dedup.normalizePhone('123'), null);
  assert.equal(dedup.normalizePhone(null), null);
});

test('normalizeUrl: host+path, www and trailing slash stripped, lowercased', () => {
  assert.equal(dedup.normalizeUrl('https://www.Example.com/Salon/'), 'example.com/salon');
  assert.equal(dedup.normalizeUrl('http://example.com'), 'example.com');
  assert.equal(dedup.normalizeUrl('not a url'), null);
  assert.equal(dedup.normalizeUrl(null), null);
});

test('normalizeInstagram: handle from url or @handle, lowercased', () => {
  assert.equal(dedup.normalizeInstagram('https://www.instagram.com/Nail.Studio/'), 'nail.studio');
  assert.equal(dedup.normalizeInstagram('@Nail_Studio'), 'nail_studio');
  assert.equal(dedup.normalizeInstagram('nailstudio'), 'nailstudio');
  assert.equal(dedup.normalizeInstagram(null), null);
});

test('leadKeys: emits one key per strong identifier', () => {
  const keys = dedup.leadKeys({ phone: '+48123456789', website: 'https://salon.pl', instagram_url: '@salon' });
  assert.ok(keys.includes('ph:123456789'));
  assert.ok(keys.includes('url:salon.pl'));
  assert.ok(keys.includes('ig:salon'));
});

test('REGRESSION: website-only duplicate (no phone) is caught', () => {
  const d = dedup.createDeduper();
  const a = { name: 'Salon A', website: 'https://nails.pl/', phone: null };
  const b = { name: 'Salon A (dup)', website: 'http://www.nails.pl', phone: null };
  assert.equal(d.isDuplicate(a), false);
  d.add(a);
  assert.equal(d.isDuplicate(b), true, 'same website, no phone → must be a duplicate');
});

test('REGRESSION: instagram-only duplicate is caught', () => {
  const d = dedup.createDeduper();
  d.add({ name: 'X', instagram_url: 'https://instagram.com/manistudio' });
  assert.equal(d.isDuplicate({ name: 'X2', instagram_url: '@maniStudio' }), true);
});

test('cross-source dedup: google_maps phone vs olx phone collapse', () => {
  const d = dedup.createDeduper();
  d.add({ source: 'google_maps', phone: '+48 500 600 700', maps_url: 'https://maps.google.com/place/abc' });
  assert.equal(d.isDuplicate({ source: 'olx', phone: '500600700', olx_url: 'https://olx.pl/x' }), true);
});

test('distinct businesses are not merged', () => {
  const d = dedup.createDeduper();
  d.add({ phone: '+48111111111', website: 'https://a.pl' });
  assert.equal(d.isDuplicate({ phone: '+48222222222', website: 'https://b.pl' }), false);
});
