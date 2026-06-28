/**
 * Wiring test for IG comment ingestion in the Meta webhook (migration 0127).
 *
 * Comments arrive as entry[].changes[] (field 'comments'), NOT messaging[].
 * This pins that the webhook routes a comment change into social_comment_inbox.
 * The parse/dedup/own-comment logic itself is unit-tested in
 * social-comment-ingest.test.js — here we only assert the handler wiring.
 *
 * The channel token is left null so the handler skips the DM/messaging path
 * (buildChannelCtx/initServices) after ingestion — keeping the test focused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyMetaSignature: vi.fn(async () => true),
  claimMetaMessage: vi.fn(async () => true),
  resolveTenantFromInstagram: vi.fn(),
  getChannelConfig: vi.fn(),
}));

vi.mock('../src/channels/meta-verify.js', async () => {
  const actual = await vi.importActual('../src/channels/meta-verify.js');
  return { ...actual, verifyMetaSignature: mocks.verifyMetaSignature };
});
vi.mock('../src/utils/dedup.js', async () => {
  const actual = await vi.importActual('../src/utils/dedup.js');
  return { ...actual, claimMetaMessage: mocks.claimMetaMessage };
});
vi.mock('../src/channels/resolver.js', async () => {
  const actual = await vi.importActual('../src/channels/resolver.js');
  return {
    ...actual,
    resolveTenantFromInstagram: mocks.resolveTenantFromInstagram,
    getChannelConfig: mocks.getChannelConfig,
  };
});
vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));

import { tryMetaWebhooks } from '../src/http/metaWebhooksHttp.js';

const PAGE_IG = '25881183448226493';
const OWNER_IG = '25881183448226493';

function makeDb() {
  const state = { inserts: [] };
  return {
    state,
    prepare: (sql) => ({
      bind: (...args) => ({
        run: async () => {
          if (/INSERT (OR IGNORE )?INTO social_comment_inbox/i.test(sql)) state.inserts.push({ sql, args });
          return { success: true };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
  };
}

function commentWebhookRequest(value) {
  const body = JSON.stringify({
    object: 'instagram',
    entry: [{ id: PAGE_IG, time: 1, changes: [{ field: 'comments', value }] }],
  });
  return new Request('https://manicbot.com/webhook/ig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) },
    body,
  });
}

function makeEnv(db) {
  return {
    META_APP_SECRET: 'fb_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    META_VERIFY_TOKEN_IG: 'v',
    BOT_ENCRYPTION_KEY: 'x'.repeat(32),
    MANICBOT: {},
    DB: db,
  };
}

describe('IG webhook → comment ingestion wiring', () => {
  beforeEach(() => {
    mocks.verifyMetaSignature.mockResolvedValue(true);
    mocks.claimMetaMessage.mockReset().mockResolvedValue(true);
    mocks.resolveTenantFromInstagram.mockReset().mockResolvedValue({ tenantId: 't_mb', channelConfig: {} });
    // token:null → handler skips the messaging/buildChannelCtx path after ingestion
    mocks.getChannelConfig.mockReset().mockResolvedValue({ ig_business_id: OWNER_IG, token: null });
  });

  async function run(req, env) {
    const tasks = [];
    const execCtx = { waitUntil: (p) => tasks.push(p) };
    const res = await tryMetaWebhooks(req, env, new URL('https://manicbot.com/webhook/ig'), execCtx);
    await Promise.all(tasks);
    return res;
  }

  it('inserts a foreign comment into social_comment_inbox', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const res = await run(
      commentWebhookRequest({ id: 'IGC_X', text: 'Cześć', from: { id: 'USER_1', username: 'klient' }, media: { id: 'M1' } }),
      env,
    );
    expect(res?.status).toBe(200);
    expect(db.state.inserts).toHaveLength(1);
    expect(db.state.inserts[0].args).toContain('IGC_X');
    expect(mocks.claimMetaMessage).toHaveBeenCalledWith({ MANICBOT: {}, DB: db }, PAGE_IG, 'comment:IGC_X');
  });

  it('does NOT insert our own comment (from === ig_business_id)', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await run(
      commentWebhookRequest({ id: 'IGC_OWN', text: 'our reply', from: { id: OWNER_IG, username: 'manicbot_com' } }),
      env,
    );
    expect(db.state.inserts).toHaveLength(0);
  });
});
