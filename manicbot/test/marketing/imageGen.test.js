import { describe, it, expect, vi } from 'vitest';
import { generateImage, extractPngBytes } from '../../src/marketing/imageGen.js';

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function base64Of(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function makeEnv(opts = {}) {
  const { r2PutImpl } = opts;
  const aiResponse = 'aiResponse' in opts ? opts.aiResponse : { image: base64Of(PNG_HEADER) };
  const ai = {
    run: vi.fn().mockResolvedValue(aiResponse),
  };
  const r2 = {
    put: vi.fn().mockImplementation(r2PutImpl ?? (async () => undefined)),
  };
  return {
    AI: ai,
    MARKETING_ASSETS: r2,
    MARKETING_ASSETS_PUBLIC_URL: 'https://pub-abc.r2.dev',
  };
}

describe('marketing/imageGen — extractPngBytes', () => {
  it('returns Uint8Array as-is', () => {
    const b = new Uint8Array([1, 2, 3]);
    expect(extractPngBytes(b)).toBe(b);
  });

  it('converts ArrayBuffer to Uint8Array', () => {
    const ab = new ArrayBuffer(4);
    new Uint8Array(ab).set([9, 8, 7, 6]);
    const out = extractPngBytes(ab);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.byteLength).toBe(4);
    expect(out[0]).toBe(9);
  });

  it('decodes { image: base64 } from Workers AI flux response', () => {
    const out = extractPngBytes({ image: base64Of(PNG_HEADER) });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.byteLength).toBe(8);
    expect(out[0]).toBe(0x89);
  });

  it('strips data URL prefix if present', () => {
    const out = extractPngBytes({ image: `data:image/png;base64,${base64Of(PNG_HEADER)}` });
    expect(out[0]).toBe(0x89);
  });

  it('returns null for null/undefined input', () => {
    expect(extractPngBytes(null)).toBeNull();
    expect(extractPngBytes(undefined)).toBeNull();
  });

  it('returns null for unsupported shape', () => {
    expect(extractPngBytes({ foo: 'bar' })).toBeNull();
    expect(extractPngBytes('string')).toBeNull();
  });
});

describe('marketing/imageGen — generateImage', () => {
  it('calls Workers AI with flux-1-schnell + prompt', async () => {
    const env = makeEnv();
    await generateImage(env, { prompt: 'test prompt' });
    expect(env.AI.run).toHaveBeenCalledWith(
      '@cf/black-forest-labs/flux-1-schnell',
      expect.objectContaining({ prompt: 'test prompt' }),
    );
  });

  it('passes numSteps through (default 4)', async () => {
    const env = makeEnv();
    await generateImage(env, { prompt: 'p' });
    const [, input] = env.AI.run.mock.calls[0];
    expect(input.num_steps).toBe(4);

    await generateImage(env, { prompt: 'p', numSteps: 6 });
    expect(env.AI.run.mock.calls[1][1].num_steps).toBe(6);
  });

  it('uploads to R2 with image/png content type', async () => {
    const env = makeEnv();
    await generateImage(env, { prompt: 'hello' });
    expect(env.MARKETING_ASSETS.put).toHaveBeenCalledTimes(1);
    const [key, body, opts] = env.MARKETING_ASSETS.put.mock.calls[0];
    expect(key).toMatch(/^posts\/[0-9a-f]{16}\.png$/);
    expect(body).toBeInstanceOf(Uint8Array);
    expect(opts.httpMetadata.contentType).toBe('image/png');
  });

  it('uses provided key when given (e.g. slot ID)', async () => {
    const env = makeEnv();
    const result = await generateImage(env, {
      prompt: 'whatever',
      key: 'posts/slot_20260515_0900.png',
    });
    expect(result.key).toBe('posts/slot_20260515_0900.png');
    expect(env.MARKETING_ASSETS.put).toHaveBeenCalledWith(
      'posts/slot_20260515_0900.png',
      expect.any(Uint8Array),
      expect.any(Object),
    );
  });

  it('deterministic R2 key for same prompt', async () => {
    const env1 = makeEnv();
    const env2 = makeEnv();
    const r1 = await generateImage(env1, { prompt: 'identical prompt' });
    const r2 = await generateImage(env2, { prompt: 'identical prompt' });
    expect(r1.key).toBe(r2.key);
  });

  it('returns public URL composed of PUBLIC_URL + key', async () => {
    const env = makeEnv();
    const r = await generateImage(env, {
      prompt: 'x',
      key: 'posts/abc.png',
    });
    expect(r.url).toBe('https://pub-abc.r2.dev/posts/abc.png');
  });

  it('strips trailing slash from MARKETING_ASSETS_PUBLIC_URL', async () => {
    const env = makeEnv();
    env.MARKETING_ASSETS_PUBLIC_URL = 'https://pub-abc.r2.dev///';
    const r = await generateImage(env, { prompt: 'x', key: 'posts/abc.png' });
    expect(r.url).toBe('https://pub-abc.r2.dev/posts/abc.png');
  });

  it('throws clear error when env.AI missing', async () => {
    await expect(
      generateImage({ MARKETING_ASSETS: { put: vi.fn() }, MARKETING_ASSETS_PUBLIC_URL: 'x' }, {
        prompt: 'p',
      }),
    ).rejects.toThrow(/env\.AI/);
  });

  it('throws clear error when MARKETING_ASSETS binding missing', async () => {
    await expect(
      generateImage({ AI: { run: vi.fn() }, MARKETING_ASSETS_PUBLIC_URL: 'x' }, {
        prompt: 'p',
      }),
    ).rejects.toThrow(/MARKETING_ASSETS/);
  });

  it('throws clear error when PUBLIC_URL var missing', async () => {
    await expect(
      generateImage({ AI: { run: vi.fn() }, MARKETING_ASSETS: { put: vi.fn() } }, {
        prompt: 'p',
      }),
    ).rejects.toThrow(/PUBLIC_URL/);
  });

  it('throws when prompt is empty', async () => {
    const env = makeEnv();
    await expect(generateImage(env, { prompt: '' })).rejects.toThrow(/prompt/);
    await expect(generateImage(env, {})).rejects.toThrow(/prompt/);
  });

  it('wraps AI.run errors with context', async () => {
    const env = makeEnv();
    env.AI.run = vi.fn().mockRejectedValue(new Error('rate limited'));
    await expect(generateImage(env, { prompt: 'p' })).rejects.toThrow(/AI\.run failed.*rate limited/);
  });

  it('wraps R2.put errors with context', async () => {
    const env = makeEnv({
      r2PutImpl: async () => {
        throw new Error('bucket full');
      },
    });
    await expect(generateImage(env, { prompt: 'p' })).rejects.toThrow(/R2 put failed.*bucket full/);
  });

  it('throws when AI returns empty/unsupported response', async () => {
    const env = makeEnv({ aiResponse: null });
    await expect(generateImage(env, { prompt: 'p' })).rejects.toThrow(/no image bytes/);
  });

  it('returns size in bytes', async () => {
    const env = makeEnv();
    const r = await generateImage(env, { prompt: 'p' });
    expect(r.size).toBe(8); // PNG_HEADER length
    expect(r.contentType).toBe('image/png');
  });
});
