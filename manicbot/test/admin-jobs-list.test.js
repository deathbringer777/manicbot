import { describe, it, expect, beforeEach } from 'vitest';
import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';
import { createMockD1 } from './helpers/mock-db.js';

const ADMIN_KEY = 'admin-key-' + 'x'.repeat(40);

function getReq(qs = '', { auth = true } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  return new Request(`https://manicbot.com/admin/jobs${qs}`, { method: 'GET', headers });
}
function call(req, env) { return tryAdminKeyRoutes(req, env, new URL(req.url)); }

function seed(db) {
  const rows = [
    ['j1', 'ping', 'done', 100],
    ['j2', 'blog.generate', 'error', 200],
    ['j3', 'ping', 'pending', 300],
  ];
  for (const [id, type, status, created] of rows) {
    db.prepare(
      `INSERT INTO jobs (id, type, payload, status, attempts, created_at) VALUES (?, ?, '{}', ?, 0, ?)`,
    ).bind(id, type, status, created).run();
  }
}

describe('GET /admin/jobs (queue observability)', () => {
  let db;
  beforeEach(() => { db = createMockD1(); seed(db); });

  it('rejects without auth (403)', async () => {
    const res = await call(getReq('', { auth: false }), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(403);
  });

  it('?id=<existing> → 200 + the job', async () => {
    const res = await call(getReq('?id=j2'), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.ok).toBe(true);
    expect(b.job.id).toBe('j2');
    expect(b.job.status).toBe('error');
  });

  it('?id=<missing> → 404', async () => {
    const res = await call(getReq('?id=nope'), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(404);
  });

  it('list → 200 + recent jobs, newest first', async () => {
    const res = await call(getReq(''), { ADMIN_KEY, DB: db });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.jobs.length).toBe(3);
    expect(b.jobs[0].id).toBe('j3'); // created_at 300 = newest
  });

  it('?status=error → only error jobs', async () => {
    const res = await call(getReq('?status=error'), { ADMIN_KEY, DB: db });
    const b = await res.json();
    expect(b.jobs.length).toBeGreaterThan(0);
    expect(b.jobs.every((j) => j.status === 'error')).toBe(true);
    expect(b.jobs.map((j) => j.id)).toContain('j2');
  });
});
