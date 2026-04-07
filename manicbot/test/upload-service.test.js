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
