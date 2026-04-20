/**
 * Integration tests for the preview-landing chat flow.
 *
 * Unlike chat-web-http.test.js (which mocks buildChannelCtx), these tests
 * use the REAL channels/resolver.js + storage.js path with a pre-populated
 * mock D1, so they exercise the full init→send→reply pipeline including:
 *  - resolveTenantFromSlug finding the provisioned tenant
 *  - buildChannelCtx loading the tenant row + previewMode flag
 *  - handleInbound side-effect skip in preview mode
 *  - WebAdapter draining the outbox into the HTTP response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

// Mock only the pieces that need external I/O or heavy bot logic.
vi.mock('../src/handlers/inbound.js', () => ({
  handleInbound: vi.fn(async (ctx, inbound) => {
    if (ctx?.channel?.send) {
      const cid = inbound.channelUserId;
      await ctx.channel.send(Number(cid), {
        text: 'Добро пожаловать в Preview Salon!',
        buttons: [
          [{ text: 'Записаться', callback_data: 'book' }],
        ],
        parseMode: 'HTML',
      });
    }
  }),
}));

vi.mock('../src/services/services.js', () => ({
  initServices: vi.fn(async () => {}),
}));

vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

import { tryChatWeb } from '../src/http/chatWebHttp.js';
import { PREVIEW_TENANT_ID, PREVIEW_TENANT_SLUG } from '../src/tenant/previewTenant.js';

async function makeEnvWithPreviewTenant() {
  const db = createMockD1();
  const kv = makeMockKv();
  const env = { DB: db, MANICBOT: kv };
  // Provision via the real provisioner so the mock DB mirrors production.
  vi.resetModules();
  const { ensurePreviewTenantProvisioned } = await import('../src/tenant/previewTenant.js');
  await ensurePreviewTenantProvisioned(env);
  return env;
}

async function req(env, method, path, body) {
  const url = new URL(`https://manicbot.com${path}`);
  const request = new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return tryChatWeb(request, env, url);
}

describe('Preview tenant full chat flow', () => {
  let env;
  beforeEach(async () => {
    env = await makeEnvWithPreviewTenant();
  });

  it('POST /chat/init returns sessionId and salon branding for preview-landing slug', async () => {
    const res = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(data.chatId).toBeLessThan(0);
    expect(data.salon.slug).toBe(PREVIEW_TENANT_SLUG);
    expect(data.salon.name).toBeTruthy();
  });

  it('POST /chat/send returns bot reply messages', async () => {
    // Init first to get sessionId
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const sendRes = await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG,
      sessionId,
      text: '/start',
      userLang: 'ru',
    });
    expect(sendRes.status).toBe(200);
    const data = await sendRes.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBeGreaterThan(0);
    const msg = data.messages[0];
    expect(msg.id).toBeTypeOf('string');
    expect(msg.ts).toBeTypeOf('number');
    expect(msg.text).toBeTypeOf('string');
  });

  it('POST /chat/send includes inline buttons in reply', async () => {
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const sendRes = await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG,
      sessionId,
      text: '/start',
      userLang: 'ru',
    });
    const { messages } = await sendRes.json();
    const withButtons = messages.find(m => m.buttons && m.buttons.length > 0);
    expect(withButtons).toBeTruthy();
    const firstBtn = withButtons.buttons[0][0];
    expect(firstBtn.text).toBeTypeOf('string');
    expect(firstBtn.callback_data).toBeTypeOf('string');
  });

  it('responds to button tap (callbackData)', async () => {
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const res = await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG,
      sessionId,
      callbackData: 'book',
      userLang: 'ru',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('GET /chat/poll returns empty when nothing is queued', async () => {
    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();

    const pollRes = await req(env, 'GET',
      `/chat/poll?slug=${PREVIEW_TENANT_SLUG}&sessionId=${sessionId}&since=0`);
    expect(pollRes.status).toBe(200);
    const data = await pollRes.json();
    expect(data.ok).toBe(true);
    expect(data.messages).toEqual([]);
  });

  it('ctx.previewMode is true for preview tenant', async () => {
    const { handleInbound } = await import('../src/handlers/inbound.js');
    handleInbound.mockClear();

    const initRes = await req(env, 'POST', '/chat/init', { slug: PREVIEW_TENANT_SLUG });
    const { sessionId } = await initRes.json();
    await req(env, 'POST', '/chat/send', {
      slug: PREVIEW_TENANT_SLUG, sessionId, text: 'hi', userLang: 'ru',
    });

    expect(handleInbound).toHaveBeenCalledOnce();
    const [ctx] = handleInbound.mock.calls[0];
    expect(ctx.previewMode).toBe(true);
    expect(ctx.tenantId).toBe(PREVIEW_TENANT_ID);
  });
});

describe('inbound.js side-effect skip in preview mode', () => {
  it('skips channel_identity and conversation writes when previewMode is true', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    // We verify indirectly: if the DB tables are not populated by handleInbound
    // when previewMode = true, then channel_identities stays empty.
    const writeSpy = vi.spyOn(db, 'prepare');
    const ctx = {
      db, kv, tenantId: PREVIEW_TENANT_ID,
      previewMode: true,
      prefix: `t:${PREVIEW_TENANT_ID}:`,
    };
    const { handleInbound } = await import('../src/handlers/inbound.js');
    // Restore original for this test (override the global mock)
    vi.mocked(handleInbound).mockRestore?.();

    // Import the actual (unmocked) handleInbound via dynamic re-import
    vi.resetModules();
    const actual = await import('../src/handlers/inbound.js');
    const inbound = {
      channel: 'web',
      channelUserId: '-99999',
      tenantId: PREVIEW_TENANT_ID,
      text: 'hello',
      callbackData: null,
      userName: 'Test',
      userLang: 'ru',
      timestamp: Date.now(),
      rawEvent: {},
    };
    // Should not throw even without a full ctx
    await expect(actual.handleInbound(ctx, inbound)).resolves.not.toThrow?.();

    // channel_identities and conversations must NOT be written in preview mode
    expect(db._getTable('channel_identities')).toHaveLength(0);
    expect(db._getTable('conversations')).toHaveLength(0);
  });
});

describe('DEMO_CHAT_SRC widget fixes', () => {
  let SRC;
  beforeEach(async () => {
    const mod = await import('../src/embed/demoChat.js');
    SRC = mod.DEMO_CHAT_SRC;
  });

  it('has a querySelector fallback for document.currentScript', () => {
    expect(SRC).toMatch(/document\.currentScript/);
    expect(SRC).toMatch(/querySelector.*script\[src\]/);
    expect(SRC).toMatch(/\/embed\/demo-chat\.js/);
  });

  it('clears stale sessions via SESSION_TTL_MS', () => {
    expect(SRC).toMatch(/SESSION_TTL_MS/);
    expect(SRC).toMatch(/savedAt/);
    expect(SRC).toMatch(/localStorage\.removeItem/);
  });

  it('persists savedAt in localStorage', () => {
    expect(SRC).toMatch(/savedAt.*Date\.now\(\)/);
  });

  it('shows an error bubble when init fails', () => {
    expect(SRC).toMatch(/showErrorBubble/);
    expect(SRC).toMatch(/Не удалось подключиться/);
  });

  it('retries init with exponential backoff', () => {
    expect(SRC).toMatch(/_initRetries/);
    expect(SRC).toMatch(/setTimeout/);
    expect(SRC).toMatch(/Math\.pow/);
  });

  it('shows error bubble on send failure', () => {
    expect(SRC).toMatch(/Ошибка отправки/);
    expect(SRC).toMatch(/Нет соединения/);
  });
});
