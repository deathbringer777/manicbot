/**
 * Security regression tests for IG admin endpoints that previously had
 * no Bearer authentication:
 *   • POST /admin/ig-set-direct-token — P0: self-gate FAILS OPEN when
 *     channel_configs has no ig_business_id / config.instagram_business_id
 *     / config.ig_account_id, allowing token hijack with only a tenantId.
 *   • POST /admin/ig-diag — P1: sends DM on behalf of tenant when `psid`
 *     is supplied; unauthenticated send surface.
 *   • POST /admin/ig-app-subscribe — P1: re-registers App-level webhook
 *     without any auth.
 *
 * Fix: gate all three on isAdminKeyValid() (Bearer <ADMIN_KEY>).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

const mocks = vi.hoisted(() => ({
  decryptTokenWithFallback: vi.fn(),
}));
vi.mock('../src/utils/security.js', async () => {
  const actual = await vi.importActual('../src/utils/security.js');
  return {
    ...actual,
    decryptTokenWithFallback: mocks.decryptTokenWithFallback,
    encryptToken: vi.fn(async (plain) => `v1$enc:${plain.slice(0, 12)}`),
  };
});

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'admin-key-' + 'x'.repeat(40);
const ENC_KEY = 'k'.repeat(32);
const APP_ID = '1568224577592551';
const APP_SECRET = 'app-secret-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

function req(path, body, { authorization } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorization) headers.authorization = authorization;
  return new Request(`https://manicbot.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function call(path, env, body, opts) {
  const r = req(path, body, opts);
  return tryAdminKeyRoutes(r, env, new URL(r.url));
}

function dbWithIgRow(row, updates = []) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes('FROM channel_configs')) return row;
              return null;
            },
            async run() { updates.push({ sql, params }); return { success: true }; },
            async all() { return { results: row ? [row] : [] }; },
          };
        },
      };
    },
  };
}

describe('IG admin endpoints — Bearer auth required', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.decryptTokenWithFallback.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  describe('POST /admin/ig-set-direct-token', () => {
    const tenantRow = {
      id: 7,
      page_id: '1008301152373103',
      ig_business_id: null,
      config: '{}',
    };

    it('rejects request without Authorization header (403)', async () => {
      const updates = [];
      const env = { ADMIN_KEY, BOT_ENCRYPTION_KEY: ENC_KEY, DB: dbWithIgRow(tenantRow, updates) };
      const res = await call('/admin/ig-set-direct-token', env, {
        tenantId: 't_victim', token: 'IGAA_attacker_token',
      });
      expect(res?.status).toBe(403);
      // Crucially: no DB write attempted, no Graph fetch.
      expect(updates.filter(u => u.sql.includes('UPDATE channel_configs'))).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects request with wrong Bearer key (403)', async () => {
      const env = { ADMIN_KEY, BOT_ENCRYPTION_KEY: ENC_KEY, DB: dbWithIgRow(tenantRow) };
      const res = await call('/admin/ig-set-direct-token', env,
        { tenantId: 't_victim', token: 'IGAA_attacker' },
        { authorization: 'Bearer wrong-key' });
      expect(res?.status).toBe(403);
    });

    it('accepts request with valid Bearer key (golden path proceeds past auth)', async () => {
      const IG_ID = '25881183448226493';
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ id: IG_ID, username: 'manicbot_com' }),
        { status: 200 },
      ));
      const updates = [];
      const env = {
        ADMIN_KEY,
        BOT_ENCRYPTION_KEY: ENC_KEY,
        DB: dbWithIgRow({ ...tenantRow, ig_business_id: IG_ID }, updates),
      };
      const res = await call('/admin/ig-set-direct-token', env,
        { tenantId: 't_legit', token: 'IGAA_good_token' },
        { authorization: `Bearer ${ADMIN_KEY}` });
      expect(res?.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(updates.find(u => u.sql.includes('UPDATE channel_configs'))).toBeTruthy();
    });
  });

  describe('POST /admin/ig-diag', () => {
    const row = { page_id: '12345', token_encrypted: 'v1$good' };

    it('rejects request without Authorization header (403)', async () => {
      const env = { ADMIN_KEY, BOT_ENCRYPTION_KEY: ENC_KEY, DB: dbWithIgRow(row) };
      const res = await call('/admin/ig-diag', env, { tenantId: 't_1', psid: '999' });
      expect(res?.status).toBe(403);
      // No outbound Graph send — attacker cannot DM via this endpoint.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects request with wrong Bearer key (403)', async () => {
      const env = { ADMIN_KEY, BOT_ENCRYPTION_KEY: ENC_KEY, DB: dbWithIgRow(row) };
      const res = await call('/admin/ig-diag', env,
        { tenantId: 't_1', psid: '999' },
        { authorization: 'Bearer nope' });
      expect(res?.status).toBe(403);
    });

    it('accepts request with valid Bearer key', async () => {
      mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: 'good_token', usedOldKey: false });
      fetchSpy
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345', name: 'P' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const env = { ADMIN_KEY, BOT_ENCRYPTION_KEY: ENC_KEY, DB: dbWithIgRow(row) };
      const res = await call('/admin/ig-diag', env,
        { tenantId: 't_1' },
        { authorization: `Bearer ${ADMIN_KEY}` });
      expect(res?.status).toBe(200);
    });
  });

  describe('POST /admin/ig-app-subscribe', () => {
    it('rejects request without Authorization header (403)', async () => {
      const env = { ADMIN_KEY, META_APP_ID: APP_ID, META_APP_SECRET: APP_SECRET };
      const res = await call('/admin/ig-app-subscribe', env, {});
      expect(res?.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects request with wrong Bearer key (403)', async () => {
      const env = { ADMIN_KEY, META_APP_ID: APP_ID, META_APP_SECRET: APP_SECRET };
      const res = await call('/admin/ig-app-subscribe', env, {},
        { authorization: 'Bearer wrong' });
      expect(res?.status).toBe(403);
    });

    it('accepts request with valid Bearer key', async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const env = {
        ADMIN_KEY,
        META_APP_ID: APP_ID,
        META_APP_SECRET: APP_SECRET,
        META_VERIFY_TOKEN_IG: 'verify123',
        APP_BASE_URL: 'https://manicbot.com',
      };
      const res = await call('/admin/ig-app-subscribe', env, {},
        { authorization: `Bearer ${ADMIN_KEY}` });
      expect(res?.status).toBe(200);
    });
  });
});
