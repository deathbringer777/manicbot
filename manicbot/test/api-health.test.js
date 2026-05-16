/**
 * Unit tests for /api/health public liveness endpoint.
 *
 * The endpoint must:
 *   - Return 200 + JSON `{ status: "ok", ... }` on GET
 *   - Return 200 with no body on HEAD (cheap monitor probes)
 *   - Return 405 on other methods (no surprise side-effects)
 *   - Always set Cache-Control: no-store (every probe reaches the Worker)
 *   - Never touch D1/KV (liveness, not readiness — a stuck binding must
 *     not take down the probe)
 *   - Never echo env values
 */

import { describe, it, expect } from 'vitest';
import { handleHealthRequest } from '../src/http/healthHttp.js';

describe('/api/health — liveness contract', () => {
  it('GET returns 200 with JSON body { status: "ok", ... }', async () => {
    const req = new Request('https://manicbot.com/api/health', { method: 'GET' });
    const res = handleHealthRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('manicbot');
    expect(typeof body.time).toBe('string');
    // ISO-8601 with millisecond precision (Date#toISOString contract).
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('HEAD returns 200 with no body and the same headers', async () => {
    const req = new Request('https://manicbot.com/api/health', { method: 'HEAD' });
    const res = handleHealthRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Body must be empty for HEAD (the Fetch API enforces this — we just
    // assert there's nothing to read).
    const text = await res.text();
    expect(text).toBe('');
  });

  it('POST returns 405', async () => {
    const req = new Request('https://manicbot.com/api/health', { method: 'POST' });
    const res = handleHealthRequest(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('PUT returns 405', async () => {
    const req = new Request('https://manicbot.com/api/health', { method: 'PUT' });
    const res = handleHealthRequest(req);
    expect(res.status).toBe(405);
  });

  it('does not touch env (called with no env argument)', () => {
    // Sanity invariant: the handler signature must remain (request) → Response.
    // Adding env access would be a regression — readiness work belongs in a
    // separate endpoint.
    const req = new Request('https://manicbot.com/api/health', { method: 'GET' });
    expect(() => handleHealthRequest(req)).not.toThrow();
  });

  it('body shape is fixed — no env leakage', async () => {
    const req = new Request('https://manicbot.com/api/health', { method: 'GET' });
    const res = handleHealthRequest(req);
    const body = await res.json();
    // Exactly these keys, nothing else. If anyone adds an "env" or "secrets"
    // field, this assertion will fail loudly.
    expect(Object.keys(body).sort()).toEqual(['service', 'status', 'time']);
  });
});
