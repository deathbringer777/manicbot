import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'a'.repeat(48);

function makeDb(initialState = {}) {
  const state = {
    slots: initialState.slots ?? [],
    counts: initialState.counts ?? [],
    updates: [],
  };
  const makeRunnable = (sql, args = []) => ({
    all: async () => {
      if (/GROUP BY status/i.test(sql)) return { results: state.counts };
      if (/marketing_content_plan/i.test(sql)) return { results: state.slots };
      return { results: [] };
    },
    first: async () => {
      if (/marketing_content_plan/i.test(sql) && /WHERE id = \?/i.test(sql)) {
        const id = args[0];
        return state.slots.find((s) => s.id === id) || null;
      }
      return null;
    },
    run: async () => {
      state.updates.push({ sql, args });
      return { meta: { changes: 1 } };
    },
  });
  return {
    state,
    prepare: vi.fn().mockImplementation((sql) => ({
      bind: (...args) => makeRunnable(sql, args),
      ...makeRunnable(sql, []),
    })),
  };
}

function makeEnv(overrides = {}) {
  return {
    ADMIN_KEY,
    DB: makeDb(),
    AI: { run: vi.fn() },
    MARKETING_ASSETS: { put: vi.fn() },
    MARKETING_ASSETS_PUBLIC_URL: 'https://pub-abc.r2.dev',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MARKETING_IG_PAGE_ID: 'page_x',
    MARKETING_IG_ACCESS_TOKEN: 'EAA_x',
    MARKETING_AUTOPILOT_ENABLED: '0',
    ...overrides,
  };
}

function makeRequest(method, path, { auth = `Bearer ${ADMIN_KEY}`, body, search = '' } = {}) {
  const headers = new Headers();
  if (auth) headers.set('Authorization', auth);
  if (body) headers.set('Content-Type', 'application/json');
  return new Request(`https://manicbot.com${path}${search}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /admin/marketing-tick', () => {
  it('rejects without admin key', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/marketing-tick', { auth: 'Bearer wrong' });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('runs autopilot phase and returns processed count', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/marketing-tick');
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.processed).toBe('number');
  });
});

describe('POST /admin/marketing-publish-one', () => {
  it('rejects without admin key', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/marketing-publish-one', {
      auth: 'Bearer wrong',
      search: '?slot_id=x',
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects missing slot_id param', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/marketing-publish-one');
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/slot_id/);
  });

  it('returns 404 for unknown slot', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/marketing-publish-one', {
      search: '?slot_id=missing',
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(404);
  });

  it('processes existing slot and returns refreshed row', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 'slot_known',
      scheduled_at: nowSec + 1000,
      theme: 'inspiration',
      topic: 'X',
      key_message: null,
      headline_pl: null,
      caption_pl: null,
      hashtags_json: null,
      image_url: null,
      image_prompt: null,
      status: 'pending',
      error_count: 0,
    };
    const env = makeEnv({ DB: makeDb({ slots: [slot] }) });
    const req = makeRequest('POST', '/admin/marketing-publish-one', {
      search: '?slot_id=slot_known',
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.slot).toBeTruthy();
  });
});

describe('GET /admin/marketing-status', () => {
  it('rejects without admin key', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/admin/marketing-status', { auth: 'Bearer wrong' });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('returns counts + upcoming + autopilot_enabled flag', async () => {
    const env = makeEnv({
      DB: makeDb({
        counts: [
          { status: 'pending', n: 18 },
          { status: 'posted', n: 3 },
        ],
        slots: [],
      }),
      MARKETING_AUTOPILOT_ENABLED: '1',
    });
    const req = makeRequest('GET', '/admin/marketing-status');
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts).toHaveLength(2);
    expect(data.autopilot_enabled).toBe(true);
    expect(Array.isArray(data.upcoming)).toBe(true);
  });

  it('reports autopilot_enabled false when flag not "1"', async () => {
    const env = makeEnv({
      MARKETING_AUTOPILOT_ENABLED: undefined,
      DB: makeDb({ counts: [], slots: [] }),
    });
    const req = makeRequest('GET', '/admin/marketing-status');
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    const data = await res.json();
    expect(data.autopilot_enabled).toBe(false);
  });
});
