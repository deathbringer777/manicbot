'use strict';
/**
 * Pure parser tests for the search scrapers. The scrape() entrypoints hit the
 * network and are not unit-tested (ThinkPad rule); the parse/extract functions
 * they delegate to are tested here against synthetic fixtures that mirror the
 * real OLX __PRERENDERED_STATE__ blob, Custom Search `items`, and Bing markup.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const extract = require('../crons/lead-scout/scrapers/extract');
const olx = require('../crons/lead-scout/scrapers/olx');
const google = require('../crons/lead-scout/scrapers/google');
const bing = require('../crons/lead-scout/scrapers/bing');

// ─── extract ──────────────────────────────────────────────────────────────────

test('extract.extractPhone: PL formats → +48XXXXXXXXX', () => {
  assert.equal(extract.extractPhone('zadzwoń 500 600 700'), '+48500600700');
  assert.equal(extract.extractPhone('tel. +48 501-502-503'), '+48501502503');
  assert.equal(extract.extractPhone('brak numeru'), null);
});

test('extract.isAggregatorDomain / pickWebsite', () => {
  assert.equal(extract.isAggregatorDomain('https://booksy.com/pl/x'), true);
  assert.equal(extract.isAggregatorDomain('https://olx.pl/x'), true);
  assert.equal(extract.isAggregatorDomain('https://realsalon.pl'), false);
  assert.equal(extract.pickWebsite('https://booksy.com/x'), null);
  assert.equal(extract.pickWebsite('https://realsalon.pl/uslugi'), 'https://realsalon.pl/uslugi');
});

// ─── OLX ──────────────────────────────────────────────────────────────────────

function olxFixture() {
  const state = { listing: { listing: { ads: [
    { url: 'https://www.olx.pl/oferta/manicure-CID4-IDa.html', title: 'Manicure hybrydowy',
      description: 'Robię manicure, zadzwoń 500 600 700', contact: { name: 'Ania Nails' },
      location: { districtName: 'Mokotów', cityName: 'Warszawa' } },
    { url: 'https://www.olx.pl/oferta/paznokcie-CID4-IDb.html', title: 'Paznokcie żelowe',
      description: 'Zapraszam', contact: { name: 'Studio X' }, location: { cityName: 'Warszawa' } },
    { url: 'https://www.olx.pl/oferta/praca/zatrudnimy-IDc.html', title: 'Zatrudnimy stylistkę',
      description: 'praca', contact: { name: 'Salon' }, location: { cityName: 'Warszawa' } },
    { url: 'https://www.olx.pl/oferta/zestaw-frezarka-IDd.html', title: 'Zestaw frezarka lampa UV',
      description: 'sprzedam', contact: { name: 'Sklep' }, category: { type: 'goods', id: 4020 },
      location: { cityName: 'Warszawa' } },
    { url: 'https://www.olx.pl/oferta/szkolenie-IDe.html', title: 'Szkolenie paznokcie z dofinansowaniem',
      description: 'kurs', contact: { name: 'Akademia' }, category: { type: 'services', id: 4460 },
      location: { cityName: 'Warszawa' } },
  ] } } };
  return `<html><body><div data-cy="l-card"></div><script>window.__PRERENDERED_STATE__ = ${JSON.stringify(JSON.stringify(state))};</script></body></html>`;
}

test('olx.parseState: reads ads from __PRERENDERED_STATE__', () => {
  assert.equal(olx.parseState(olxFixture()).length, 5);
  assert.equal(olx.parseState('<html>no state</html>').length, 0);
});

test('olx.adToLead: name from contact, phone from description, keyed by olx_url', () => {
  const ads = olx.parseState(olxFixture());
  const lead = olx.adToLead(ads[0], 'Mokotów');
  assert.equal(lead.source, 'olx');
  assert.equal(lead.name, 'Ania Nails');
  assert.equal(lead.phone, '+48500600700');
  assert.equal(lead.olx_url, 'https://www.olx.pl/oferta/manicure-CID4-IDa.html');
  assert.equal(lead.district, 'Mokotów');
});

test('olx.adToLead: job ads, product sales, and training are skipped', () => {
  const ads = olx.parseState(olxFixture());
  assert.equal(olx.adToLead(ads[2], 'Warszawa'), null, 'job ad (/praca/) skipped');
  assert.equal(olx.adToLead(ads[3], 'Warszawa'), null, 'product (category.type=goods) skipped');
  assert.equal(olx.adToLead(ads[4], 'Warszawa'), null, 'training course skipped');
});

// ─── Google CSE ───────────────────────────────────────────────────────────────

test('google.parseItems: website+phone kept, aggregator-only dropped, instagram kept', () => {
  const items = [
    { title: 'Salon Paznokci Mokotów', link: 'https://salonmokotow.pl', snippet: 'manicure, tel 501 502 503' },
    { title: 'Booksy', link: 'https://booksy.com/pl/123', snippet: 'nic' },
    { title: 'Nails IG', link: 'https://instagram.com/nailsbyx', snippet: 'manicure' },
  ];
  const leads = google.parseItems(items, 'Mokotów');
  assert.equal(leads.length, 2);
  assert.equal(leads[0].website, 'https://salonmokotow.pl');
  assert.equal(leads[0].phone, '+48501502503');
  assert.equal(leads[1].instagram_url, 'https://instagram.com/nailsbyx');
});

// ─── Bing ─────────────────────────────────────────────────────────────────────

test('bing.parseResults: organic li.b_algo, aggregator-only dropped', () => {
  const html = `<html><body>
    <li class="b_algo"><h2><a href="https://studiopaznokci.pl">Studio Paznokci</a></h2>
      <div class="b_caption"><p>Manicure Warszawa, tel. 502-503-504</p></div></li>
    <li class="b_algo"><h2><a href="https://booksy.com/pl/x">Booksy</a></h2>
      <div class="b_caption"><p>nic</p></div></li>
  </body></html>`;
  const leads = bing.parseResults(html, cheerio, 'Wola');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].website, 'https://studiopaznokci.pl');
  assert.equal(leads[0].phone, '+48502503504');
  assert.equal(leads[0].source, 'bing');
});
