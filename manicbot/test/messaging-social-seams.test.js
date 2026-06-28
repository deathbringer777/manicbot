/**
 * Social-automation seams on the ThinkPad → Worker bridge (/admin/messaging/*):
 *   - GET  comments-pending  — pull inbound comments awaiting a draft
 *   - POST comment-reply     — draft / escalate / skip one comment
 *   - POST social-draft      — upsert a @manicbot_com content-plan slot
 * Auth is covered by messaging-http.test.js; here we test the new handlers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';
import { tryMessagingRoutes } from '../src/http/messagingHttp.js';

let db;
beforeEach(() => { db = createMockD1(); });

function makeEnv(extra = {}) {
  return { DB: db, MESSAGING_TOKEN: 'mtok', ...extra };
}
function req(method, path, { token = 'mtok', body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`https://manicbot.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const u = (path) => new URL(`https://manicbot.com${path}`);

async function seedComment(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const r = { id: 'sci_C1', tenant_id: null, channel_type: 'instagram', media_id: 'M1', comment_id: 'C1',
    parent_id: null, from_user_id: 'U1', from_username: 'klient', text: 'Ile?', status: 'new',
    classification: null, reply_text: null, reply_comment_id: null, error: null, created_at: now, updated_at: now, ...overrides };
  await db.prepare(
    `INSERT INTO social_comment_inbox (id, tenant_id, channel_type, media_id, comment_id, parent_id, from_user_id, from_username, text, status, classification, reply_text, reply_comment_id, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(r.id, r.tenant_id, r.channel_type, r.media_id, r.comment_id, r.parent_id, r.from_user_id, r.from_username, r.text, r.status, r.classification, r.reply_text, r.reply_comment_id, r.error, r.created_at, r.updated_at).run();
  return r;
}

describe('seam: comments-pending', () => {
  it('returns only status=new rows', async () => {
    await seedComment({ id: 'sci_C1', comment_id: 'C1', status: 'new' });
    await seedComment({ id: 'sci_C2', comment_id: 'C2', status: 'drafted' });
    const res = await tryMessagingRoutes(req('GET', '/admin/messaging/comments-pending'), makeEnv(), u('/admin/messaging/comments-pending'));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.comments.map((c) => c.comment_id)).toEqual(['C1']);
  });
});

describe('seam: comment-reply', () => {
  it('drafts a reply (status new → drafted, reply_text set)', async () => {
    await seedComment();
    const res = await tryMessagingRoutes(
      req('POST', '/admin/messaging/comment-reply', { body: { comment_id: 'C1', action: 'draft', reply_text: 'Dzień dobry!', classification: 'benign' } }),
      makeEnv(), u('/admin/messaging/comment-reply'));
    expect((await res.json()).status).toBe('drafted');
    const row = (await db.prepare(`SELECT status, reply_text, classification FROM social_comment_inbox WHERE comment_id = ?`).bind('C1').all()).results[0];
    expect(row.status).toBe('drafted');
    expect(row.reply_text).toBe('Dzień dobry!');
    expect(row.classification).toBe('benign');
  });

  it('escalates without a reply', async () => {
    await seedComment();
    const res = await tryMessagingRoutes(
      req('POST', '/admin/messaging/comment-reply', { body: { comment_id: 'C1', action: 'escalate', classification: 'complaint' } }),
      makeEnv(), u('/admin/messaging/comment-reply'));
    expect((await res.json()).status).toBe('escalated');
    const row = (await db.prepare(`SELECT status FROM social_comment_inbox WHERE comment_id = ?`).bind('C1').all()).results[0];
    expect(row.status).toBe('escalated');
  });

  it('skips a comment', async () => {
    await seedComment();
    await tryMessagingRoutes(
      req('POST', '/admin/messaging/comment-reply', { body: { comment_id: 'C1', action: 'skip' } }),
      makeEnv(), u('/admin/messaging/comment-reply'));
    const row = (await db.prepare(`SELECT status FROM social_comment_inbox WHERE comment_id = ?`).bind('C1').all()).results[0];
    expect(row.status).toBe('skipped');
  });

  it('400 without comment_id', async () => {
    const res = await tryMessagingRoutes(
      req('POST', '/admin/messaging/comment-reply', { body: { action: 'draft', reply_text: 'x' } }),
      makeEnv(), u('/admin/messaging/comment-reply'));
    expect(res.status).toBe(400);
  });

  it('400 when drafting without reply_text', async () => {
    await seedComment();
    const res = await tryMessagingRoutes(
      req('POST', '/admin/messaging/comment-reply', { body: { comment_id: 'C1', action: 'draft' } }),
      makeEnv(), u('/admin/messaging/comment-reply'));
    expect(res.status).toBe(400);
  });
});

describe('seam: social-draft', () => {
  it('creates a content-plan slot, then updates it idempotently', async () => {
    const env = makeEnv();
    const body = { scheduled_at: 1_780_000_000, theme: 'product', topic: 'AI 24/7', caption_pl: 'Treść posta', hashtags: ['#ManicBot', '#beauty'] };
    const r1 = await tryMessagingRoutes(req('POST', '/admin/messaging/social-draft', { body }), env, u('/admin/messaging/social-draft'));
    const j1 = await r1.json();
    expect(j1.ok).toBe(true);
    expect(j1.created).toBe(true);

    const row = (await db.prepare(`SELECT caption_pl, status FROM marketing_content_plan WHERE id = ?`).bind(j1.id).all()).results[0];
    expect(row.caption_pl).toBe('Treść posta');
    expect(row.status).toBe('pending');

    const r2 = await tryMessagingRoutes(req('POST', '/admin/messaging/social-draft', { body: { ...body, caption_pl: 'Nowa treść' } }), env, u('/admin/messaging/social-draft'));
    const j2 = await r2.json();
    expect(j2.updated).toBe(true);
    const rows = (await db.prepare(`SELECT caption_pl FROM marketing_content_plan WHERE scheduled_at = ?`).bind(1_780_000_000).all()).results;
    expect(rows).toHaveLength(1); // upsert, not duplicate
    expect(rows[0].caption_pl).toBe('Nowa treść');
  });

  it('400 without caption_pl', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/social-draft', { body: { scheduled_at: 123 } }), makeEnv(), u('/admin/messaging/social-draft'));
    expect(res.status).toBe(400);
  });
});

async function seedSlot(status = 'awaiting_approval') {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO marketing_content_plan (id, tenant_id, scheduled_at, theme, topic, caption_pl, hashtags_json, image_url, status, error_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind('sd_plat_1780000000', null, 1_780_000_000, 'product', 'X', 'Treść', '[]', 'https://x/y.png', status, now, now).run();
}

describe('seam: social-pending + social-approve', () => {
  it('lists posts awaiting approval', async () => {
    await seedSlot('awaiting_approval');
    const res = await tryMessagingRoutes(req('GET', '/admin/messaging/social-pending'), makeEnv(), u('/admin/messaging/social-pending'));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.posts.map((p) => p.id)).toContain('sd_plat_1780000000');
  });

  it('approve flips awaiting_approval → ready and stamps approved_at', async () => {
    await seedSlot('awaiting_approval');
    const res = await tryMessagingRoutes(
      req('POST', '/admin/messaging/social-approve', { body: { id: 'sd_plat_1780000000', decision: 'approve' } }),
      makeEnv(), u('/admin/messaging/social-approve'));
    expect((await res.json()).status).toBe('ready');
    const row = (await db.prepare(`SELECT status, approved_at FROM marketing_content_plan WHERE id = ?`).bind('sd_plat_1780000000').all()).results[0];
    expect(row.status).toBe('ready');
    expect(row.approved_at).toBeGreaterThan(0);
  });

  it('skip flips awaiting_approval → paused', async () => {
    await seedSlot('awaiting_approval');
    await tryMessagingRoutes(
      req('POST', '/admin/messaging/social-approve', { body: { id: 'sd_plat_1780000000', decision: 'skip' } }),
      makeEnv(), u('/admin/messaging/social-approve'));
    const row = (await db.prepare(`SELECT status FROM marketing_content_plan WHERE id = ?`).bind('sd_plat_1780000000').all()).results[0];
    expect(row.status).toBe('paused');
  });

  it('400 without id', async () => {
    const res = await tryMessagingRoutes(req('POST', '/admin/messaging/social-approve', { body: { decision: 'approve' } }), makeEnv(), u('/admin/messaging/social-approve'));
    expect(res.status).toBe(400);
  });
});
