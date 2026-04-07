import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the business-logic handlers so the test focuses on HTTP plumbing.
vi.mock('../src/handlers/inbound.js', () => ({
  handleInbound: vi.fn(async (ctx, inbound) => {
    // Simulate the bot producing two outbound messages during processing.
    if (ctx?.channel?.send) {
      await ctx.channel.send(inbound.channelUserId, {
        text: `echo: ${inbound.text ?? inbound.callbackData ?? ''}`,
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

// Mock buildChannelCtx so we don't need to stub getTenant/getBot etc.
vi.mock('../src/channels/resolver.js', async () => {
  const actual = await vi.importActual('../src/channels/resolver.js');
  return {
    ...actual,
    buildChannelCtx: vi.fn(async (env, tenantId, channelConfig, channelAdapter) => {
      const ctx = {
        db: env.DB,
        kv: env.MANICBOT,
        tenantId,
        channelConfig,
        channel: channelAdapter,
      };
      channelAdapter._ctx = ctx;
      return ctx;
    }),
  };
});

import { tryChatWeb } from '../src/http/chatWebHttp.js';

function makeDb({ tenant = null } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              if (sql.includes('FROM tenants')) {
                if (!tenant) return { results: [] };
                return { results: [tenant] };
              }
              return { results: [] };
            },
            async first() { return null; },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
}

function makeKv() {
  const store = new Map();
  return {
    _store: store,
    async get(key, type) {
      const v = store.get(key);
      if (!v) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function makeEnv(opts = {}) {
  const tenantRow = opts.tenant ?? {
    id: 't_demo',
    name: 'Demo Salon',
    display_name: 'Demo',
    logo: 'https://example.com/logo.png',
    cover_photo: null,
    brand_palette: '{"primary":"#EC4899"}',
    slug: 'demo',
    description: 'Best salon',
    city: 'Warsaw',
    public_active: 1,
  };
  return {
    DB: makeDb({ tenant: tenantRow }),
    MANICBOT: makeKv(),
    ADMIN_CHAT_ID: null,
  };
}

async function request(env, method, path, body) {
  const req = new Request(`https://manicbot.com${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return tryChatWeb(req, env, new URL(req.url));
}

describe('POST /chat/init', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns sessionId + salon branding for a valid slug', async () => {
    const res = await request(env, 'POST', '/chat/init', { slug: 'demo' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(data.chatId).toBeTypeOf('number');
    expect(data.chatId).toBeLessThan(0);
    expect(data.salon).toMatchObject({
      slug: 'demo',
      name: 'Demo', // display_name overrides name
      legalName: 'Demo Salon',
      logo: 'https://example.com/logo.png',
      brandPalette: { primary: '#EC4899' },
      city: 'Warsaw',
    });
  });

  it('returns name when display_name is missing', async () => {
    env = makeEnv({
      tenant: {
        id: 't_demo',
        name: 'Demo Salon',
        display_name: null,
        logo: null,
        cover_photo: null,
        brand_palette: null,
        slug: 'demo',
        description: null,
        city: null,
        public_active: 1,
      },
    });
    const res = await request(env, 'POST', '/chat/init', { slug: 'demo' });
    const data = await res.json();
    expect(data.salon.name).toBe('Demo Salon');
    expect(data.salon.brandPalette).toBeNull();
  });

  it('returns 404 for unknown slug', async () => {
    env.DB = makeDb({ tenant: null });
    const res = await request(env, 'POST', '/chat/init', { slug: 'nope' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when slug is missing', async () => {
    const res = await request(env, 'POST', '/chat/init', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /chat/send', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('routes the message through handleInbound and returns the reply', async () => {
    const res = await request(env, 'POST', '/chat/send', {
      slug: 'demo',
      sessionId: 'abcdef0123456789abcdef0123456789',
      text: 'Hello bot',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].text).toBe('echo: Hello bot');
  });

  it('accepts callbackData without text', async () => {
    const res = await request(env, 'POST', '/chat/send', {
      slug: 'demo',
      sessionId: 'abcdef0123456789abcdef0123456789',
      callbackData: 'BOOK',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages[0].text).toBe('echo: BOOK');
  });

  it('requires either text or callbackData', async () => {
    const res = await request(env, 'POST', '/chat/send', {
      slug: 'demo',
      sessionId: 'abcdef0123456789abcdef0123456789',
    });
    expect(res.status).toBe(400);
  });

  it('rejects short sessionIds', async () => {
    const res = await request(env, 'POST', '/chat/send', {
      slug: 'demo',
      sessionId: 'short',
      text: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown salon', async () => {
    env.DB = makeDb({ tenant: null });
    const res = await request(env, 'POST', '/chat/send', {
      slug: 'ghost',
      sessionId: 'abcdef0123456789abcdef0123456789',
      text: 'hi',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /chat/poll', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns empty messages when nothing is queued', async () => {
    const sid = 'abcdef0123456789abcdef0123456789';
    const res = await request(env, 'GET', `/chat/poll?slug=demo&sessionId=${sid}&since=0`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.messages).toEqual([]);
  });

  it('rejects poll without sessionId', async () => {
    const res = await request(env, 'GET', `/chat/poll?slug=demo`);
    expect(res.status).toBe(400);
  });
});

describe('CORS preflight', () => {
  it('returns 204 with CORS headers', async () => {
    const env = makeEnv();
    const req = new Request('https://manicbot.com/chat/send', { method: 'OPTIONS' });
    const res = await tryChatWeb(req, env, new URL(req.url));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('Unrelated paths', () => {
  it('returns null so the main dispatcher can continue', async () => {
    const env = makeEnv();
    const req = new Request('https://manicbot.com/webhook/123');
    const res = await tryChatWeb(req, env, new URL(req.url));
    expect(res).toBeNull();
  });
});
