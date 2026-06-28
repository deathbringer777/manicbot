#!/usr/bin/env node
'use strict';
/**
 * Daily Meta (Facebook/Instagram) ads + Pixel health report → Telegram.
 *
 * Replaces manually opening Ads Manager / Events Manager to check "is the pixel
 * still firing and how is the campaign doing?". Pulls account-level ad insights
 * (spend, results, CPA over 7d), per-active-campaign rows, and the Pixel's
 * last_fired_time, then posts one compact report to the ops chat.
 *
 * Ships safe BEFORE the credential exists: with no META_ADS_TOKEN configured it
 * logs and returns cleanly (no send, no alert), so it can be deployed now and
 * "go live" the moment the token is dropped into .env. The token needs ads_read.
 *
 * Pairs with the Meta Pixel `869658089071782` ("ManicBot Web") and the
 * Conversions API wired into the Worker billing webhooks.
 */
const path = require('path');
const { BASE_DIR } = require('../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../lib/runner');
const { createTg, escapeHtml } = require('../lib/tg');
const { httpJson } = require('../lib/http');

const GRAPH = 'https://graph.facebook.com/v21.0';
const DEFAULT_AD_ACCOUNT = 'act_4604644519755219';   // ManicBot business ad account
const DEFAULT_PIXEL_ID = '869658089071782';          // dataset "ManicBot Web"
const DATE_PRESET = 'last_7d';

// Meta `actions` action_types we treat as conversions of interest, mapped to a
// short human label. The browser Pixel + server CAPI both land here.
const CONVERSION_ACTIONS = {
  lead: 'Lead',
  'offsite_conversion.fct.lead': 'Lead',
  complete_registration: 'Registration',
  'offsite_conversion.fct.complete_registration': 'Registration',
  initiate_checkout: 'InitiateCheckout',
  'offsite_conversion.fct.initiate_checkout': 'InitiateCheckout',
  purchase: 'Purchase',
  'offsite_conversion.fct.purchase': 'Purchase',
  subscribe: 'Subscribe',
  'offsite_conversion.fct.subscribe': 'Subscribe',
};

/** Sum Meta `actions` into { label: count } for the conversions we care about. */
function summarizeActions(actions) {
  const out = {};
  for (const a of actions || []) {
    const label = CONVERSION_ACTIONS[a.action_type];
    if (!label) continue;
    out[label] = (out[label] || 0) + Number(a.value || 0);
  }
  return out;
}

/** Reduce one insights row to the fields the report needs. */
function pickInsights(row = {}) {
  return {
    spend: Number(row.spend || 0),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    reach: Number(row.reach || 0),
    conversions: summarizeActions(row.actions),
    campaignName: row.campaign_name,
  };
}

function fmtNum(n) {
  const v = Math.round(Number(n) || 0);
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
function fmtConversions(conv) {
  const entries = Object.entries(conv || {});
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `${k} ${v}`).join(', ');
}

/** Build the Telegram report (HTML). Pure — unit-tested. */
function formatReport({ account, campaigns = [], pixel }) {
  const lines = [];
  lines.push(`📣 <b>Meta Ads · 7д</b>`);
  if (account) {
    lines.push(
      `Расход: <b>${account.spend.toFixed(2)}</b> · Показы: <b>${fmtNum(account.impressions)}</b> · Клики: <b>${fmtNum(account.clicks)}</b> · Охват: <b>${fmtNum(account.reach)}</b>`,
    );
    lines.push(`Конверсии: <b>${escapeHtml(fmtConversions(account.conversions))}</b>`);
  } else {
    lines.push('Нет данных по аккаунту за период.');
  }

  if (campaigns.length) {
    lines.push('— Активные кампании —');
    for (const c of campaigns.slice(0, 8)) {
      lines.push(`• ${escapeHtml(c.campaignName || '?')}: ${c.spend.toFixed(2)} · ${escapeHtml(fmtConversions(c.conversions))}`);
    }
  } else {
    lines.push('▫️ Активных кампаний нет (черновик не запущен).');
  }

  if (pixel) {
    const last = pixel.lastFiredAt ? new Date(pixel.lastFiredAt * 1000).toISOString().replace('T', ' ').slice(0, 16) : null;
    lines.push(
      last
        ? `🎯 Пиксель «${escapeHtml(pixel.name || '?')}»: последнее событие ${last} UTC`
        : `🎯 Пиксель «${escapeHtml(pixel.name || '?')}»: событий ещё не было`,
    );
  }
  return lines.join('\n');
}

/** GET helper — Authorization header (token never in the URL / logs). */
async function graphGet(http, urlPath, token, { timeoutMs = 20000 } = {}) {
  const res = await http(`${GRAPH}${urlPath}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs });
  if (res.status >= 400 || res.data?.error) {
    const e = res.data?.error;
    throw new Error(`Graph ${urlPath.split('?')[0]} failed: ${e?.message || res.status}`);
  }
  return res.data || {};
}

const INSIGHT_FIELDS = 'spend,impressions,clicks,reach,actions,campaign_name';

async function fetchAccountInsights(http, { token, accountId }) {
  const data = await graphGet(http, `/${accountId}/insights?level=account&date_preset=${DATE_PRESET}&fields=${INSIGHT_FIELDS}`, token);
  const row = (data.data && data.data[0]) || null;
  return row ? pickInsights(row) : null;
}

async function fetchCampaignInsights(http, { token, accountId }) {
  const data = await graphGet(http, `/${accountId}/insights?level=campaign&date_preset=${DATE_PRESET}&fields=${INSIGHT_FIELDS}`, token);
  return (data.data || []).map(pickInsights);
}

async function fetchPixelHealth(http, { token, pixelId }) {
  const data = await graphGet(http, `/${pixelId}?fields=name,last_fired_time`, token);
  const lastFiredAt = data.last_fired_time ? Math.floor(new Date(data.last_fired_time).getTime() / 1000) : null;
  return { name: data.name, lastFiredAt };
}

async function main(logger, deps = {}) {
  const http = deps.http || httpJson;
  const tg = deps.tg || createTg();
  const token = deps.token || process.env.META_ADS_TOKEN || '';
  const accountId = process.env.META_AD_ACCOUNT_ID || DEFAULT_AD_ACCOUNT;
  const pixelId = process.env.META_CAPI_PIXEL_ID || process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;

  if (!token) {
    logger.log('META_ADS_TOKEN not configured (needs ads_read) — skipping');
    return { skipped: true };
  }

  // Account insights are the core signal — let a hard auth/permission break alert + exit 1.
  const account = await fetchAccountInsights(http, { token, accountId });

  // Campaigns + pixel health are resilient: a degraded edge must not sink the report.
  let campaigns = [];
  try { campaigns = await fetchCampaignInsights(http, { token, accountId }); }
  catch (e) { logger.log(`campaign insights failed: ${e.message}`); }

  let pixel = null;
  try { pixel = await fetchPixelHealth(http, { token, pixelId }); }
  catch (e) { logger.log(`pixel health failed: ${e.message}`); }

  const report = formatReport({ account, campaigns, pixel });
  logger.log(`report ready (${report.length} chars)`);
  await tg.sendMessage(report, { parseMode: 'HTML' });
  return { ok: true, hasAccount: !!account, campaigns: campaigns.length };
}

module.exports = {
  main, summarizeActions, pickInsights, formatReport,
  fetchAccountInsights, fetchCampaignInsights, fetchPixelHealth,
  CONVERSION_ACTIONS,
};

if (require.main === module) runCron('meta-ads-monitor', main);
