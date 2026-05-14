/**
 * Workers AI image generation for the @manicbot_com IG autopilot.
 *
 * Uses Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell`
 * (free on Workers Free plan, ~50 neurons/image on paid) and uploads
 * the resulting PNG to the MARKETING_ASSETS R2 bucket. The bucket has
 * public r2.dev access enabled, so Meta Graph API can fetch the
 * uploaded URL when creating a media container.
 *
 * Output dimensions: 1024×1024 (flux-schnell native). IG accepts
 * square Feed posts. A follow-up will pad to 1080×1350 via Photon
 * WASM to match the manus-generated 3:4 ratio.
 *
 * Idempotency: pass `key` (e.g. slot ID) to overwrite the same R2
 * object on re-runs; otherwise defaults to a SHA-256 of the prompt
 * (16-char hex prefix).
 */

import { log } from '../utils/logger.js';

const MODEL_ID = '@cf/black-forest-labs/flux-1-schnell';
const DEFAULT_NUM_STEPS = 4; // schnell is fast: 1-4 steps. Higher = better quality, slower.
const CONTENT_TYPE = 'image/png';

/**
 * @param {{ AI: { run: (model: string, input: object) => Promise<any> },
 *            MARKETING_ASSETS: { put: (key: string, body: Uint8Array, opts?: object) => Promise<any> },
 *            MARKETING_ASSETS_PUBLIC_URL: string }} env
 * @param {{ prompt: string, key?: string, numSteps?: number }} input
 * @returns {Promise<{ url: string, key: string, size: number, contentType: string }>}
 */
export async function generateImage(env, { prompt, key, numSteps = DEFAULT_NUM_STEPS }) {
  if (!env?.AI?.run) {
    throw new Error('imageGen: env.AI binding missing');
  }
  if (!env?.MARKETING_ASSETS?.put) {
    throw new Error('imageGen: env.MARKETING_ASSETS R2 binding missing');
  }
  if (!env?.MARKETING_ASSETS_PUBLIC_URL) {
    throw new Error('imageGen: MARKETING_ASSETS_PUBLIC_URL var missing');
  }
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('imageGen: prompt must be a non-empty string');
  }

  const objectKey = key || `posts/${await hashPrompt(prompt)}.png`;

  // 1. Generate.
  const aiInput = { prompt, num_steps: numSteps };
  let aiResponse;
  try {
    aiResponse = await env.AI.run(MODEL_ID, aiInput);
  } catch (err) {
    log.error('marketing.imageGen', err instanceof Error ? err : new Error(String(err)), {
      stage: 'ai.run',
      model: MODEL_ID,
      promptLen: prompt.length,
    });
    throw new Error(`imageGen: AI.run failed: ${err?.message ?? 'unknown'}`);
  }

  const bytes = extractPngBytes(aiResponse);
  if (!bytes || bytes.byteLength === 0) {
    log.error('marketing.imageGen', new Error('empty AI response'), {
      stage: 'extract',
      responseShape: describeShape(aiResponse),
    });
    throw new Error('imageGen: AI returned no image bytes');
  }

  // 2. Upload to R2.
  try {
    await env.MARKETING_ASSETS.put(objectKey, bytes, {
      httpMetadata: { contentType: CONTENT_TYPE },
    });
  } catch (err) {
    log.error('marketing.imageGen', err instanceof Error ? err : new Error(String(err)), {
      stage: 'r2.put',
      objectKey,
      sizeBytes: bytes.byteLength,
    });
    throw new Error(`imageGen: R2 put failed: ${err?.message ?? 'unknown'}`);
  }

  const publicBase = String(env.MARKETING_ASSETS_PUBLIC_URL).replace(/\/+$/, '');
  const url = `${publicBase}/${objectKey}`;

  log.info('marketing.imageGen', {
    stage: 'ok',
    objectKey,
    sizeBytes: bytes.byteLength,
    numSteps,
  });

  return { url, key: objectKey, size: bytes.byteLength, contentType: CONTENT_TYPE };
}

/**
 * flux-1-schnell returns one of:
 *   - `{ image: '<base64 PNG>' }` (Workers AI binding shape)
 *   - `ReadableStream` (raw bytes — newer SDK)
 *   - `Uint8Array` (rare, tests pass this directly)
 * Normalize to Uint8Array.
 *
 * @param {any} response
 * @returns {Uint8Array | null}
 */
export function extractPngBytes(response) {
  if (!response) return null;
  if (response instanceof Uint8Array) return response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  if (typeof response.image === 'string') {
    return base64ToBytes(response.image);
  }
  // ReadableStream path — caller must await; we expect already-collected bytes
  // here, so a stream is treated as unsupported in this pure-function path.
  // Real-world callers can pre-collect via new Response(stream).arrayBuffer().
  return null;
}

function base64ToBytes(b64) {
  // Strip data URL prefix if present.
  const clean = b64.replace(/^data:image\/\w+;base64,/, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hashPrompt(prompt) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(prompt));
  return Array.from(new Uint8Array(buf))
    .slice(0, 8) // 16 hex chars
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function describeShape(v) {
  if (v == null) return 'null';
  if (v instanceof Uint8Array) return `Uint8Array(${v.byteLength})`;
  if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength})`;
  if (typeof v === 'object') return Object.keys(v).slice(0, 5).join(',');
  return typeof v;
}
