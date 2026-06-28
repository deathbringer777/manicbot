import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';
import { createMockD1 } from './helpers/mock-db.js';

const ADMIN_KEY = 'admin-key-' + 'x'.repeat(40);

function makeReq(body, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  return new Request('https://manicbot.com/admin/jobs', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function call(req, env) { return tryAdminKeyRoutes(req, env, new URL(req.url)); }

describe('POST /admin/jobs (job enqueue trigger)', () => {
  let db;
  beforeEach(() => { db = createMockD1(); vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rejects without Bearer auth (403), enqueues nothing', async () => {
    const res = await call(makeReq({ type: 'blog.generate' }, { auth: false }), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(403);
    expect(db._getTable('jobs')).toHaveLength(0);
  });

  it('rejects an unknown job type (400) — allowlist guard', async () => {
    const res = await call(makeReq({ type: 'rm.rf' }), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/unknown/);
    expect(db._getTable('jobs')).toHaveLength(0);
  });

  it('rejects invalid JSON (400)', async () => {
    const res = await call(makeReq('{not valid json', {}), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(400);
  });

  it('enqueues a known job with valid auth → 200 + jobId + pending row', async () => {
    const res = await call(makeReq({ type: 'blog.generate', payload: { topic: { slug: 's' } } }), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.ok).toBe(true);
    expect(b.jobId).toBeTruthy();
    const rows = db._getTable('jobs');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('blog.generate');
    expect(rows[0].status).toBe('pending');
  });

  it('rejects an oversized payload (400) — SEC-008 surfaced as a 400', async () => {
    const res = await call(makeReq({ type: 'claude.generate', payload: { prompt: 'x'.repeat(33 * 1024) } }), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(400);
    expect(db._getTable('jobs')).toHaveLength(0);
  });
});
