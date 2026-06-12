#!/usr/bin/env node
/**
 * content-plan-builder — turn upcoming occasions into DRAFT seasonal campaigns.
 *
 * For every curated occasion whose date falls within the look-ahead window
 * (default 35 days), POST a draft `announcement` campaign (schedule_kind='once',
 * scheduled_at = occasion date at 10:00 Europe/Warsaw — inside the quiet-hours
 * window the Worker enforces). The seam dedupes per (occasion_key, year), so this
 * is safe to run daily. Drafts are inert until an operator approves them (UI or
 * tg-bot /approve) AND MESSAGING_SEND_ENABLED is on.
 *
 * Content for each occasion is resolved at delivery from the keyed per-locale
 * templates (template_key='seasonal_<occasion>') the preset-generator produces;
 * this builder only schedules the slot + links the template_key.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api } from './lib/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOOKAHEAD_DAYS = Number(process.env.MESSAGING_LOOKAHEAD_DAYS || 35);
const SEND_HOUR_WARSAW = 10;

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Epoch seconds for a Warsaw-local YYYY-MM-DD at hour:00. Poland is UTC+1 (CET)
 * or UTC+2 (CEST). We approximate with a fixed +1h offset and let the Worker's
 * quiet-hours gate (10:00–20:00 Warsaw) be the authoritative window — being an
 * hour off at the edges never pushes a 10:00 slot outside 10–20.
 */
function warsawEpoch(year, month, day, hour) {
  return Math.floor(Date.UTC(year, month - 1, day, hour - 1, 0, 0) / 1000);
}

function upcomingOccasions(windowDays) {
  const { occasions } = JSON.parse(readFileSync(join(__dirname, 'commercial-dates.json'), 'utf8'));
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = [];
  // Check this year and next so a window spanning Dec→Jan still resolves.
  for (const baseYear of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    for (const o of occasions) {
      const occUtc = Date.UTC(baseYear, o.month - 1, o.day);
      const days = Math.round((occUtc - todayUtc) / 86400000);
      if (days >= 0 && days <= windowDays) {
        out.push({ ...o, year: baseYear, scheduledAt: warsawEpoch(baseYear, o.month, o.day, SEND_HOUR_WARSAW) });
      }
    }
  }
  return out;
}

async function main() {
  const stamp = new Date().toISOString();
  const occ = upcomingOccasions(LOOKAHEAD_DAYS);
  if (occ.length === 0) {
    console.log(`[content-plan] ${stamp} no occasions within ${LOOKAHEAD_DAYS}d`);
    return;
  }
  let created = 0, deduped = 0, failed = 0;
  for (const o of occ) {
    const res = await api.campaignDraft({
      occasion_key: o.occasion_key,
      template_key: `seasonal_${o.occasion_key}`,
      title: o.name_pl,
      bodies: { center: '', bell: '' }, // body resolved from the per-locale template at delivery
      channels: ['center', 'bell'],
      audience: { scope: 'all' },
      scheduled_at: o.scheduledAt,
      year: o.year,
    });
    if (!res.ok) { failed += 1; console.error(`[content-plan] ${o.occasion_key} FAILED ${res.error}`); }
    else if (res.deduped) deduped += 1;
    else created += 1;
  }
  console.log(`[content-plan] ${stamp} occasions=${occ.length} created=${created} deduped=${deduped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main();
