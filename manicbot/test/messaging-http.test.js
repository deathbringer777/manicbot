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

describe('template-approve', () => {
  it('approves every draft locale of a key in one call', async () => {
    const env = makeEnv();
    for (const loc of ['ru', 'en', 'pl']) {
      await db.prepare(
        `INSERT INTO platform_message_templates (id, name, template_key, locale, status, is_builtin, bodies_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(`t_${loc}`, loc, 'seasonal_xmas', loc, 'draft', 0, '{"center":"hi"}', 1, 1).run();
    }
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/template-approve', { token: 'mtok', body: { template_key: 'seasonal_xmas' } }), env, u('/admin/messaging/template-approve'));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.approved).toBe(3);
    const rows = (await db.prepare("SELECT status FROM platform_message_templates WHERE template_key='seasonal_xmas'").bind().all()).results;
    expect(rows.every((r) => r.status === 'approved')).toBe(true);
  });

  it('rejects without template_key', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/template-approve', { token: 'mtok', body: {} }), makeEnv(), u('/admin/messaging/template-approve'));
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

// ── tg-bot control-panel read/mutation endpoints (stats / plan / calendar /
//    reschedule / operator send-pause flag) ──

function seedCampaign(id, status, occasion, scheduledAt) {
  return db.prepare(
    "INSERT INTO platform_campaigns (id, kind, title, status, occasion_key, scheduled_at, next_run_at, created_at, updated_at) VALUES (?, 'announcement', ?, ?, ?, ?, ?, 1, 1)",
  ).bind(id, id, status, occasion, scheduledAt, scheduledAt).run();
}
function seedDelivery(id, channel, status) {
  return db.prepare(
    "INSERT INTO platform_campaign_deliveries (id, campaign_id, occurrence_key, recipient_web_user_id, tenant_id, channel, status, created_at) VALUES (?, 'pc', 'once', 'wu', 't', ?, ?, 1)",
  ).bind(id, channel, status).run();
}
const days = (n) => Math.floor(Date.now() / 1000) + n * 86400;
const isoDay = (n) => new Date((Math.floor(Date.now() / 1000) + n * 86400) * 1000).toISOString().slice(0, 10);

describe('stats', () => {
  it('aggregates campaign + delivery counts and the env send flag', async () => {
    seedCampaign('c1', 'draft', null, null);
    seedCampaign('c2', 'active', 'womens_day', days(30));
    seedCampaign('c3', 'scheduled', 'easter', days(60));
    seedDelivery('d1', 'center', 'sent');
    seedDelivery('d2', 'center', 'skipped_flag');
    seedDelivery('d3', 'bell', 'sent');
    await tryMessagingRoutes(req('POST', '/admin/messaging/template-draft', {
      token: 'mtok', body: { template_key: 'seasonal_x', locale: 'pl', name: 'X', bodies: { center: 'y' } },
    }), makeEnv(), u('/admin/messaging/template-draft'));

    const j = await (await tryMessagingRoutes(req('GET', '/admin/messaging/stats', { token: 'mtok' }), makeEnv(), u('/admin/messaging/stats'))).json();
    expect(j.ok).toBe(true);
    expect(j.send_enabled).toBe(false);
    expect(j.send_paused).toBe(false);
    expect(j.counts.draft).toBe(1);
    expect(j.counts.active).toBe(1);
    expect(j.counts.scheduled).toBe(1);
    expect(j.templates.draft).toBe(1);
    expect(j.deliveries_by_channel.center).toBe(2);
    expect(j.deliveries_by_channel.bell).toBe(1);
    expect(j.next_scheduled).toBe(days(30));
  });

  it('reports send_enabled true when MESSAGING_SEND_ENABLED=1', async () => {
    const j = await (await tryMessagingRoutes(req('GET', '/admin/messaging/stats', { token: 'mtok' }), makeEnv({ MESSAGING_SEND_ENABLED: '1' }), u('/admin/messaging/stats'))).json();
    expect(j.send_enabled).toBe(true);
  });
});

describe('plan', () => {
  it('lists scheduled campaigns ordered ascending within the day window', async () => {
    seedCampaign('p2', 'scheduled', 'b', days(5));
    seedCampaign('p1', 'active', 'a', days(1));
    seedCampaign('p3', 'draft', 'c', days(400)); // outside a 60-day window
    const j = await (await tryMessagingRoutes(req('GET', '/admin/messaging/plan?days=60', { token: 'mtok' }), makeEnv(), u('/admin/messaging/plan?days=60'))).json();
    expect(j.ok).toBe(true);
    expect(j.items.map((i) => i.id)).toEqual(['p1', 'p2']);
  });
});

describe('calendar', () => {
  it('lists upcoming holiday occasions within the window ordered by date', async () => {
    db.prepare("INSERT INTO holiday_calendar (id, date, country, occasion_key, name_pl, type, created_at, updated_at) VALUES ('h1', ?, 'PL', 'soon', 'Soon', 'commercial', 1, 1)").bind(isoDay(10)).run();
    db.prepare("INSERT INTO holiday_calendar (id, date, country, occasion_key, name_pl, type, created_at, updated_at) VALUES ('h2', ?, 'PL', 'later', 'Later', 'commercial', 1, 1)").bind(isoDay(200)).run();
    db.prepare("INSERT INTO holiday_calendar (id, date, country, occasion_key, name_pl, type, created_at, updated_at) VALUES ('h3', ?, 'PL', 'past', 'Past', 'commercial', 1, 1)").bind(isoDay(-10)).run();
    const j = await (await tryMessagingRoutes(req('GET', '/admin/messaging/calendar?days=120', { token: 'mtok' }), makeEnv(), u('/admin/messaging/calendar?days=120'))).json();
    expect(j.ok).toBe(true);
    expect(j.occasions.map((o) => o.occasion_key)).toEqual(['soon']);
  });
});

describe('reschedule', () => {
  it('updates scheduled_at and next_run_at for an active campaign', async () => {
    seedCampaign('rc', 'active', 'r', 100);
    const newAt = days(45);
    const j = await (await tryMessagingRoutes(req('POST', '/admin/messaging/reschedule', { token: 'mtok', body: { id: 'rc', scheduled_at: newAt } }), makeEnv(), u('/admin/messaging/reschedule'))).json();
    expect(j.ok).toBe(true);
    const row = (await db.prepare("SELECT scheduled_at, next_run_at FROM platform_campaigns WHERE id = 'rc'").bind().all()).results[0];
    expect(row.scheduled_at).toBe(newAt);
    expect(row.next_run_at).toBe(newAt);
  });

  it('rejects an invalid scheduled_at', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/reschedule', { token: 'mtok', body: { id: 'x', scheduled_at: -1 } }), makeEnv(), u('/admin/messaging/reschedule'));
    expect(res.status).toBe(400);
  });
});

describe('template-status', () => {
  it('approves all locales of an occasion by template_key and they leave the draft list', async () => {
    const env = makeEnv();
    for (const loc of ['ru', 'pl']) {
      await tryMessagingRoutes(req('POST', '/admin/messaging/template-draft', {
        token: 'mtok', body: { template_key: 'seasonal_xmas', locale: loc, name: `Xmas ${loc}`, bodies: { center: 'hi {salon_name}' } },
      }), env, u('/admin/messaging/template-draft'));
    }
    let drafts = await (await tryMessagingRoutes(req('GET', '/admin/messaging/drafts', { token: 'mtok' }), env, u('/admin/messaging/drafts'))).json();
    expect(drafts.templates.length).toBe(2);
    expect(drafts.templates[0].bodies_json).toBeTruthy(); // body now travels for preview

    const r = await (await tryMessagingRoutes(req('POST', '/admin/messaging/template-status', { token: 'mtok', body: { template_key: 'seasonal_xmas', status: 'approved' } }), env, u('/admin/messaging/template-status'))).json();
    expect(r.ok).toBe(true);
    expect(r.updated).toBe(2);

    drafts = await (await tryMessagingRoutes(req('GET', '/admin/messaging/drafts', { token: 'mtok' }), env, u('/admin/messaging/drafts'))).json();
    expect(drafts.templates.length).toBe(0);
  });

  it('rejects an invalid status', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/template-status', { token: 'mtok', body: { template_key: 'x', status: 'bogus' } }), makeEnv(), u('/admin/messaging/template-status'));
    expect(res.status).toBe(400);
  });
});

describe('backfill-welcomes', () => {
  it('backdates a welcome to registration for owners missing one, idempotently', async () => {
    const env = makeEnv();
    db.prepare("INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, channels_json, status, created_at, updated_at) VALUES ('sys_welcome','welcome','Welcome','',?,?,'active',1,1)")
      .bind(JSON.stringify({ center: { ru: 'Здравствуйте, {salon_name}!', pl: 'Witaj, {salon_name}!' } }), JSON.stringify(['center', 'bell'])).run();
    db.prepare("INSERT INTO tenants (id, name, created_at, is_test) VALUES ('t1','Salon A',1000,0)").bind().run();
    db.prepare("INSERT INTO tenants (id, name, created_at, is_test) VALUES ('t2','Salon B',2000,0)").bind().run();
    db.prepare("INSERT INTO web_users (id, tenant_id, role, email, lang) VALUES ('wu1','t1','tenant_owner','a@x.com','pl')").bind().run();
    db.prepare("INSERT INTO web_users (id, tenant_id, role, email, lang) VALUES ('wu2','t2','tenant_owner','b@x.com','ru')").bind().run();
    // wu2 was already welcomed (ledger claim exists) → must be skipped.
    db.prepare("INSERT INTO platform_campaign_deliveries (id, campaign_id, occurrence_key, recipient_web_user_id, tenant_id, channel, status, created_at) VALUES ('pcd_x','sys_welcome','once','wu2','t2','center','sent',1)").bind().run();

    const r = await (await tryMessagingRoutes(req('POST', '/admin/messaging/backfill-welcomes', { token: 'mtok' }), env, u('/admin/messaging/backfill-welcomes'))).json();
    expect(r.ok).toBe(true);
    expect(r.backfilled).toBe(1);
    expect(r.skipped).toBe(1);

    const msgs = (await db.prepare('SELECT thread_id, body, created_at FROM platform_thread_messages').bind().all()).results;
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toContain('Witaj'); // PL body picked from web_users.lang
    expect(msgs[0].body).toContain('Salon A'); // personalized
    expect(msgs[0].body).not.toContain('Здравствуйте'); // not the RU body
    expect(msgs[0].created_at).toBe(1000); // dated at registration, not now
    const led = (await db.prepare("SELECT status FROM platform_campaign_deliveries WHERE recipient_web_user_id='wu1'").bind().all()).results;
    expect(led.some((d) => d.status === 'sent')).toBe(true);
  });

  it('rejects when the welcome singleton is not active', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/backfill-welcomes', { token: 'mtok' }), makeEnv(), u('/admin/messaging/backfill-welcomes'));
    expect(res.status).toBe(400);
  });
});

describe('flag (operator send pause)', () => {
  it('persists the pause flag and reflects it in stats', async () => {
    const env = makeEnv();
    await tryMessagingRoutes(req('POST', '/admin/messaging/flag', { token: 'mtok', body: { paused: true } }), env, u('/admin/messaging/flag'));
    const s1 = await (await tryMessagingRoutes(req('GET', '/admin/messaging/stats', { token: 'mtok' }), env, u('/admin/messaging/stats'))).json();
    expect(s1.send_paused).toBe(true);
    await tryMessagingRoutes(req('POST', '/admin/messaging/flag', { token: 'mtok', body: { paused: false } }), env, u('/admin/messaging/flag'));
    const s2 = await (await tryMessagingRoutes(req('GET', '/admin/messaging/stats', { token: 'mtok' }), env, u('/admin/messaging/stats'))).json();
    expect(s2.send_paused).toBe(false);
  });
});

// ── message-retract (purge a broadcast/message + recompute thread headers) ──

function seedThread(id, lastAt, preview, sender) {
  return db.prepare(
    'INSERT INTO platform_threads (id, recipient_web_user_id, recipient_tenant_id, last_message_at, last_message_preview, last_sender_kind, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1)',
  ).bind(id, `wu_${id}`, `t_${id}`, lastAt, preview, sender).run();
}
function seedMsg(id, threadId, body, broadcastId, createdAt, sender = 'platform') {
  return db.prepare(
    "INSERT INTO platform_thread_messages (id, thread_id, sender_kind, sender_web_user_id, body, broadcast_id, created_at) VALUES (?, ?, ?, 'system', ?, ?, ?)",
  ).bind(id, threadId, sender, body, broadcastId, createdAt).run();
}
function seedBroadcastAudit(id) {
  return db.prepare(
    "INSERT INTO platform_broadcasts (id, sender_web_user_id, title, body, audience_filter_json, recipients_count, created_at) VALUES (?, 'admin', NULL, 'тест', '{\"scope\":\"all\"}', 2, 100)",
  ).bind(id).run();
}
const threadRow = async (id) =>
  (await db.prepare(`SELECT * FROM platform_threads WHERE id = '${id}'`).bind().all()).results[0];
const retract = (body) =>
  tryMessagingRoutes(req('POST', '/admin/messaging/message-retract', { token: 'mtok', body }), makeEnv(), u('/admin/messaging/message-retract'));

describe('message-retract', () => {
  it('403 without a valid token', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/message-retract', { token: 'wrong', body: { broadcast_id: 'bcX' } }), makeEnv(), u('/admin/messaging/message-retract'));
    expect(res.status).toBe(403);
  });

  it('400 when neither broadcast_id nor message_id is given', async () => {
    const res = await retract({});
    expect(res.status).toBe(400);
  });

  it('removes every copy of a broadcast and deletes its audit row', async () => {
    // Thread A keeps a newer non-broadcast message; thread B is "тест"-only.
    seedThread('pt_A', 100, 'тест', 'platform');
    seedThread('pt_B', 100, 'тест', 'platform');
    seedMsg('m_a_old', 'pt_A', 'тест', 'bcX', 100);
    seedMsg('m_a_new', 'pt_A', 'новое', null, 200);
    seedMsg('m_b', 'pt_B', 'тест', 'bcX', 100);
    seedBroadcastAudit('bcX');

    const j = await (await retract({ broadcast_id: 'bcX' })).json();
    expect(j.ok).toBe(true);
    expect(j.removed).toBe(2);
    expect(j.threads_touched).toBe(2);

    const remaining = (await db.prepare("SELECT id FROM platform_thread_messages WHERE broadcast_id = 'bcX'").bind().all()).results;
    expect(remaining.length).toBe(0);
    const audit = (await db.prepare("SELECT id FROM platform_broadcasts WHERE id = 'bcX'").bind().all()).results;
    expect(audit.length).toBe(0);
  });

  it('recomputes the header to the newest remaining message (newer-message case)', async () => {
    seedThread('pt_A', 100, 'тест', 'platform');
    seedMsg('m_a_old', 'pt_A', 'тест', 'bcX', 100);
    seedMsg('m_a_new', 'pt_A', 'новое объявление', null, 200, 'platform');
    await retract({ broadcast_id: 'bcX' });
    const a = await threadRow('pt_A');
    expect(a.last_message_at).toBe(200);
    expect(a.last_message_preview).toBe('новое объявление');
    expect(a.last_sender_kind).toBe('platform');
  });

  it('nulls the header when no message remains (empty case)', async () => {
    seedThread('pt_B', 100, 'тест', 'platform');
    seedMsg('m_b', 'pt_B', 'тест', 'bcX', 100);
    await retract({ broadcast_id: 'bcX' });
    const b = await threadRow('pt_B');
    expect(b.last_message_at).toBe(null);
    expect(b.last_message_preview).toBe(null);
    expect(b.last_sender_kind).toBe(null);
  });

  it('is idempotent — a second retract removes nothing and does not throw', async () => {
    seedThread('pt_B', 100, 'тест', 'platform');
    seedMsg('m_b', 'pt_B', 'тест', 'bcX', 100);
    seedBroadcastAudit('bcX');
    const j1 = await (await retract({ broadcast_id: 'bcX' })).json();
    expect(j1.removed).toBe(1);
    const j2 = await (await retract({ broadcast_id: 'bcX' })).json();
    expect(j2.ok).toBe(true);
    expect(j2.removed).toBe(0);
    expect(j2.threads_touched).toBe(0);
  });

  it('unknown broadcast_id → 0 removed, no throw', async () => {
    const j = await (await retract({ broadcast_id: 'nope' })).json();
    expect(j.ok).toBe(true);
    expect(j.removed).toBe(0);
    expect(j.threads_touched).toBe(0);
  });

  it('retract by message_id removes one copy and recomputes its thread', async () => {
    seedThread('pt_C', 200, 'newer', 'platform');
    seedMsg('m_c1', 'pt_C', 'older', null, 100, 'platform');
    seedMsg('m_c2', 'pt_C', 'newer', null, 200, 'platform');
    const j = await (await retract({ message_id: 'm_c2' })).json();
    expect(j.ok).toBe(true);
    expect(j.removed).toBe(1);
    expect(j.threads_touched).toBe(1);
    const c = await threadRow('pt_C');
    expect(c.last_message_at).toBe(100);
    expect(c.last_message_preview).toBe('older');
    const left = (await db.prepare('SELECT id FROM platform_thread_messages WHERE thread_id = ?').bind('pt_C').all()).results;
    expect(left.map((r) => r.id)).toEqual(['m_c1']);
  });
});
