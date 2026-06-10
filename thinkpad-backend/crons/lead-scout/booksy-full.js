#!/usr/bin/env node
/**
 * booksy-full.js — Full Booksy Warsaw catalog crawl.
 *
 * Runs daily at 03:30 via PM2 cron_restart.
 * Crawls ALL pages of Booksy Warsaw nail/beauty listings.
 * Uses JSON-LD (schema.org ItemList) — no per-profile fetches needed,
 * no cheerio dependency, no login required.
 *
 * New URL format (2026-06-06):
 *   https://booksy.com/pl-pl/s/paznokcie/3_warszawa?page=N
 *   (Warsaw city ID = 3, category = paznokcie = nails)
 *
 * Phone numbers are behind Booksy's login wall — not collectable.
 * We get: name, booksy_url, address, rating, reviews_count.
 *
 * Rate: 1 page / 1.5s.
 * Expected: ~50-100 pages × 20 salons = 5000+ leads.
 * Expected runtime: ~2-3 minutes (no per-profile fetches).
 * Max pages: 150 (safety cap).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { URL } = require('url');

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');
require('dotenv').config({ path: path.join(BASE_DIR, '.env') });

const WORKER_URL = process.env.WORKER_URL;
const NOTIFY_TOKEN = process.env.NOTIFY_TOKEN;
const LOG_FILE = path.join(BASE_DIR, 'logs', 'booksy-full.log');

const BOOKSY_BASE = 'https://booksy.com/pl-pl/s/paznokcie/3_warszawa';
const MAX_PAGES = 150;
const PAGE_DELAY_MS = 1500;
// Total timeout: 30 minutes (well under old 110 min since no profile fetches)
const HARD_TIMEOUT_MS = 30 * 60 * 1000;
const LOCK_FILE = path.join(BASE_DIR, 'marketing', 'research', 'booksy-full.lock');
const LOCK_MAX_AGE_MS = 35 * 60 * 1000; // 35 min — stale if older than hard-timeout

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timestamp() { return new Date().toISOString(); }

function log(msg) {
  const line = `[${timestamp()}] ${msg}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
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
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      try {
        const zlib = require('zlib');
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      } catch {}
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── TG notify ────────────────────────────────────────────────────────────────

const { notifyTg } = require('./notify');
function tgNotify(text) {
  return notifyTg(WORKER_URL, NOTIFY_TOKEN, text).catch(() => {});
}

// ─── JSON-LD parsing ──────────────────────────────────────────────────────────

/**
 * Extract business listings from Booksy page HTML via JSON-LD.
 * Returns an array of raw listing objects from the schema.org ItemList.
 */
function parseJsonLd(html) {
  // Booksy may have multiple JSON-LD blocks — try each until we find an ItemList
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      // Accept ItemList at root or under @graph
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

/**
 * Convert a raw ItemList element into our Lead shape.
 */
function elementToLead(entry) {
  const biz = entry.item || entry;
  if (!biz.name) return null;

  const booksy_url = biz.url || biz['@id'] || null;
  if (!booksy_url) return null;

  const addr = biz.address || {};
  const address = [addr.streetAddress, addr.postalCode, addr.addressLocality]
    .filter(Boolean).join(', ') || null;

  const rating = biz.aggregateRating
    ? String(biz.aggregateRating.ratingValue || '').slice(0, 4)
    : null;
  const reviews_count = biz.aggregateRating
    ? String(biz.aggregateRating.reviewCount || '') || null
    : null;

  return {
    source: 'booksy_full',
    district: 'Warszawa',
    name: biz.name,
    phone: null,        // Booksy requires login to show phone numbers
    email: null,
    address,
    website: null,
    instagram_url: null,
    booksy_url,
    maps_url: null,
    rating,
    reviews_count,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const hardTimer = setTimeout(() => {
    log('⏰ Hard timeout — exiting');
    process.exit(0);
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  log('=== Booksy Full Crawl started ===');

  // ── Lock: prevent two concurrent full-crawl runs ──
  const researchDir = path.join(BASE_DIR, 'marketing', 'research');
  fs.mkdirSync(researchDir, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (lockAge < LOCK_MAX_AGE_MS) {
      log(`⚠️  Lock file exists (age: ${Math.round(lockAge / 1000)}s) — another crawl is running. Exiting.`);
      clearTimeout(hardTimer);
      return;
    }
    log(`  Stale lock (age: ${Math.round(lockAge / 1000)}s) — removing and continuing`);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
  process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} process.exit(0); });

  const storage = require('./storage');
  const before = storage.init();
  log(`Starting with ${before} existing leads`);

  let totalAdded = 0;
  let totalScraped = 0;
  let pageNum = 1;
  let emptyPageStreak = 0;

  for (pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    try {
      log(`  Page ${pageNum}...`);
      const res = await httpGet(`${BOOKSY_BASE}?page=${pageNum}`);

      if (res.status === 404 || res.status === 410) {
        log(`  Page ${pageNum}: HTTP ${res.status} — end of catalog`);
        break;
      }

      if (res.status !== 200) {
        log(`  Page ${pageNum}: HTTP ${res.status} — skipping`);
        emptyPageStreak++;
        if (emptyPageStreak >= 3) break;
        await delay(PAGE_DELAY_MS * 2);
        continue;
      }

      const elements = parseJsonLd(res.body);

      if (elements.length === 0) {
        emptyPageStreak++;
        log(`  Page ${pageNum}: 0 listings in JSON-LD (streak: ${emptyPageStreak})`);
        if (emptyPageStreak >= 3) {
          log('  3 consecutive empty pages — end of catalog');
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
        const ok = storage.appendLead(lead);
        if (ok) totalAdded++;
      }

      log(`  Page ${pageNum}: ${elements.length} listings, +${totalAdded} unique so far (total: ${storage.getTotal()})`);

      await delay(PAGE_DELAY_MS);

    } catch (pageErr) {
      log(`  Page ${pageNum} error: ${pageErr.message}`);
      await delay(PAGE_DELAY_MS * 2);
    }
  }

  const finalTotal = storage.getTotal();
  const pagesRun = pageNum - 1;
  log(`=== Booksy Full Crawl done: ${pagesRun} pages, ${totalScraped} scraped, +${totalAdded} new, ${finalTotal} total ===`);

  await tgNotify([
    `📚 Booksy Full Crawl завершён`,
    `📄 Страниц: ${pagesRun}`,
    `🔍 Собрано: ${totalScraped} объявлений`,
    `🆕 Новых в базе: +${totalAdded}`,
    `📊 Всего лидов: ${finalTotal}`,
  ].join('\n'));
}

run().catch((err) => {
  log(`FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
