import { describe, it, expect } from 'vitest';
import {
  signUploadToken,
  verifyUploadToken,
  buildAssetKey,
  sha256Hex,
  ALLOWED_KINDS,
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
} from '../src/services/upload.js';
import * as uploadSvc from '../src/services/upload.js';

const SECRET = 'a-very-very-long-test-secret-1234567890';

describe('signUploadToken / verifyUploadToken', () => {
  it('round-trips a valid token', async () => {
    const token = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(2);
    const claim = await verifyUploadToken(token, SECRET);
    expect(claim).not.toBeNull();
    expect(claim.tid).toBe('t_demo');
    expect(claim.kind).toBe('logo');
    expect(claim.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('embeds a unique jti that verify returns (A5 single-use nonce)', async () => {
    const a = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    const b = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    const ca = await verifyUploadToken(a, SECRET);
    const cb = await verifyUploadToken(b, SECRET);
    expect(typeof ca.jti).toBe('string');
    expect(ca.jti.length).toBeGreaterThan(0);
    // Two tokens for the same tenant/kind must carry distinct nonces.
    expect(ca.jti).not.toBe(cb.jti);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    const claim = await verifyUploadToken(token, 'other-secret-at-least-16-chars');
    expect(claim).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    const [, sig] = token.split('.');
    const tampered = Buffer.from(JSON.stringify({ tid: 't_other', kind: 'logo', exp: Date.now() / 1000 + 60 })).toString('base64url') + '.' + sig;
    const claim = await verifyUploadToken(tampered, SECRET);
    expect(claim).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    const tampered = token.slice(0, -4) + 'AAAA';
    const claim = await verifyUploadToken(tampered, SECRET);
    expect(claim).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET, ttlSec: -10 });
    const claim = await verifyUploadToken(token, SECRET);
    expect(claim).toBeNull();
  });

  it('rejects malformed token strings', async () => {
    expect(await verifyUploadToken('', SECRET)).toBeNull();
    expect(await verifyUploadToken('no-dot', SECRET)).toBeNull();
    expect(await verifyUploadToken('.', SECRET)).toBeNull();
    expect(await verifyUploadToken('a.', SECRET)).toBeNull();
    expect(await verifyUploadToken('.b', SECRET)).toBeNull();
  });

  it('rejects an invalid kind when signing', async () => {
    await expect(signUploadToken({ tid: 't_demo', kind: 'invalid', secret: SECRET })).rejects.toThrow(/invalid kind/);
  });

  it('rejects a too-short secret', async () => {
    await expect(signUploadToken({ tid: 't_demo', kind: 'logo', secret: 'short' })).rejects.toThrow(/too short/);
  });

  it('rejects a missing tid', async () => {
    await expect(signUploadToken({ tid: '', kind: 'logo', secret: SECRET })).rejects.toThrow(/tid required/);
  });

  it('accepts all valid kinds', async () => {
    for (const kind of ALLOWED_KINDS) {
      const token = await signUploadToken({ tid: 't_demo', kind, secret: SECRET });
      const claim = await verifyUploadToken(token, SECRET);
      expect(claim?.kind).toBe(kind);
    }
  });
});

describe('buildAssetKey + sha256Hex', () => {
  it('is deterministic and content-addressed', async () => {
    const bytes = new TextEncoder().encode('hello branding world');
    const keyA = await buildAssetKey('t_demo', 'logo', bytes, 'png');
    const keyB = await buildAssetKey('t_demo', 'logo', bytes, 'png');
    expect(keyA).toBe(keyB);
    expect(keyA).toMatch(/^t\/t_demo\/logo-[0-9a-f]{12}\.png$/);
  });

  it('produces different keys for different bytes', async () => {
    const a = await buildAssetKey('t_demo', 'logo', new TextEncoder().encode('a'), 'png');
    const b = await buildAssetKey('t_demo', 'logo', new TextEncoder().encode('b'), 'png');
    expect(a).not.toBe(b);
  });

  it('sha256Hex returns 64 lowercase hex chars', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('hello'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('upload constants', () => {
  it('ALLOWED_MIME maps png/jpeg/webp', () => {
    expect(ALLOWED_MIME.get('image/png')).toBe('png');
    expect(ALLOWED_MIME.get('image/jpeg')).toBe('jpg');
    expect(ALLOWED_MIME.get('image/webp')).toBe('webp');
    expect(ALLOWED_MIME.get('image/svg+xml')).toBeUndefined();
    expect(ALLOWED_MIME.get('application/pdf')).toBeUndefined();
  });

  it('MAX_UPLOAD_BYTES is 2 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
  });
});

// ─── A5: single-use enforcement ──────────────────────────────────────────────
// A valid HMAC token within its 5-min TTL must redeem at most once. The nonce
// (jti) is atomically claimed in upload_token_used (migration 0096); a replay
// finds the row already present and is rejected.
describe('claimUploadNonce + pruneExpiredUploadNonces (A5)', () => {
  function makeFakeNonceD1() {
    const rows = new Map();
    return {
      rows,
      prepare(sql) {
        return {
          _p: [],
          bind(...p) { this._p = p; return this; },
          async run() {
            if (/INSERT\s+INTO\s+upload_token_used/i.test(sql)) {
              const jti = this._p[0];
              if (rows.has(jti)) return { meta: { changes: 0 } };
              rows.set(jti, this._p[1]); // expires_at
              return { meta: { changes: 1 } };
            }
            if (/DELETE\s+FROM\s+upload_token_used/i.test(sql)) {
              const cutoff = this._p[0];
              let changes = 0;
              for (const [k, v] of [...rows]) { if (v < cutoff) { rows.delete(k); changes++; } }
              return { meta: { changes } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
  }
  const future = Math.floor(Date.now() / 1000) + 300;

  it('first claim wins; replay of the same jti is rejected', async () => {
    const env = { DB: makeFakeNonceD1() };
    expect(await uploadSvc.claimUploadNonce(env, 'jti-1', future)).toBe(true);
    expect(await uploadSvc.claimUploadNonce(env, 'jti-1', future)).toBe(false);
  });

  it('distinct jtis are independent', async () => {
    const env = { DB: makeFakeNonceD1() };
    expect(await uploadSvc.claimUploadNonce(env, 'a', future)).toBe(true);
    expect(await uploadSvc.claimUploadNonce(env, 'b', future)).toBe(true);
  });

  it('fail-open when DB binding is missing (degraded env, never blocks a real upload)', async () => {
    expect(await uploadSvc.claimUploadNonce({}, 'x', future)).toBe(true);
  });

  it('prune deletes only expired nonces', async () => {
    const db = makeFakeNonceD1();
    const env = { DB: db };
    const past = Math.floor(Date.now() / 1000) - 10;
    await uploadSvc.claimUploadNonce(env, 'expired', past);
    await uploadSvc.claimUploadNonce(env, 'live', future);
    const { deleted } = await uploadSvc.pruneExpiredUploadNonces(env);
    expect(deleted).toBe(1);
    expect(db.rows.has('expired')).toBe(false);
    expect(db.rows.has('live')).toBe(true);
  });
});
