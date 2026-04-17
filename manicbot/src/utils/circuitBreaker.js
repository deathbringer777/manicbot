/**
 * @fileoverview Circuit breaker for external API calls (Stripe, Google, Meta, Resend).
 *
 * State machine: closed → open (after N failures) → half-open (after cooldown)
 * → closed (if next call succeeds) or back to open.
 *
 * State is stored in KV with a short TTL so failures heal automatically and the
 * worker can pick up across cold starts.
 */

const DEFAULT_FAIL_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

export class CircuitBreaker {
  /**
   * @param {string} name - identifier for KV key, e.g. 'stripe', 'google-api'
   * @param {object} [opts]
   * @param {number} [opts.failThreshold=5]
   * @param {number} [opts.cooldownMs=30000]
   */
  constructor(name, opts = {}) {
    this.name = name;
    this.failThreshold = opts.failThreshold ?? DEFAULT_FAIL_THRESHOLD;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  async _read(env) {
    if (!env?.MANICBOT?.get) return null;
    const raw = await env.MANICBOT.get(`cb:${this.name}`, 'text');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async _write(env, state) {
    if (!env?.MANICBOT?.put) return;
    const ttl = Math.max(60, Math.ceil(this.cooldownMs / 1000) + 30);
    await env.MANICBOT.put(`cb:${this.name}`, JSON.stringify(state), { expirationTtl: ttl });
  }

  async _clear(env) {
    if (!env?.MANICBOT?.delete) return;
    await env.MANICBOT.delete(`cb:${this.name}`);
  }

  /**
   * Execute the wrapped operation through the breaker.
   * @template T
   * @param {{ MANICBOT?: KVNamespace }} env
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   * @throws {Error} 'circuit_open:<name>' when the breaker is open
   */
  async call(env, fn) {
    const state = await this._read(env);
    if (state?.status === 'open' && Date.now() < state.openUntil) {
      const err = new Error(`circuit_open:${this.name}`);
      err.code = 'CIRCUIT_OPEN';
      err.openUntil = state.openUntil;
      throw err;
    }
    try {
      const result = await fn();
      // Success — reset
      if (state) await this._clear(env);
      return result;
    } catch (err) {
      const fails = (state?.fails ?? 0) + 1;
      if (fails >= this.failThreshold) {
        await this._write(env, {
          status: 'open',
          fails,
          openUntil: Date.now() + this.cooldownMs,
        });
      } else {
        await this._write(env, { status: 'closed', fails });
      }
      throw err;
    }
  }
}

/**
 * Retry a function with exponential backoff + jitter.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.attempts=3]
 * @param {number} [opts.baseMs=300]
 * @param {(err: Error) => boolean} [opts.shouldRetry]
 * @returns {Promise<T>}
 */
export async function withJitteredRetry(fn, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 300;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1 || !shouldRetry(e)) throw e;
      const delay = baseMs * Math.pow(2, i) + Math.random() * baseMs;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
