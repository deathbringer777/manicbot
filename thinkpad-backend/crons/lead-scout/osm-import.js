#!/usr/bin/env node
'use strict';
/**
 * osm-import.js — одноразовый (и периодический) импорт Warsaw nail/beauty салонов
 * из OpenStreetMap через Overpass API.
 *
 * Теги:
 *   beauty=nails, shop=nail_salon           — прямые nail-салоны
 *   shop=beauty, amenity=beauty_salon,       — широкий бьюти (включает маникюр)
 *   craft=beautician
 *
 * Запускать вручную:  node crons/lead-scout/osm-import.js
 * Или через PM2:      pm2 start osm-import.js --no-autorestart
 */

const https = require('https');
const path = require('path');
const { BASE_DIR } = require('../../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../../lib/runner');
const { createTg } = require('../../lib/tg');
const storage = require('./storage');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Пауза между запросами к Overpass (rate limit — 1 req/10s рекомендовано)
const DELAY_MS = 12000;

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url);
    const req = https.request(
      { hostname, path: pathname + search, method: 'GET',
        headers: { 'User-Agent': 'ManicBot-LeadScout/1.0 (contact: ops@manicbot.app)' },
        timeout: 45000 },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Overpass timeout')); });
    req.end();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Overpass query ───────────────────────────────────────────────────────────

async function overpassQuery(qlTags) {
  const union = qlTags.map(t => `nwr${t}(area.w);`).join('');
  const q = encodeURIComponent(
    `[out:json][timeout:40];area["name"="Warszawa"]["admin_level"="8"]->.w;(${union});out body;`
  );
  const res = await httpGet(`${OVERPASS_URL}?data=${q}`);
  if (res.status !== 200) throw new Error(`Overpass HTTP ${res.status}`);
  return JSON.parse(res.body).elements || [];
}

// ─── Tag normalisation ────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return null;
  // Take the first number if multiple separated by ; or ,
  const first = raw.split(/[;,]/)[0].trim();
  const digits = first.replace(/[^\d+]/g, '');
  if (digits.length < 9) return null;
  // Ensure +48 prefix for Polish numbers
  if (digits.startsWith('+48') && digits.length === 12) return digits;
  if (digits.startsWith('48') && digits.length === 11) return '+' + digits;
  if (digits.length === 9) return '+48' + digits;
  return digits.length >= 9 ? digits : null;
}

function normalizeInstagram(raw) {
  if (!raw) return null;
  if (raw.includes('instagram.com/')) return raw.startsWith('http') ? raw : 'https://' + raw;
  if (/^@?[\w.]+$/.test(raw)) return `https://www.instagram.com/${raw.replace(/^@/, '')}/`;
  return null;
}

function tagsToLead(tags) {
  const name = tags.name || tags['name:pl'] || null;
  if (!name || name.length < 2) return null;

  const phone = normalizePhone(
    tags.phone || tags['contact:phone'] || tags['phone:mobile'] || tags['contact:mobile']
  );
  const website = tags.website || tags['contact:website'] || tags['url'] || null;
  const instagram_url = normalizeInstagram(
    tags.instagram || tags['contact:instagram'] || tags['social:instagram']
  );

  const street = tags['addr:street'] || '';
  const num = tags['addr:housenumber'] || '';
  const city = tags['addr:city'] || 'Warszawa';
  const district = tags['addr:suburb'] || tags['addr:quarter'] || tags['addr:district'] || '';
  const address = [street, num].filter(Boolean).join(' ') + (city ? `, ${city}` : '');

  return {
    source: 'osm',
    name,
    phone,
    email: null,
    address: address || null,
    district: district || null,
    website: website || null,
    instagram_url: instagram_url || null,
    booksy_url: null,
    maps_url: null,
    rating: tags['stars'] || null,
    reviews_count: null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(logger) {
  const tg = createTg();
  const before = storage.init();
  logger.log(`Starting OSM import. Existing leads: ${before}`);

  // Two separate queries to avoid Overpass timeout on big unions
  const NAIL_TAGS = [
    '["beauty"="nails"]',
    '["shop"="nail_salon"]',
  ];
  const BEAUTY_TAGS = [
    '["shop"="beauty"]',
    '["amenity"="beauty_salon"]',
    '["craft"="beautician"]',
  ];

  let allElements = [];

  logger.log('Querying OSM: nail_salon + beauty=nails ...');
  const nailElems = await overpassQuery(NAIL_TAGS);
  logger.log(`  Got ${nailElems.length} nail elements`);
  allElements.push(...nailElems);

  await delay(DELAY_MS);

  logger.log('Querying OSM: shop=beauty + amenity=beauty_salon + craft=beautician ...');
  const beautyElems = await overpassQuery(BEAUTY_TAGS);
  logger.log(`  Got ${beautyElems.length} beauty elements`);
  allElements.push(...beautyElems);

  // Dedup by OSM id (same object can appear in both queries)
  const seen = new Set();
  allElements = allElements.filter(e => {
    const key = `${e.type}:${e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  logger.log(`Unique OSM elements after dedup: ${allElements.length}`);

  let added = 0;
  let skipped_no_contact = 0;
  let skipped_duplicate = 0;

  for (const elem of allElements) {
    const tags = elem.tags || {};
    const lead = tagsToLead(tags);
    if (!lead) continue;

    const result = storage.appendLead(lead);
    if (result) {
      added++;
    } else {
      // Distinguish why it was skipped
      const phone = lead.phone;
      const hasAnyContact = lead.phone || lead.email || lead.website || lead.booksy_url || lead.instagram_url;
      if (!hasAnyContact) skipped_no_contact++;
      else skipped_duplicate++;
    }
  }

  const after = storage.getTotal();
  logger.log(`OSM import done: +${added} new leads (skipped: ${skipped_no_contact} no-contact, ${skipped_duplicate} duplicate). Total: ${after}`);

  await tg.sendMessage(
    `🗺️ OSM Import завершён\n` +
    `📍 Элементов из OSM: ${allElements.length}\n` +
    `🆕 Новых в базе: +${added}\n` +
    `⛔ Без контактов: ${skipped_no_contact}\n` +
    `📊 Всего лидов: ${after}`,
    { parseMode: null }
  );
}

runCron('osm-import', main);
