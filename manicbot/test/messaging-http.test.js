/**
 * messagingHttp — the ThinkPad → Worker seam (/admin/messaging/*). Covers auth
 * (MESSAGING_TOKEN required, ADMIN_KEY fallback, reject otherwise), holiday
 * upsert idempotency, template/campaign draft creation, approve status flip, and
 * the drafts listing the tg-bot reads. Promo mint delegates to the (separately
 * tested) mintSeasonalPromo and is mocked here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';

vi.mock('../src/billing/promoCodes.js', () => ({
  mintSeasonalPromo: vi.fn(async () => ({ data: { code: 'WIOSNA20', expires_at: 999, livemode: 0 }, error: null })),
  getPromoForCampaign: vi.fn(async () => null),
}));

const { tryMessagingRoutes } = await import('../src/http/messagingHttp.js');

let db;
beforeEach(() => { db = createMockD1(); });

function makeEnv(extra = {}) {
  return { DB: db, MESSAGING_TOKEN: 'mtok', ADMIN_KEY: 'akey', ...extra };
}
function req(method, path, { token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`https://manicbot.com${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
}
const u = (path) => new URL(`https://manicbot.com${path}`);

describe('tryMessagingRoutes auth', () => {
  it('returns null for non-messaging paths', async () => {
    const res = await tryMessagingRoutes(req('GET', '/admin/other', { token: 'mtok' }), makeEnv(), u('/admin/other'));
    expect(res).toBeNull();
  });

  it('403 without a valid token', async () => {
    const res = await tryMessagingRoutes(req('GET', '/admin/messaging/drafts', { token: 'wrong' }), makeEnv(), u('/admin/messaging/drafts'));
    expect(res.status).toBe(403);
  });

  it('accepts MESSAGING_TOKEN and ADMIN_KEY', async () => {
    for (const token of ['mtok', 'akey']) {
      const res = await tryMessagingRoutes(req('GET', '/admin/messaging/drafts', { token }), makeEnv(), u('/admin/messaging/drafts'));
      expect(res.status).toBe(200);
    }
  });
});

describe('holidays-upsert', () => {
  it('inserts then updates the same (occasion_key, date) idempotently', async () => {
    const env = makeEnv();
    const rows = [{ date: '2026-03-08', occasion_key: 'womens_day', name_pl: 'Dzień Kobiet', name_ru: '8 Марта', type: 'commercial' }];
    const r1 = await tryMessagingRoutes(req('POST', '/admin/messaging/holidays-upsert', { token: 'mtok', body: { rows } }), env, u('/admin/messaging/holidays-upsert'));
    expect((await r1.json()).upserted).toBe(1);
    await tryMessagingRoutes(req('POST', '/admin/messaging/holidays-upsert', { token: 'mtok', body: { rows } }), env, u('/admin/messaging/holidays-upsert'));
    const all = (await db.prepare('SELECT * FROM holiday_calendar').bind().all()).results;
    expect(all.length).toBe(1); // upsert, not duplicate
  });
});

describe('template-draft + campaign-draft + approve + drafts', () => {
  it('creates a draft template, lists it, and a draft campaign', async () => {
    const env = makeEnv();
    await tryMessagingRoutes(req('POST', '/admin/messaging/template-draft', {
      token: 'mtok',
      body: { template_key: 'seasonal_womens_day', locale: 'pl', name: 'Dzień Kobiet', category: 'seasonal', channels: ['center'], bodies: { center: 'Wszystkiego najlepszego {salon_name}' }, variables: ['salon_name'] },
    }), env, u('/admin/messaging/template-draft'));

    const campRes = await tryMessagingRoutes(req('POST', '/admin/messaging/campaign-draft', {
      token: 'mtok',
      body: { occasion_key: 'womens_day', template_key: 'seasonal_womens_day', title: 'Dzień Kobiet', bodies: { center: 'x' }, scheduled_at: Math.floor(Date.parse('2026-03-08') / 1000) },
    }), env, u('/admin/messaging/campaign-draft'));
    const camp = await campRes.json();
    expect(camp.ok).toBe(true);
    expect(camp.created).toBe(true);

    const drafts = await (await tryMessagingRoutes(req('GET', '/admin/messaging/drafts', { token: 'mtok' }), env, u('/admin/messaging/drafts'))).json();
    expect(drafts.templates.length).toBe(1);
    expect(drafts.campaigns.length).toBe(1);

    // approve the campaign → leaves draft listing
    await tryMessagingRoutes(req('POST', '/admin/messaging/approve', { token: 'mtok', body: { id: camp.id, status: 'active' } }), env, u('/admin/messaging/approve'));
    const drafts2 = await (await tryMessagingRoutes(req('GET', '/admin/messaging/drafts', { token: 'mtok' }), env, u('/admin/messaging/drafts'))).json();
    expect(drafts2.campaigns.length).toBe(0);
  });

  it('dedupes a second campaign-draft for the same occasion + year', async () => {
    const env = makeEnv();
    const body = { occasion_key: 'valentines', title: 'Walentynki', bodies: { center: 'x' }, scheduled_at: Math.floor(Date.parse('2026-02-14') / 1000) };
    const r1 = await (await tryMessagingRoutes(req('POST', '/admin/messaging/campaign-draft', { token: 'mtok', body }), env, u('/admin/messaging/campaign-draft'))).json();
    const r2 = await (await tryMessagingRoutes(req('POST', '/admin/messaging/campaign-draft', { token: 'mtok', body }), env, u('/admin/messaging/campaign-draft'))).json();
    expect(r1.created).toBe(true);
    expect(r2.deduped).toBe(true);
    expect(r2.id).toBe(r1.id);
  });

  it('rejects template-draft without template_key', async () => {
    const env = makeEnv();
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/template-draft', { token: 'mtok', body: { locale: 'pl' } }), env, u('/admin/messaging/template-draft'));
    expect(res.status).toBe(400);
  });
});

describe('promo-mint', () => {
  it('delegates to mintSeasonalPromo and returns the code', async () => {
    const env = makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' });
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/promo-mint', {
      token: 'mtok', body: { campaign_id: 'pc_1', code: 'WIOSNA20', percent_off: 20, expires_days: 14 },
    }), env, u('/admin/messaging/promo-mint'));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.promo.code).toBe('WIOSNA20');
  });
});
