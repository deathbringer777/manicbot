import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tryUpload } from '../src/http/uploadHttp.js';
import { signUploadToken, MAX_UPLOAD_BYTES } from '../src/services/upload.js';

// Mute event logging during tests
vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

const SECRET = 'test-upload-secret-at-least-16-chars';

/** In-memory R2 bucket mock — enough of the API surface for uploadHttp. */
function makeR2Mock() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await (value).arrayBuffer?.() ?? value);
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
    MANICBOT: null, // logEvent is mocked — KV not needed
    ...overrides,
  };
}

/** Build a multipart Request for POST /upload/asset. */
async function buildUploadRequest(token, kind, file) {
  const form = new FormData();
  form.append('file', file);
  const url = `https://manicbot.com/upload/asset?t=${encodeURIComponent(token)}&kind=${encodeURIComponent(kind)}`;
  return new Request(url, { method: 'POST', body: form });
}

describe('tryUpload — POST /upload/asset', () => {
  let env;
  beforeEach(() => {
    env = makeEnv();
  });

  it('rejects when ASSETS binding is missing', async () => {
    env.ASSETS = null;
    const token = await signUploadToken({ tid: 't1', kind: 'logo', secret: SECRET });
    const req = await buildUploadRequest(token, 'logo', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(500);
  });

  it('rejects when UPLOAD_TOKEN_SECRET is missing', async () => {
    env.UPLOAD_TOKEN_SECRET = '';
    const req = await buildUploadRequest('whatever', 'logo', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(500);
  });

  it('rejects an invalid token', async () => {
    const req = await buildUploadRequest('not-a-valid-token', 'logo', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(401);
  });

  it('rejects a kind mismatch between query param and token', async () => {
    const token = await signUploadToken({ tid: 't1', kind: 'logo', secret: SECRET });
    const req = await buildUploadRequest(token, 'cover', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported MIME type', async () => {
    const token = await signUploadToken({ tid: 't1', kind: 'logo', secret: SECRET });
    const req = await buildUploadRequest(token, 'logo', new File([new Uint8Array([1, 2])], 'a.svg', { type: 'image/svg+xml' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(415);
  });

  it('rejects an empty file', async () => {
    const token = await signUploadToken({ tid: 't1', kind: 'logo', secret: SECRET });
    const req = await buildUploadRequest(token, 'logo', new File([], 'a.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it('rejects oversized files', async () => {
    const token = await signUploadToken({ tid: 't1', kind: 'logo', secret: SECRET });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const req = await buildUploadRequest(token, 'logo', new File([big], 'a.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(413);
  });

  it('writes to R2 and returns a public URL on happy path', async () => {
    const token = await signUploadToken({ tid: 't_demo', kind: 'logo', secret: SECRET });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic bytes
    const req = await buildUploadRequest(token, 'logo', new File([bytes], 'logo.png', { type: 'image/png' }));
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toMatch(/^t\/t_demo\/logo-[0-9a-f]{12}\.png$/);
    expect(body.url).toContain('/cdn/');
    expect(body.url).toContain(body.key);
    // Verify R2 received the file
    expect(env.ASSETS.store.has(body.key)).toBe(true);
  });

  it('handles OPTIONS preflight', async () => {
    const req = new Request('https://manicbot.com/upload/asset', { method: 'OPTIONS' });
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns null for unrelated routes', async () => {
    const req = new Request('https://manicbot.com/some-other-path');
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res).toBeNull();
  });
});

describe('tryUpload — GET /cdn/<key>', () => {
  it('serves an existing object with cache headers', async () => {
    const env = makeEnv();
    const key = 't/t_demo/logo-abc123def456.png';
    await env.ASSETS.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } });
    const req = new Request(`https://manicbot.com/cdn/${key}`);
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 404 for a missing object', async () => {
    const env = makeEnv();
    const req = new Request('https://manicbot.com/cdn/t/missing/logo.png');
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(404);
  });

  it('rejects path traversal attempts', async () => {
    const env = makeEnv();
    const req = new Request('https://manicbot.com/cdn/..%2Fsecret');
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it('rejects excessively long keys', async () => {
    const env = makeEnv();
    const longKey = 'a'.repeat(300);
    const req = new Request(`https://manicbot.com/cdn/${longKey}`);
    const res = await tryUpload(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });
});
