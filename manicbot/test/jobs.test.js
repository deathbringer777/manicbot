import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';
import { enqueueJob } from '../src/services/jobs.js';

function makeEnv(db, extra = {}) {
  return {
    DB: db,
    CF_ACCESS_CLIENT_ID: 'cid-test',
    CF_ACCESS_CLIENT_SECRET: 'csecret-test',
    JOBS_KICK_URL: 'https://jobs.test',
    ...extra,
  };
}

describe('enqueueJob (D1 job queue)', () => {
  let db;
  beforeEach(() => { db = createMockD1(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('inserts a pending job row with type, payload and tenant_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }));
    const { id } = await enqueueJob(makeEnv(db), 'campaign.generate', { n: 5 }, { tenantId: 't_demo' });

    expect(id).toBeTruthy();
    const rows = db._getTable('jobs');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(id);
    expect(row.type).toBe('campaign.generate');
    expect(row.status).toBe('pending');
    expect(row.tenant_id).toBe('t_demo');
    expect(row.attempts).toBe(0);
    expect(typeof row.created_at).toBe('number');
    expect(JSON.parse(row.payload)).toEqual({ n: 5 });
  });

  it('fires a best-effort kick with Access service-token headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);
    const { id } = await enqueueJob(makeEnv(db), 'blog.generate', { slug: 'x' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jobs.test/kick');
    expect(opts.method).toBe('POST');
    expect(opts.headers['CF-Access-Client-Id']).toBe('cid-test');
    expect(opts.headers['CF-Access-Client-Secret']).toBe('csecret-test');
    expect(JSON.parse(opts.body)).toEqual({ id, type: 'blog.generate' });
  });

  it('still enqueues durably when the kick fails (sidecar down)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { id } = await enqueueJob(makeEnv(db), 'leads.scan', { region: 'PL' });

    // resolves without throwing + row persisted as pending → the poller drains it
    const rows = db._getTable('jobs');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].status).toBe('pending');
  });

  it('skips the kick (no network call) when Access creds are absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv(db, { CF_ACCESS_CLIENT_ID: undefined, CF_ACCESS_CLIENT_SECRET: undefined });
    const { id } = await enqueueJob(env, 'ping', {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(db._getTable('jobs')[0].id).toBe(id);
  });
});
