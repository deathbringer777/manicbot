import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  phaseInstagramAutopilot,
  processSlot,
  getIgCredentials,
} from '../../src/marketing/autopilot.js';

// getIgCredentials falls back to the marketing channel_config and decrypts the
// token server-side. Mock the resolver so this unit test asserts the fallback
// wiring (priority + id/token mapping), not the crypto itself.
vi.mock('../../src/channels/resolver.js', () => ({ getChannelConfig: vi.fn() }));
import { getChannelConfig } from '../../src/channels/resolver.js';

const PAGE_ID = '1008301152373103';
const TOKEN = 'EAA-test-token';
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function base64Of(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function makeDb(initialState = {}) {
  const state = {
    slots: initialState.slots ?? [],
    queue: initialState.queue ?? [],
    updates: [],
    inserts: [],
  };
  const fakeStmt = (sql) => {
    return {
      bind: (...args) => ({
        all: async () => {
          if (/FROM marketing_content_plan/i.test(sql) && /SELECT/i.test(sql)) {
            return { results: state.slots };
          }
          return { results: [] };
        },
        first: async () => {
          if (/FROM marketing_publish_queue/i.test(sql) && /SELECT/i.test(sql)) {
            return state.queue.find((q) => q.content_plan_id === args[0]) || null;
          }
          return null;
        },
        run: async () => {
          if (/^UPDATE marketing_content_plan/i.test(sql.trim())) {
            state.updates.push({ table: 'mcp', sql, args });
          } else if (/^UPDATE marketing_publish_queue/i.test(sql.trim())) {
            state.updates.push({ table: 'mpq', sql, args });
          } else if (/INSERT (OR REPLACE )?INTO marketing_publish_queue/i.test(sql)) {
            state.inserts.push({ table: 'mpq', sql, args });
            state.queue.push({
              id: args[0],
              content_plan_id: args[1],
              page_id: args[2],
              meta_container_id: args[3],
              status: 'container_created',
            });
          } else {
            state.updates.push({ table: 'other', sql, args });
          }
          return { meta: { changes: 1 } };
        },
      }),
    };
  };
  return {
    state,
    prepare: vi.fn().mockImplementation((sql) => fakeStmt(sql)),
  };
}

function makeEnv({ db, ig = true, ai = true, anthropic = true, r2 = true } = {}) {
  return {
    DB: db ?? makeDb(),
    AI: ai
      ? { run: vi.fn().mockResolvedValue({ image: base64Of(PNG_HEADER) }) }
      : undefined,
    MARKETING_ASSETS: r2 ? { put: vi.fn().mockResolvedValue(undefined) } : undefined,
    MARKETING_ASSETS_PUBLIC_URL: r2 ? 'https://pub-abc.r2.dev' : undefined,
    ANTHROPIC_API_KEY: anthropic ? 'sk-ant-test' : undefined,
    MARKETING_IG_PAGE_ID: ig ? PAGE_ID : undefined,
    MARKETING_IG_ACCESS_TOKEN: ig ? TOKEN : undefined,
  };
}

const VALID_CAPTION = {
  headline_pl: 'Tracisz 30% rezerwacji',
  caption_pl:
    'Twój salon zarabia mniej niż mógłby. Klienci piszą wieczorem, Ty odpisujesz rano — i tracisz ich. ManicBot odpowiada w 2 sekundy. Sprawdź manicbot.com 💅',
  hashtags: [
    '#ManicBot', '#paznokciewarszawa', '#salonpiekności', '#beautytech',
    '#rezerwacjaonline', '#warszawabeauty', '#manicurewarszawa',
    '#automatyzacja', '#salonurody', '#biznesbeauty',
  ],
  image_prompt_visual: 'A smartphone showing chat with AI assistant',
};

function mockAnthropicFetch(captionOut = VALID_CAPTION) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(captionOut) }],
      usage: { input_tokens: 100, output_tokens: 100 },
    }),
    text: async () => '',
  });
}

function mockMetaFetch(map) {
  // map: { '/PAGE/media': { ok, status, body } }
  return vi.fn().mockImplementation(async (url, _init) => {
    for (const [pattern, resp] of Object.entries(map)) {
      if (url.includes(pattern)) {
        return {
          ok: resp.ok,
          status: resp.status ?? (resp.ok ? 200 : 400),
          json: async () => resp.body,
          text: async () => JSON.stringify(resp.body),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }), text: async () => '' };
  });
}

// Phase 2 cleanup: vi.stubGlobal + unstubAllGlobals — no manual save/restore.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marketing/autopilot — getIgCredentials', () => {
  beforeEach(() => getChannelConfig.mockReset());

  it('returns null when nothing is configured', async () => {
    expect(await getIgCredentials({})).toBeNull();
    expect(await getIgCredentials({ MARKETING_IG_PAGE_ID: 'p' })).toBeNull();
    expect(await getIgCredentials({ MARKETING_IG_ACCESS_TOKEN: 't' })).toBeNull();
  });

  it('returns the Worker secrets when both are set (no channel_configs read)', async () => {
    const creds = await getIgCredentials({ MARKETING_IG_PAGE_ID: 'p', MARKETING_IG_ACCESS_TOKEN: 't' });
    expect(creds).toEqual({ pageId: 'p', token: 't' });
    expect(getChannelConfig).not.toHaveBeenCalled();
  });

  it('falls back to the marketing channel_config (decrypted) when secrets absent', async () => {
    getChannelConfig.mockResolvedValue({
      token: 'IGAA-decrypted-token',
      ig_business_id: '25881183448226493',
      config: { api: 'instagram_direct', ig_user_id: '25881183448226493' },
    });
    const creds = await getIgCredentials({
      DB: { __db: true },
      BOT_ENCRYPTION_KEY: 'x'.repeat(32),
      MARKETING_IG_TENANT_ID: 't_1c305v2g5011',
    });
    expect(creds).toEqual({ pageId: '25881183448226493', token: 'IGAA-decrypted-token' });
    expect(getChannelConfig).toHaveBeenCalledWith(
      { db: { __db: true } }, 't_1c305v2g5011', 'instagram', 'x'.repeat(32), null,
    );
  });

  it('returns null when fallback configured but channel has no token', async () => {
    getChannelConfig.mockResolvedValue({ token: null });
    const creds = await getIgCredentials({
      DB: { __db: true }, BOT_ENCRYPTION_KEY: 'x'.repeat(32), MARKETING_IG_TENANT_ID: 't_x',
    });
    expect(creds).toBeNull();
  });

  it('does not read channel_configs without a tenant id or enc key', async () => {
    expect(await getIgCredentials({ DB: { __db: true }, BOT_ENCRYPTION_KEY: 'x'.repeat(32) })).toBeNull();
    expect(await getIgCredentials({ DB: { __db: true }, MARKETING_IG_TENANT_ID: 't_x' })).toBeNull();
    expect(getChannelConfig).not.toHaveBeenCalled();
  });
});

describe('marketing/autopilot — phaseInstagramAutopilot (top-level)', () => {
  it('returns processed:0 when no DB binding', async () => {
    const r = await phaseInstagramAutopilot({});
    expect(r.processed).toBe(0);
    expect(r.skipped).toBe('no_db');
  });

  it('returns processed:0 when no slots match', async () => {
    const env = makeEnv({ db: makeDb({ slots: [] }) });
    const r = await phaseInstagramAutopilot(env);
    expect(r.processed).toBe(0);
  });

  it('caps work at MAX_SLOTS_PER_TICK (3)', async () => {
    // Verify the LIMIT in the SQL prepared statement.
    const db = makeDb({ slots: [] });
    const env = makeEnv({ db });
    await phaseInstagramAutopilot(env, Date.now());
    expect(db.prepare).toHaveBeenCalled();
    const sqls = db.prepare.mock.calls.map((c) => c[0]);
    const selectSql = sqls.find((s) => /SELECT/i.test(s) && /marketing_content_plan/i.test(s));
    expect(selectSql).toMatch(/LIMIT/i);
  });

  it('iterates returned slots and counts processed', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const oldSlot = {
      id: 'slot_test',
      scheduled_at: nowSec - 60, // already past
      theme: 'inspiration',
      topic: 'Test',
      key_message: null,
      headline_pl: 'Headline',
      caption_pl: 'Full caption',
      hashtags_json: JSON.stringify(['#a', '#b']),
      image_url: 'https://pub-abc.r2.dev/posts/slot_test.png',
      image_prompt: 'visual',
      status: 'ready',
      error_count: 0,
    };
    const db = makeDb({ slots: [oldSlot] });
    const env = makeEnv({ db });
    vi.stubGlobal('fetch', mockMetaFetch({
      '/media': { ok: true, body: { id: 'CONTAINER_1' } },
    }));

    const r = await phaseInstagramAutopilot(env);
    expect(r.processed).toBe(1);
    expect(r.examined).toBe(1);
  });

  it('continues to next slot when one throws', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slots = [
      {
        id: 'slot_bad',
        scheduled_at: nowSec - 60,
        theme: 'inspiration',
        topic: 'X',
        key_message: null,
        status: 'ready',
        error_count: 0,
        image_url: 'https://pub-abc.r2.dev/posts/slot_bad.png',
        caption_pl: 'caption',
        hashtags_json: '[]',
      },
      {
        id: 'slot_good',
        scheduled_at: nowSec - 60,
        theme: 'product',
        topic: 'Y',
        key_message: null,
        status: 'ready',
        error_count: 0,
        image_url: 'https://pub-abc.r2.dev/posts/slot_good.png',
        caption_pl: 'caption2',
        hashtags_json: '[]',
      },
    ];
    const db = makeDb({ slots });
    const env = makeEnv({ db });

    // First fetch fails, second succeeds
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      call++;
      if (url.includes('/media') && call === 1) {
        return { ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'C' }), text: async () => '' };
    }));

    const r = await phaseInstagramAutopilot(env);
    // One processed successfully, one errored (markSlotError ran)
    expect(r.examined).toBe(2);
    // markSlotError ran for slot_bad
    const errorUpdate = db.state.updates.find((u) =>
      String(u.sql).includes('error_count') && u.args[3] === 'slot_bad',
    );
    expect(errorUpdate).toBeTruthy();
  });
});

describe('marketing/autopilot — processSlot (pending → ready)', () => {
  it('generates caption + image, updates slot to ready', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 'slot_p',
      scheduled_at: nowSec + 60, // within lead time
      theme: 'inspiration',
      topic: 'Topic Test',
      key_message: 'AI 24/7',
      headline_pl: null,
      caption_pl: null,
      hashtags_json: null,
      image_url: null,
      image_prompt: null,
      status: 'pending',
      error_count: 0,
    };
    const db = makeDb({ slots: [slot] });
    const env = makeEnv({ db });
    vi.stubGlobal('fetch', mockAnthropicFetch());

    await processSlot(env, slot, nowSec);

    // Should call Claude
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.any(Object),
    );
    // Should call Workers AI
    expect(env.AI.run).toHaveBeenCalledWith(
      '@cf/black-forest-labs/flux-1-schnell',
      expect.any(Object),
    );
    // Should upload to R2
    expect(env.MARKETING_ASSETS.put).toHaveBeenCalledWith(
      'posts/slot_p.png',
      expect.any(Uint8Array),
      expect.any(Object),
    );
    // Should write caption + image_url + status=ready to DB
    const captionUpdate = db.state.updates.find((u) =>
      String(u.sql).includes('headline_pl') && String(u.sql).includes("'pending'"),
    );
    expect(captionUpdate).toBeTruthy();
    const readyUpdate = db.state.updates.find((u) =>
      String(u.sql).includes("status = 'ready'"),
    );
    expect(readyUpdate).toBeTruthy();
  });

  it('skips generation when scheduled_at is far in the future', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 's',
      scheduled_at: nowSec + 60 * 60, // 1h ahead, beyond 15-min lead
      theme: 'inspiration',
      topic: 'X',
      status: 'pending',
      caption_pl: null,
      error_count: 0,
    };
    const env = makeEnv({ db: makeDb({ slots: [slot] }) });
    vi.stubGlobal('fetch', mockAnthropicFetch());

    await processSlot(env, slot, nowSec);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('skips caption gen if caption_pl already populated', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 's2',
      scheduled_at: nowSec + 60,
      theme: 'product',
      topic: 'X',
      key_message: null,
      headline_pl: 'Existing headline',
      caption_pl: 'Existing caption',
      hashtags_json: '["#a"]',
      image_prompt: 'visual',
      image_url: null,
      status: 'pending',
      error_count: 0,
    };
    const env = makeEnv({ db: makeDb({ slots: [slot] }) });
    vi.stubGlobal('fetch', mockAnthropicFetch());

    await processSlot(env, slot, nowSec);

    expect(globalThis.fetch).not.toHaveBeenCalled(); // no Anthropic
    expect(env.AI.run).toHaveBeenCalled(); // still calls image gen
  });
});

describe('marketing/autopilot — processSlot (ready → publishing)', () => {
  it('creates Meta media container, inserts publish queue, status=publishing', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 'slot_r',
      scheduled_at: nowSec - 30,
      theme: 'inspiration',
      topic: 'X',
      caption_pl: 'Caption text',
      hashtags_json: JSON.stringify(['#ManicBot', '#a']),
      image_url: 'https://pub-abc.r2.dev/posts/slot_r.png',
      status: 'ready',
      error_count: 0,
    };
    const db = makeDb({ slots: [slot] });
    const env = makeEnv({ db });
    const metaFetch = mockMetaFetch({
      '/media': { ok: true, body: { id: 'CONTAINER_123' } },
    });
    vi.stubGlobal('fetch', metaFetch);

    await processSlot(env, slot, nowSec);

    expect(metaFetch).toHaveBeenCalled();
    const fetchUrl = metaFetch.mock.calls[0][0];
    expect(fetchUrl).toContain(`/${PAGE_ID}/media`);
    const body = JSON.parse(metaFetch.mock.calls[0][1].body);
    expect(body.image_url).toBe(slot.image_url);
    expect(body.caption).toContain('Caption text');
    expect(body.caption).toContain('#ManicBot');

    expect(db.state.inserts.find((i) => String(i.sql).includes('marketing_publish_queue'))).toBeTruthy();
    expect(db.state.updates.find((u) => String(u.sql).includes("status = 'publishing'"))).toBeTruthy();
  });

  it('does not publish until scheduled time is reached', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 'slot_future',
      scheduled_at: nowSec + 300, // 5 min ahead
      theme: 'inspiration',
      topic: 'X',
      caption_pl: 'c',
      hashtags_json: '[]',
      image_url: 'https://pub-abc.r2.dev/posts/x.png',
      status: 'ready',
      error_count: 0,
    };
    const env = makeEnv({ db: makeDb({ slots: [slot] }) });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    await processSlot(env, slot, nowSec);
    expect(f).not.toHaveBeenCalled();
  });

  it('skips when IG credentials are missing', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 's',
      scheduled_at: nowSec - 60,
      caption_pl: 'c',
      hashtags_json: '[]',
      image_url: 'https://x',
      status: 'ready',
      error_count: 0,
    };
    const env = makeEnv({ ig: false });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    await processSlot(env, slot, nowSec);
    expect(f).not.toHaveBeenCalled();
  });

  it('throws on Meta container creation failure (caught by phase wrapper)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = {
      id: 'slot_bad',
      scheduled_at: nowSec - 30,
      caption_pl: 'c',
      hashtags_json: '[]',
      image_url: 'https://x',
      status: 'ready',
      error_count: 0,
    };
    const env = makeEnv();
    vi.stubGlobal('fetch', mockMetaFetch({
      '/media': { ok: false, status: 400, body: { error: { code: 100, message: 'invalid image' } } },
    }));

    await expect(processSlot(env, slot, nowSec)).rejects.toThrow(/createMediaContainer/);
  });
});

describe('marketing/autopilot — processSlot (publishing → posted)', () => {
  it('waits when container is IN_PROGRESS, increments attempts', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = { id: 'slot_pub', status: 'publishing', error_count: 0 };
    const db = makeDb({
      slots: [slot],
      queue: [{ content_plan_id: 'slot_pub', meta_container_id: 'C1', attempts: 0 }],
    });
    const env = makeEnv({ db });
    const fetchMock = mockMetaFetch({
      '/C1': { ok: true, body: { status_code: 'IN_PROGRESS' } },
    });
    vi.stubGlobal('fetch', fetchMock);

    await processSlot(env, slot, nowSec);

    // Did NOT publish (no /media_publish call)
    const calls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calls.some((u) => u.includes('media_publish'))).toBe(false);
    // Incremented attempts
    const incUpdate = db.state.updates.find((u) =>
      String(u.sql).includes('attempts = attempts + 1'),
    );
    expect(incUpdate).toBeTruthy();
  });

  it('publishes when container is FINISHED, fetches permalink, marks posted', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = { id: 'slot_pub2', status: 'publishing', error_count: 0 };
    const db = makeDb({
      slots: [slot],
      queue: [{ content_plan_id: 'slot_pub2', meta_container_id: 'C2', attempts: 1 }],
    });
    const env = makeEnv({ db });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      if (url.includes('/C2?fields=status_code')) {
        return { ok: true, status: 200, json: async () => ({ status_code: 'FINISHED' }), text: async () => '' };
      }
      if (url.includes('media_publish')) {
        return { ok: true, status: 200, json: async () => ({ id: 'IG_POST_1' }), text: async () => '' };
      }
      if (url.includes('IG_POST_1?fields=permalink')) {
        return { ok: true, status: 200, json: async () => ({ permalink: 'https://instagram.com/p/x' }), text: async () => '' };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }));

    await processSlot(env, slot, nowSec);

    const postedUpdate = db.state.updates.find((u) =>
      String(u.sql).includes("status = 'posted'"),
    );
    expect(postedUpdate).toBeTruthy();
    expect(postedUpdate.args).toContain('IG_POST_1');
    expect(postedUpdate.args).toContain('https://instagram.com/p/x');
  });

  it('throws when container status is ERROR', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = { id: 'slot_err', status: 'publishing', error_count: 0 };
    const db = makeDb({
      slots: [slot],
      queue: [{ content_plan_id: 'slot_err', meta_container_id: 'C3', attempts: 1 }],
    });
    const env = makeEnv({ db });
    vi.stubGlobal('fetch', mockMetaFetch({
      '/C3': { ok: true, body: { status_code: 'ERROR' } },
    }));

    await expect(processSlot(env, slot, nowSec)).rejects.toThrow(/ERROR/);
  });
});

describe('marketing/autopilot — unknown status', () => {
  it('logs warning and returns for unexpected status', async () => {
    const slot = { id: 's', status: 'paused' };
    const env = makeEnv();
    await processSlot(env, slot, Math.floor(Date.now() / 1000));
    // No throw, no DB calls
    expect(env.AI.run).not.toHaveBeenCalled();
  });
});
