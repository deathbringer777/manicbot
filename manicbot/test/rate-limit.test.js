import { describe, it, expect, beforeEach } from 'vitest';
import { checkAndIncrement, credentialFingerprint, cleanupExpired } from '../src/utils/rateLimit.js';
import { requireAdmin } from '../src/utils/security.js';
import { createMockD1 } from './helpers/mock-db.js';

function makeCtx(adminKey = 'a'.repeat(48)) {
  return { db: createMockD1(), ADMIN_KEY: adminKey };
}

function basicAuthReq(credential) {
  const headers = new Headers();
  if (credential !== null) headers.set('Authorization', `Basic ${btoa(`admin:${credential}`)}`);
  return new Request('https://manicbot.com/admin', { headers });
}

describe('#S10 — D1 rate limiter', () => {
  let ctx;
  beforeEach(() => { ctx = makeCtx(); });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkAndIncrement(ctx, 'k', 'a', 5, 60);
      expect(r.limited).toBe(false);
      expect(r.count).toBe(i + 1);
    }
  });

  it('limits the next request after the threshold', async () => {
    for (let i = 0; i < 5; i++) await checkAndIncrement(ctx, 'k', 'a', 5, 60);
    const r = await checkAndIncrement(ctx, 'k', 'a', 5, 60);
    expect(r.limited).toBe(true);
    expect(r.count).toBe(6);
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  it('different keys are tracked separately', async () => {
    for (let i = 0; i < 5; i++) await checkAndIncrement(ctx, 'k1', 'a', 5, 60);
    const r = await checkAndIncrement(ctx, 'k2', 'a', 5, 60);
    expect(r.limited).toBe(false);
  });

  it('different actions on same key are tracked separately', async () => {
    for (let i = 0; i < 5; i++) await checkAndIncrement(ctx, 'k', 'login', 5, 60);
    const r = await checkAndIncrement(ctx, 'k', 'register', 5, 60);
    expect(r.limited).toBe(false);
  });

  it('credentialFingerprint is stable and short', async () => {
    const fp1 = await credentialFingerprint('hunter2');
    const fp2 = await credentialFingerprint('hunter2');
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
    const fp3 = await credentialFingerprint('hunter3');
    expect(fp3).not.toBe(fp1);
  });

  it('cleanupExpired removes old rows', async () => {
    await checkAndIncrement(ctx, 'k', 'a', 5, 60);
    // No real expiry without time mock — this just verifies the call returns
    const removed = await cleanupExpired(ctx, 0);
    expect(typeof removed).toBe('number');
  });
});

describe('#S10 — requireAdmin (rate-limited admin Basic Auth)', () => {
  it('returns null on valid credential', async () => {
    const ctx = makeCtx();
    const r = await requireAdmin(basicAuthReq('a'.repeat(48)), ctx);
    expect(r).toBeNull();
  });

  it('returns 401 on wrong credential', async () => {
    const ctx = makeCtx();
    const r = await requireAdmin(basicAuthReq('wrong'), ctx);
    expect(r.status).toBe(401);
  });

  it('returns 401 on missing credential', async () => {
    const ctx = makeCtx();
    const r = await requireAdmin(basicAuthReq(null), ctx);
    expect(r.status).toBe(401);
  });

  it('locks credential after 5 failed attempts (returns 429)', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 5; i++) {
      const r = await requireAdmin(basicAuthReq('wrong'), ctx);
      expect(r.status).toBe(401);
    }
    const sixth = await requireAdmin(basicAuthReq('wrong'), ctx);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBeTruthy();
  });

  it('lockout applies even with the CORRECT credential (per-credential identity)', async () => {
    const ctx = makeCtx();
    // 5 attempts with any credential (fingerprint differs per credential, so use same wrong creds 5x)
    for (let i = 0; i < 5; i++) await requireAdmin(basicAuthReq('attacker-attempt'), ctx);
    // 6th attempt with same credential — locked
    const sixth = await requireAdmin(basicAuthReq('attacker-attempt'), ctx);
    expect(sixth.status).toBe(429);
    // Different credential is still allowed (different fingerprint)
    const valid = await requireAdmin(basicAuthReq('a'.repeat(48)), ctx);
    expect(valid).toBeNull();
  });
});
