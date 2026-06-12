#!/usr/bin/env node
/**
 * holidays-sync — populate the platform holiday_calendar for the current + next
 * year. Spine: the `date-holidays` library (Poland public holidays); enriched
 * with the curated commercial-dates.json (beauty-industry observances the lib
 * doesn't carry). Pushes upserts through the Worker seam (idempotent on
 * occasion_key + date). Run daily by PM2/cron; safe to run twice.
 *
 * Facts only — no LLM here. The result is the calendar the content-plan builder
 * schedules seasonal greetings/offers against.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { api } from './lib/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function pad2(n) { return String(n).padStart(2, '0'); }

/** date-holidays Poland public holidays for a year → seam rows. */
function publicHolidayRows(year) {
  let Holidays;
  try {
    // Lazy require so the script still runs (commercial-only) if the dep is absent.
    Holidays = require('date-holidays');
  } catch {
    return [];
  }
  const hd = new (Holidays.default || Holidays)('PL');
  const list = hd.getHolidays(year) || [];
  const rows = [];
  for (const h of list) {
    if (h.type !== 'public') continue;
    const date = h.date.slice(0, 10); // 'YYYY-MM-DD'
    const key = h.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    rows.push({
      date, country: 'PL', occasion_key: `pl_${key}`, type: 'public',
      name_pl: h.name, name_ru: h.name, name_uk: h.name, name_en: h.name,
      recurrence: { freq: 'yearly' },
    });
  }
  return rows;
}

/** Curated commercial/observance occasions for a year → seam rows. */
function commercialRows(year) {
  const path = join(__dirname, 'commercial-dates.json');
  const { occasions } = JSON.parse(readFileSync(path, 'utf8'));
  return occasions.map((o) => ({
    date: `${year}-${pad2(o.month)}-${pad2(o.day)}`,
    country: 'PL',
    occasion_key: o.occasion_key,
    type: o.type,
    name_pl: o.name_pl, name_ru: o.name_ru, name_uk: o.name_uk, name_en: o.name_en,
    recurrence: { freq: 'yearly', month: o.month, day: o.day },
  }));
}

async function main() {
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear + 1];
  let rows = [];
  for (const y of years) rows = rows.concat(publicHolidayRows(y), commercialRows(y));

  const res = await api.holidaysUpsert(rows);
  const stamp = new Date().toISOString();
  if (res.ok) {
    console.log(`[holidays-sync] ${stamp} upserted=${res.upserted}/${rows.length} years=${years.join(',')}`);
  } else {
    console.error(`[holidays-sync] ${stamp} FAILED error=${res.error}`);
    process.exitCode = 1;
  }
}

main();
