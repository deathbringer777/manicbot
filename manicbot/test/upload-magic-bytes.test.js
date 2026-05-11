/**
 * P2-13 — CDN serves images with X-Content-Type-Options: nosniff and the
 * upload path rejects polyglots whose magic bytes don't match the declared
 * MIME (e.g. an HTML payload with an `image/png` Content-Type header).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tryUpload, magicBytesMatchMime } from '../src/http/uploadHttp.js';
import { signUploadToken } from '../src/services/upload.js';

vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

const SECRET = 'magic-byte-test-secret-at-least-16-chars';

function makeR2Mock() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await value.arrayBuffer());
      store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream' });
      return { key };
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: entry.bytes,
        httpEtag: `"etag-${key}"`,
        writeHttpMetadata(headers) {
          headers.set('Content-Type', entry.contentType);
        },
      };
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    ASSETS: makeR2Mock(),
    UPLOAD_TOKEN_SECRET: SECRET,
    MANICBOT: null,
    ...overrides,
  };
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_MAGIC = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);
// HTML polyglot — starts with `<!doctype html>` instead of magic bytes.
const HTML_POLYGLOT = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

describe('magicBytesMatchMime (P2-13)', () => {
  it('accepts a real PNG header as image/png', () => {
    expect(magicBytesMatchMime(PNG_MAGIC, 'image/png')).toBe(true);
  });

  it('accepts a real JPEG header as image/jpeg', () => {
    expect(magicBytesMatchMime(JPEG_MAGIC, 'image/jpeg')).toBe(true);
  });

  it('accepts a real WEBP header as image/webp', () => {
    expect(magicBytesMatchMime(WEBP_MAGIC, 'image/webp')).toBe(true);
  });

  it('rejects HTML bytes declared as image/png', () => {
    expect(magicBytesMatchMime(HTML_POLYGLOT, 'image/png')).toBe(false);
  });

  it('rejects PNG bytes declared as image/jpeg (cross-format swap)', () => {
    expect(magicBytesMatchMime(PNG_MAGIC, 'image/jpeg')).toBe(false);
  });

  it('rejects a too-short buffer', () => {
    expect(magicBytesMatchMime(new Uint8Array([0x89]), 'image/png')).toBe(false);
  });

  it('rejects an unknown declared MIME', () => {
    expect(magicBytesMatchMime(PNG_MAGIC, 'application/octet-stream')).toBe(false);
  });
});

async function buildUploadRequest(token, kind, file) {
  const form = new FormData();
  form.append('file', file);
  const url = `https://manicbot.com/upload/asset?t=${encodeURIComponent(token)}&kind=${encodeURIComponent(kind)}`;
  return new Request(url, { method: 'POST', body: form });
}

describe('tryUpload — magic-byte rejection (P2-13)', () => {
  let env;
  beforeEach(() => {
    env = makeEnv();
  });

  it('rejects an HTML polyglot uploaded with image/png Content-Type', async () => {
    const token = await signUploadToken({ tid: 't_evil', kind: 'logo', secret: SECRET });
    const req = await buildUploadRequest(
      token,
      'logo',
      new File([HTML_POLYGLOT], 'evil.png', { type: 'image/png' }),
    );
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(415);
  });

  it('accepts a legitimate PNG', async () => {
    const token = await signUploadToken({ tid: 't_good', kind: 'logo', secret: SECRET });
    const req = await buildUploadRequest(
      token,
      'logo',
      new File([PNG_MAGIC], 'logo.png', { type: 'image/png' }),
    );
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(200);
  });
});

describe('tryUpload — CDN response headers (P2-13)', () => {
  it('sets X-Content-Type-Options: nosniff on /cdn/<key>', async () => {
    const env = makeEnv();
    const key = 't/t_demo/logo-abc123def456.png';
    await env.ASSETS.put(key, PNG_MAGIC, { httpMetadata: { contentType: 'image/png' } });
    const req = new Request(`https://manicbot.com/cdn/${key}`);
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets Content-Disposition: inline on /cdn/<key>', async () => {
    const env = makeEnv();
    const key = 't/t_demo/cover-abc123def456.png';
    await env.ASSETS.put(key, PNG_MAGIC, { httpMetadata: { contentType: 'image/png' } });
    const req = new Request(`https://manicbot.com/cdn/${key}`);
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.headers.get('Content-Disposition')).toBe('inline');
  });
});
