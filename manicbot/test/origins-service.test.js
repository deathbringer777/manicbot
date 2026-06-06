import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decodeStartPayload,
  encodeStartPayload,
  encodeStartPayloadFit,
  lookupTrackingLink,
  recordOrigin,
  recordWebOrigin,
  ORIGIN_CHANNELS,
} from '../src/services/origins.js';

vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

describe('decodeStartPayload', () => {
  it('decodes a base64url JSON payload with short keys', () => {
    const b64 = btoa(JSON.stringify({ s: 'qr', c: 'april', m: 'organic' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeStartPayload(b64)).toEqual({
      source: 'qr',
      medium: 'organic',
      campaign: 'april',
    });
  });

  it('decodes a base64url payload with full keys', () => {
    const b64 = btoa(JSON.stringify({ source: 'tiktok', campaign: 'summer' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeStartPayload(b64)).toEqual({
      source: 'tiktok',
      campaign: 'summer',
    });
  });

  it('accepts a simple source-only token', () => {
    expect(decodeStartPayload('qr_april_2026')).toEqual({ source: 'qr_april_2026' });
    expect(decodeStartPayload('ig')).toEqual({ source: 'ig' });
  });

  it('returns null for empty or missing input', () => {
    expect(decodeStartPayload('')).toBeNull();
    expect(decodeStartPayload(null)).toBeNull();
    expect(decodeStartPayload(undefined)).toBeNull();
    expect(decodeStartPayload('   ')).toBeNull();
  });

  it('returns null for oversized input', () => {
    expect(decodeStartPayload('x'.repeat(300))).toBeNull();
  });

  it('returns null for malformed JSON base64', () => {
    // valid b64 but not JSON → falls through to simple token check → matches
    // so use a value that would decode to invalid JSON and contains invalid token chars
    expect(decodeStartPayload('!@#$%^')).toBeNull();
  });

  it('caps each field to 120 chars', () => {
    // 150-char source → JSON ~160 chars → base64 ~216 chars (fits within 256-byte payload cap)
    const long = 'a'.repeat(150);
    const b64 = btoa(JSON.stringify({ s: long })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(b64.length).toBeLessThanOrEqual(256);
    const result = decodeStartPayload(b64);
    expect(result).not.toBeNull();
    expect(result.source.length).toBe(120);
  });

  it('returns null when JSON has no recognized keys', () => {
    const b64 = btoa(JSON.stringify({ foo: 'bar' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeStartPayload(b64)).toBeNull();
  });
});

describe('encodeStartPayload', () => {
  it('round-trips with decodeStartPayload', () => {
    const token = encodeStartPayload({ source: 'qr', campaign: 'april' });
    expect(decodeStartPayload(token)).toEqual({ source: 'qr', campaign: 'april' });
  });

  it('produces a token shorter than 64 chars for typical inputs', () => {
    const token = encodeStartPayload({ source: 'instagram', campaign: 'spring_2026', medium: 'social' });
    expect(token.length).toBeLessThanOrEqual(64);
  });

  it('throws when the token would exceed maxLen', () => {
    expect(() => encodeStartPayload({
      source: 'very_long_source_name_1',
      campaign: 'very_long_campaign_name_2',
      medium: 'very_long_medium_name_3',
      content: 'very_long_content_name_4',
    }, 64)).toThrow(/exceeds maxLen/);
  });

  it('throws on empty input', () => {
    expect(() => encodeStartPayload({})).toThrow(/empty/);
  });

  it('produces URL-safe tokens (no + / =)', () => {
    const token = encodeStartPayload({ source: '@@@', campaign: '???' });
    expect(token).not.toMatch(/[+/=]/);
  });
});

// ─── UTF-8 safety (regression: btoa() threw InvalidCharacterError on Cyrillic) ──

describe('encodeStartPayload — UTF-8 / Cyrillic', () => {
  it('no longer throws on a Cyrillic campaign and round-trips', () => {
    const token = encodeStartPayload({ source: 'qr', campaign: 'Весна' });
    expect(decodeStartPayload(token)).toEqual({ source: 'qr', campaign: 'Весна' });
  });

  it('round-trips mixed Cyrillic + ASCII + spaces', () => {
    const token = encodeStartPayload({ source: 'instagram', campaign: 'Весна 2026' });
    expect(decodeStartPayload(token)).toEqual({ source: 'instagram', campaign: 'Весна 2026' });
  });

  it('still decodes a legacy ASCII-only token minted the old way (backward compat)', () => {
    const legacy = btoa(JSON.stringify({ s: 'qr', c: 'april' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeStartPayload(legacy)).toEqual({ source: 'qr', campaign: 'april' });
  });
});

describe('encodeStartPayloadFit — graceful degradation under the 64-char limit', () => {
  it('returns the full token untruncated when everything fits', () => {
    const r = encodeStartPayloadFit({ source: 'qr', campaign: 'spring' });
    expect(r.truncated).toBe(false);
    expect(r.dropped).toEqual([]);
    expect(decodeStartPayload(r.token)).toEqual({ source: 'qr', campaign: 'spring' });
  });

  it('round-trips a Cyrillic campaign that fits without truncation', () => {
    const r = encodeStartPayloadFit({ source: 'qr', campaign: 'Весна 2026' });
    expect(r.truncated).toBe(false);
    expect(decodeStartPayload(r.token)).toEqual({ source: 'qr', campaign: 'Весна 2026' });
  });

  it('drops content (then medium) to fit, always keeping source, never throws', () => {
    const r = encodeStartPayloadFit({
      source: 'website',
      medium: 'вава',
      campaign: 'вав',
      content: 'вавав',
    });
    expect(r.token.length).toBeLessThanOrEqual(64);
    expect(r.truncated).toBe(true);
    expect(r.dropped).toContain('content');
    const decoded = decodeStartPayload(r.token);
    expect(decoded.source).toBe('website');
    expect(decoded.content).toBeUndefined();
  });

  it('falls back to a fitting source-only token for an extreme oversized payload', () => {
    const r = encodeStartPayloadFit({
      source: 'instagram',
      campaign: 'Очень_длинное_название_кампании_которое_не_влезает',
      medium: 'органический_трафик_из_историй',
      content: 'баннер_в_шапке_профиля_2026',
    });
    expect(r.token.length).toBeLessThanOrEqual(64);
    const decoded = decodeStartPayload(r.token);
    expect(decoded.source).toBe('instagram');
  });

  it('throws only when there is no source at all', () => {
    expect(() => encodeStartPayloadFit({})).toThrow(/empty/);
  });
});

describe('recordWebOrigin', () => {
  function makeWebCtx({ prior = null } = {}) {
    const inserts = [];
    const exec = async (sql, params) => {
      const n = sql.trim().replace(/\s+/g, ' ');
      if (n.startsWith('SELECT 1 AS seen FROM user_origins')) return prior;
      if (n.startsWith('INSERT INTO user_origins')) { inserts.push(params); return { success: true }; }
      return null;
    };
    const db = {
      prepare: (sql) => ({
        bind: (...p) => ({ async first() { return exec(sql, p); }, async run() { return exec(sql, p); } }),
      }),
    };
    return { ctx: { db, tenantId: 't_demo' }, inserts };
  }

  it('records a web touch (chat_id=0, channel web, web_user_id set) as first touch', async () => {
    const { ctx, inserts } = makeWebCtx({ prior: null });
    const res = await recordWebOrigin(ctx, { webUserId: 'anon-123', source: 'qr', campaign: 'Весна 2026' });
    expect(res).toEqual({ ok: true, isFirstTouch: true });
    expect(inserts).toHaveLength(1);
    // params: [tenant, source, medium, campaign, content, landing, referer, raw, captured, is_first, web_user]
    const p = inserts[0];
    expect(p[0]).toBe('t_demo');
    expect(p[1]).toBe('qr');
    expect(p[3]).toBe('Весна 2026');
    expect(p[9]).toBe(1);
    expect(p[10]).toBe('anon-123');
  });

  it('marks a repeat visit by the same anonymousId as not-first-touch', async () => {
    const { ctx, inserts } = makeWebCtx({ prior: { seen: 1 } });
    const res = await recordWebOrigin(ctx, { webUserId: 'anon-123', source: 'website' });
    expect(res).toEqual({ ok: true, isFirstTouch: false });
    expect(inserts[0][9]).toBe(0);
  });

  it('rejects missing ctx / webUserId / source', async () => {
    expect((await recordWebOrigin(null, { webUserId: 'a', source: 'qr' })).ok).toBe(false);
    expect((await recordWebOrigin(makeWebCtx().ctx, { source: 'qr' })).ok).toBe(false);
    expect((await recordWebOrigin(makeWebCtx().ctx, { webUserId: 'a' })).ok).toBe(false);
  });
});

describe('lookupTrackingLink', () => {
  function ctxWith(row) {
    return {
      db: { prepare() { return { bind() { return { async first() { return row; } }; } }; } },
      tenantId: 't_demo',
    };
  }

  it('resolves a known short code to its stored attribution (Cyrillic-safe)', async () => {
    const ctx = ctxWith({ source: 'qr', medium: null, campaign: 'Весна 2026', content: null });
    expect(await lookupTrackingLink(ctx, 'ab12cd34')).toEqual({ source: 'qr', campaign: 'Весна 2026' });
  });

  it('returns null for an unknown code', async () => {
    expect(await lookupTrackingLink(ctxWith(null), 'ffffffff')).toBeNull();
  });

  it('returns null without ctx / tenant / code', async () => {
    expect(await lookupTrackingLink(null, 'ab12cd34')).toBeNull();
    expect(await lookupTrackingLink({ db: {}, tenantId: '' }, 'ab12cd34')).toBeNull();
    expect(await lookupTrackingLink(ctxWith({ source: 'qr' }), '')).toBeNull();
  });
});

describe('ORIGIN_CHANNELS', () => {
  it('contains the 4 known channels', () => {
    expect(ORIGIN_CHANNELS.has('telegram')).toBe(true);
    expect(ORIGIN_CHANNELS.has('whatsapp')).toBe(true);
    expect(ORIGIN_CHANNELS.has('instagram')).toBe(true);
    expect(ORIGIN_CHANNELS.has('web')).toBe(true);
    expect(ORIGIN_CHANNELS.has('sms')).toBe(false);
  });
});

// ─── recordOrigin integration ──────────────────────────────────────────────

function makeCtx() {
  const rows = [];
  const userRows = new Map(); // key: `${tid}:${cid}` -> user row

  const exec = async (sql, params) => {
    const normalized = sql.trim().replace(/\s+/g, ' ');
    // INSERT INTO user_origins
    if (normalized.startsWith('INSERT INTO user_origins')) {
      rows.push({
        tenant_id: params[0],
        chat_id: params[1],
        channel: params[2],
        source: params[3],
        medium: params[4],
        campaign: params[5],
        content: params[6],
        landing_url: params[7],
        referer: params[8],
        raw_payload: params[9],
        captured_at: params[10],
        is_first_touch: params[11],
      });
      return { success: true };
    }
    // SELECT first_touch_at FROM users
    if (normalized.startsWith('SELECT first_touch_at FROM users')) {
      const key = `${params[0]}:${params[1]}`;
      return userRows.get(key) || null;
    }
    // UPDATE users SET first_source...
    if (normalized.startsWith('UPDATE users SET first_source')) {
      const tid = params[4];
      const cid = params[5];
      const key = `${tid}:${cid}`;
      const existing = userRows.get(key) || {};
      userRows.set(key, {
        ...existing,
        first_source: params[0],
        first_campaign: params[1],
        first_medium: params[2],
        first_touch_at: params[3],
      });
      return { success: true };
    }
    return null;
  };

  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() { return exec(sql, params); },
            async run() { return exec(sql, params); },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };

  return {
    ctx: { db, tenantId: 't_demo' },
    rows,
    userRows,
  };
}

describe('recordOrigin', () => {
  let setup;
  beforeEach(() => { setup = makeCtx(); });

  it('inserts a first-touch row and updates user denorm fields', async () => {
    const res = await recordOrigin(setup.ctx, {
      chatId: 123,
      channel: 'telegram',
      source: 'qr',
      campaign: 'april',
      rawPayload: 'raw',
    });
    expect(res.ok).toBe(true);
    expect(res.isFirstTouch).toBe(true);
    expect(setup.rows).toHaveLength(1);
    expect(setup.rows[0].is_first_touch).toBe(1);
    expect(setup.rows[0].source).toBe('qr');
    expect(setup.userRows.get('t_demo:123')).toMatchObject({
      first_source: 'qr',
      first_campaign: 'april',
    });
  });

  it('inserts a subsequent-touch row but does not overwrite first-touch denorm', async () => {
    // Seed user as already having first_touch_at
    setup.userRows.set('t_demo:456', { first_touch_at: 1000 });

    const res = await recordOrigin(setup.ctx, {
      chatId: 456,
      channel: 'telegram',
      source: 'instagram',
    });
    expect(res.ok).toBe(true);
    expect(res.isFirstTouch).toBe(false);
    expect(setup.rows).toHaveLength(1);
    expect(setup.rows[0].is_first_touch).toBe(0);
    // Denorm unchanged
    expect(setup.userRows.get('t_demo:456').first_source).toBeUndefined();
  });

  it('rejects missing ctx / missing tenantId / missing chatId', async () => {
    expect((await recordOrigin(null, { chatId: 1, channel: 'telegram' })).ok).toBe(false);
    expect((await recordOrigin({ db: {} }, { chatId: 1, channel: 'telegram' })).ok).toBe(false);
    expect((await recordOrigin(setup.ctx, { channel: 'telegram' })).ok).toBe(false);
    expect((await recordOrigin(setup.ctx, { chatId: 1 })).ok).toBe(false);
  });

  it('rejects an invalid channel', async () => {
    const res = await recordOrigin(setup.ctx, { chatId: 1, channel: 'sms' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid channel');
  });

  it('normalizes undefined optional fields to null', async () => {
    await recordOrigin(setup.ctx, { chatId: 789, channel: 'telegram', source: 'qr' });
    expect(setup.rows[0].medium).toBeNull();
    expect(setup.rows[0].campaign).toBeNull();
    expect(setup.rows[0].content).toBeNull();
  });
});
