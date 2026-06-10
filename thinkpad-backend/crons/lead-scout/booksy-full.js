#!/usr/bin/env node
'use strict';
/**
 * booksy-full.js — Full Booksy Warsaw catalog crawl.
 *
 * Runs daily at 03:30 via PM2 cron_restart.
 * Crawls ALL pages of Booksy Warsaw nail/beauty listings via JSON-LD
 * (schema.org ItemList) — no per-profile fetches, no login required.
 *
 * URL format (2026-06-06): https://booksy.com/pl-pl/s/paznokcie/3_warszawa?page=N
 * Phone numbers are behind Booksy's login wall — not collectable.
 * Rate: 1 page / 1.5s; ~150 pages ≈ 4 minutes.
 *
 * Hardening (2026-06-10): lock + failure alert moved to lib/runner;
 * yield-collapse anomaly detection (JSON-LD drift) alerts to Telegram.
 */
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { BASE_DIR } = require('../../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../../lib/runner');
const { createTg } = require('../../lib/tg');
const { crawlVerdict } = require('./anomaly');
const storage = require('./storage');

const BOOKSY_BASE = 'https://booksy.com/pl-pl/s/paznokcie/3_warszawa';
const MAX_PAGES = 150;
const PAGE_DELAY_MS = 1500;
const HARD_TIMEOUT_MS = 30 * 60 * 1000;
const LOCK_TTL_MS = 35 * 60 * 1000; // stale if older than the hard timeout

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      timeout: 25000,
    }, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      try {
        const zlib = require('zlib');
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      } catch { /* fall back to raw stream */ }
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/** Extract business listings from Booksy page HTML via JSON-LD ItemList. */
function parseJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const list = data['@type'] === 'ItemList' ? data
        : Array.isArray(data['@graph']) ? data['@graph'].find(n => n['@type'] === 'ItemList')
        : null;
      if (list && Array.isArray(list.itemListElement) && list.itemListElement.length > 0) {
        return list.itemListElement;
      }
    } catch { /* bad JSON block, try next */ }
  }
  return [];
}

/** Convert a raw ItemList element into our Lead shape. */
function elementToLead(entry) {
  const biz = entry.item || entry;
  if (!biz.name) return null;
  const booksy_url = biz.url || biz['@id'] || null;
  if (!booksy_url) return null;

  const addr = biz.address || {};
  const address = [addr.streetAddress, addr.postalCode, addr.addressLocality]
    .filter(Boolean).join(', ') || null;

  return {
    source: 'booksy_full',
    district: 'Warszawa',
    name: biz.name,
    phone: null, // Booksy requires login to show phone numbers
    email: null,
    address,
    website: null,
    instagram_url: null,
    booksy_url,
    maps_url: null,
    rating: biz.aggregateRating ? String(biz.aggregateRating.ratingValue || '').slice(0, 4) : null,
    reviews_count: biz.aggregateRating ? String(biz.aggregateRating.reviewCount || '') || null : null,
  };
}

async function main(logger) {
  const hardTimer = setTimeout(() => {
    logger.log('⏰ Hard timeout — exiting');
    process.exit(1); // runner's exit hook releases the lock
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  const tg = createTg();
  const before = storage.init();
  logger.log(`Starting with ${before} existing leads`);

  let totalAdded = 0;
  let totalScraped = 0;
  let pageNum = 1;
  let emptyPageStreak = 0;

  for (pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    try {
      const res = await httpGet(`${BOOKSY_BASE}?page=${pageNum}`);

      if (res.status === 404 || res.status === 410) {
        logger.log(`  Page ${pageNum}: HTTP ${res.status} — end of catalog`);
        break;
      }
      if (res.status !== 200) {
        logger.log(`  Page ${pageNum}: HTTP ${res.status} — skipping`);
        emptyPageStreak++;
        if (emptyPageStreak >= 3) break;
        await delay(PAGE_DELAY_MS * 2);
        continue;
      }

      const elements = parseJsonLd(res.body);
      if (elements.length === 0) {
        emptyPageStreak++;
        logger.log(`  Page ${pageNum}: 0 listings in JSON-LD (streak: ${emptyPageStreak})`);
        if (emptyPageStreak >= 3) {
          logger.log('  3 consecutive empty pages — end of catalog');
          break;
        }
        await delay(PAGE_DELAY_MS);
        continue;
      }

      emptyPageStreak = 0;
      totalScraped += elements.length;
      for (const entry of elements) {
        const lead = elementToLead(entry);
        if (!lead) continue;
        if (storage.appendLead(lead)) totalAdded++;
      }
      logger.log(`  Page ${pageNum}: ${elements.length} listings, +${totalAdded} unique so far (total: ${storage.getTotal()})`);
      await delay(PAGE_DELAY_MS);
    } catch (pageErr) {
      logger.log(`  Page ${pageNum} error: ${pageErr.message}`);
      await delay(PAGE_DELAY_MS * 2);
    }
  }

  const pagesRun = Math.min(pageNum, MAX_PAGES);
  const verdict = crawlVerdict({ pagesRun, totalScraped, reachedCap: pageNum > MAX_PAGES });
  const finalTotal = storage.getTotal();
  logger.log(`Crawl summary: ${pagesRun} pages, ${totalScraped} scraped, +${totalAdded} new, ${finalTotal} total`);
  verdict.reasons.forEach(r => logger.log(`  ANOMALY: ${r}`));
  verdict.warnings.forEach(w => logger.log(`  WARN: ${w}`));

  const lines = [
    verdict.anomaly ? '⚠️ Booksy Full Crawl: похоже, ПАРСЕР СЛОМАЛСЯ' : '📚 Booksy Full Crawl завершён',
    `📄 Страниц: ${pagesRun}`,
    `🔍 Собрано: ${totalScraped} объявлений`,
    `🆕 Новых в базе: +${totalAdded}`,
    `📊 Всего лидов: ${finalTotal}`,
    ...verdict.reasons.map(r => `❗ ${r}`),
    ...verdict.warnings.map(w => `⚠️ ${w}`),
  ];
  await tg.sendMessage(lines.join('\n'), { parseMode: null }).catch(() => {});
}

if (require.main === module) {
  runCron('booksy-full', main, { lockTtlMs: LOCK_TTL_MS });
}

module.exports = { parseJsonLd, elementToLead, main };
