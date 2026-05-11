/**
 * P2-23: GDPR DSR (right-of-access) export at /admin/export/users.csv.
 *
 * Hard requirements (per relax.md §7 #2 "No /admin/export/users.csv for DSR"):
 *   1. Bearer-only auth (no Basic, no ?key=). 403 on any other auth shape.
 *   2. Filtered by `tenant_id` OR `email`. Unfiltered → 400.
 *   3. Unknown email → 200, header-only CSV.
 *   4. CSV columns: id, email, tenant_id, role, created_at, email_verified,
 *      last_login_at, last_login_ip. NO password hash, NO tokens, NO IPs
 *      other than last_login_ip.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock unrelated dependencies so the import graph stays lean.
vi.mock('../src/services/appointments.js', () => ({
  getAdminAllApts: vi.fn(async () => []),
}));
vi.mock('../src/services/services.js', () => ({
  initServices: vi.fn(async (ctx) => { ctx.svc = []; }),
}));
vi.mock('../src/telegram.js', () => ({
  api: vi.fn(),
}));
// Real timingSafeEqual + requireAdmin — we exercise the auth path.

import { tryAdminPanel, buildDsrUsersCsv } from '../src/http/adminPanelHttp.js';

const ADMIN_KEY = 'k'.repeat(48);

function makeDb(rows = []) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              // The DSR helper SELECTs `id, email, tenant_id, role, created_at,
              // email_verified, last_login_at, last_login_ip` from web_users.
              if (sql.includes('FROM web_users')) {
                // Apply the filter the helper passed in.
                if (sql.includes('tenant_id = ?') && sql.includes('LOWER(email) = ?')) {
                  return { results: rows.filter(r => r.tenant_id === params[0] && (r.email ?? '').toLowerCase() === params[1]) };
                }
                if (sql.includes('tenant_id = ?')) {
                  return { results: rows.filter(r => r.tenant_id === params[0]) };
                }
                if (sql.includes('LOWER(email) = ?')) {
                  return { results: rows.filter(r => (r.email ?? '').toLowerCase() === params[0]) };
                }
                return { results: rows };
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

function makeRequest({ path, auth } = {}) {
  const headers = new Headers();
  if (auth) headers.set('Authorization', auth);
  return new Request(`https://example.com${path}`, { method: 'GET', headers });
}

function makeCtx(rows = []) {
  return {
    ADMIN_KEY,
    tenantId: 't_demo',
    bot: { botId: 'b1' },
    svc: [],
    db: makeDb(rows),
  };
}

describe('GET /admin/export/users.csv — DSR (P2-23)', () => {
  it('rejects requests with no Authorization header (403)', async () => {
    const req = makeRequest({ path: '/admin/export/users.csv?tenant_id=t_demo' });
    const res = await tryAdminPanel(req, makeCtx(), new URL(req.url), new Response('UA', { status: 401 }));
    expect(res).not.toBeNull();
    expect(res.status).toBe(403);
  });

  it('rejects Basic auth (403) — Bearer-only on this endpoint', async () => {
    const basic = 'Basic ' + Buffer.from('admin:' + ADMIN_KEY).toString('base64');
    const req = makeRequest({ path: '/admin/export/users.csv?tenant_id=t_demo', auth: basic });
    const res = await tryAdminPanel(req, makeCtx(), new URL(req.url), new Response('UA', { status: 401 }));
    expect(res.status).toBe(403);
  });

  it('rejects wrong bearer token (403)', async () => {
    const req = makeRequest({ path: '/admin/export/users.csv?tenant_id=t_demo', auth: 'Bearer wrong' });
    const res = await tryAdminPanel(req, makeCtx(), new URL(req.url), new Response('UA', { status: 401 }));
    expect(res.status).toBe(403);
  });

  it('rejects unfiltered request with 400 (must pass tenant_id or email)', async () => {
    const req = makeRequest({ path: '/admin/export/users.csv', auth: `Bearer ${ADMIN_KEY}` });
    const res = await tryAdminPanel(req, makeCtx(), new URL(req.url), new Response('UA', { status: 401 }));
    expect(res.status).toBe(400);
  });

  it('returns 200 with header-only CSV when filter matches nothing', async () => {
    const req = makeRequest({ path: '/admin/export/users.csv?email=nobody@nowhere.example', auth: `Bearer ${ADMIN_KEY}` });
    const res = await tryAdminPanel(req, makeCtx([]), new URL(req.url), new Response('UA', { status: 401 }));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Header row only — no data lines.
    expect(text).toBe('id,email,tenant_id,role,created_at,email_verified,last_login_at,last_login_ip\n');
    expect(res.headers.get('Content-Type')).toBe('text/csv;charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="users.csv"');
  });

  it('returns matching rows for tenant_id filter — DSR columns only', async () => {
    const rows = [
      {
        id: 'u1',
        email: 'alice@example.com',
        tenant_id: 't_demo',
        role: 'tenant_owner',
        created_at: 1_700_000_000,
        email_verified: 1,
        last_login_at: 1_700_100_000,
        last_login_ip: '1.2.3.4',
      },
      {
        id: 'u2',
        email: 'bob@other.example',
        tenant_id: 't_other',
        role: 'master',
        created_at: 1_700_050_000,
        email_verified: 0,
        last_login_at: null,
        last_login_ip: null,
      },
    ];
    const req = makeRequest({ path: '/admin/export/users.csv?tenant_id=t_demo', auth: `Bearer ${ADMIN_KEY}` });
    const res = await tryAdminPanel(req, makeCtx(rows), new URL(req.url), new Response('UA', { status: 401 }));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Only the t_demo row.
    expect(text).toContain('"u1"');
    expect(text).toContain('"alice@example.com"');
    expect(text).not.toContain('u2');
    expect(text).not.toContain('bob@other.example');
  });
});

describe('buildDsrUsersCsv — format snapshot (P2-23)', () => {
  it('emits the exact header + one data row in DSR shape', () => {
    const rows = [
      {
        id: 'u1',
        email: 'alice@example.com',
        tenant_id: 't_demo',
        role: 'tenant_owner',
        created_at: 1_700_000_000, // 2023-11-14T22:13:20.000Z
        email_verified: 1,
        last_login_at: 1_700_100_000, // 2023-11-16T02:00:00.000Z
        last_login_ip: '1.2.3.4',
      },
    ];
    const csv = buildDsrUsersCsv(rows);
    const expected =
      'id,email,tenant_id,role,created_at,email_verified,last_login_at,last_login_ip\n' +
      '"u1","alice@example.com","t_demo","tenant_owner","2023-11-14T22:13:20.000Z","1","2023-11-16T02:00:00.000Z","1.2.3.4"\n';
    expect(csv).toBe(expected);
  });

  it('never includes password_hash / verification_token / login_token / new_email', () => {
    // If a caller accidentally hands us an extended row, only the
    // DSR-whitelisted columns must end up in the CSV.
    const rows = [
      {
        id: 'u1',
        email: 'a@b.com',
        tenant_id: 't1',
        role: 'master',
        created_at: 0,
        email_verified: 0,
        last_login_at: null,
        last_login_ip: null,
        // Extra fields that MUST NOT leak.
        password_hash: 'pbkdf2:100000:abc:def',
        verification_token: 'secret1',
        password_reset_token: 'secret2',
        login_token_hash: 'secret3',
        email_change_token: 'secret4',
        new_email: 'newalias@example.com',
        last_login_ip_v6: '::1',
      },
    ];
    const csv = buildDsrUsersCsv(rows);
    expect(csv).not.toContain('pbkdf2');
    expect(csv).not.toContain('secret1');
    expect(csv).not.toContain('secret2');
    expect(csv).not.toContain('secret3');
    expect(csv).not.toContain('secret4');
    expect(csv).not.toContain('newalias');
  });

  it('escapes CSV cells that would otherwise trigger formula injection', () => {
    const rows = [
      {
        id: 'u1',
        email: '=cmd|"/c calc"',
        tenant_id: 't1',
        role: 'master',
        created_at: 0,
        email_verified: 0,
        last_login_at: null,
        last_login_ip: null,
      },
    ];
    const csv = buildDsrUsersCsv(rows);
    // Leading `=` must be neutralised with a leading single quote so
    // Excel / Google Sheets does NOT evaluate it as a formula.
    expect(csv).toContain('"\'=cmd|""/c calc""');
  });

  it('returns header-only CSV for empty input', () => {
    expect(buildDsrUsersCsv([])).toBe('id,email,tenant_id,role,created_at,email_verified,last_login_at,last_login_ip\n');
    expect(buildDsrUsersCsv(null)).toBe('id,email,tenant_id,role,created_at,email_verified,last_login_at,last_login_ip\n');
  });
});

describe('listWebUsersForDsr — helper guard', () => {
  it('returns [] when no filter is supplied', async () => {
    const { listWebUsersForDsr } = await import('../src/services/users.js');
    const ctx = { db: makeDb([{ id: 'u1', email: 'a@b.com', tenant_id: 't1', role: 'master', created_at: 0, email_verified: 0, last_login_at: null, last_login_ip: null }]) };
    const rows = await listWebUsersForDsr(ctx, {});
    expect(rows).toEqual([]);
  });

  it('returns matching rows when tenantId is supplied', async () => {
    const { listWebUsersForDsr } = await import('../src/services/users.js');
    const rows = [
      { id: 'u1', email: 'alice@example.com', tenant_id: 't_demo', role: 'tenant_owner', created_at: 1, email_verified: 1, last_login_at: 2, last_login_ip: '1.2.3.4' },
      { id: 'u2', email: 'bob@other.example', tenant_id: 't_other', role: 'master', created_at: 3, email_verified: 0, last_login_at: null, last_login_ip: null },
    ];
    const ctx = { db: makeDb(rows) };
    const got = await listWebUsersForDsr(ctx, { tenantId: 't_demo' });
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe('u1');
  });
});
