/**
 * Shared Graph API POST + GET with retry + exponential backoff.
 * Used by Instagram and WhatsApp adapters.
 */

import { log } from '../utils/logger.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const GRAPH_API_IG = 'https://graph.instagram.com/v21.0';

export { GRAPH_API, GRAPH_API_IG };

/**
 * Pick the Graph host. 'facebook' (default, legacy Page Messenger) →
 * graph.facebook.com. 'instagram' (post-Mar-2026 Instagram Login product) →
 * graph.instagram.com — accepts IGAA-prefixed user tokens.
 * @param {'facebook'|'instagram'} [host]
 */
export function graphBase(host) {
  return host === 'instagram' ? GRAPH_API_IG : GRAPH_API;
}

/**
 * Pick the Graph host from the token when the caller didn't pass an explicit one.
 * IGAA-prefixed tokens (Instagram Login product) ONLY work on graph.instagram.com;
 * EAA / WhatsApp / system-user tokens use graph.facebook.com. Keeps existing callers
 * (which pass no host) correct for both messaging and the marketing autopilot.
 * @param {string} token
 * @returns {'facebook'|'instagram'}
 */
export function hostForToken(token) {
  return typeof token === 'string' && token.startsWith('IGAA') ? 'instagram' : 'facebook';
}

/**
 * Meta error codes that mean the token is dead (re-auth required).
 * Code 190 = OAuthException; subcode 463 = user hasn't authorized.
 * Code 200 = app doesn't have permission (scope change).
 * Type 'OAuthException' is the umbrella signal.
 */
export function isTokenDead(errorData) {
  const err = errorData?.error || errorData;
  if (!err) return false;
  if (err.type === 'OAuthException') return true;
  if (err.code === 190) return true;
  if (err.code === 200) return true;
  return false;
}

/**
 * @param {string} path - Graph API path (e.g. "/{pageId}/messages")
 * @param {string} token - Access token
 * @param {object} body - JSON body
 * @param {{ maxRetries?: number, label?: string }} [opts]
 * @returns {Promise<{ ok: boolean, data?: any, status?: number, error?: string }>}
 */
export async function graphPost(path, token, body, { maxRetries = 2, label = 'graph', host } = {}) {
  const base = graphBase(host ?? hostForToken(token));
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      // 429 (rate limit) or 5xx (server error) → retry
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        log.warn(`channels.${label}`, { message: `POST ${path} got ${res.status}, retrying`, attempt: attempt + 1, maxRetries });
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      log.error(`channels.${label}`, new Error(`POST ${path} failed ${res.status}`), { status: res.status });
      // Signal token-dead to caller so they can mark integration needs_reauth.
      return {
        ok: false,
        status: res.status,
        error: data.error?.message ?? 'unknown',
        errorCode: data.error?.code,
        errorType: data.error?.type,
        tokenDead: isTokenDead(data),
      };
    } catch (e) {
      if (attempt < maxRetries) {
        log.warn(`channels.${label}`, { message: `POST ${path} fetch error, retrying`, attempt: attempt + 1, maxRetries });
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      log.error(`channels.${label}`, e instanceof Error ? e : new Error(String(e.message)));
      return { ok: false, error: e.message };
    }
  }
}

/**
 * Shared Graph API GET. Same retry semantics as graphPost.
 * Use for read-only ops like polling container status or fetching insights.
 *
 * @param {string} path - Graph API path with optional querystring (e.g. "/{containerId}?fields=status_code")
 * @param {string} token - Access token
 * @param {{ maxRetries?: number, label?: string, host?: 'facebook'|'instagram' }} [opts]
 * @returns {Promise<{ ok: boolean, data?: any, status?: number, error?: string, errorCode?: number, errorType?: string, tokenDead?: boolean }>}
 */
export async function graphGet(path, token, { maxRetries = 2, label = 'graph', host } = {}) {
  const base = graphBase(host ?? hostForToken(token));
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        log.warn(`channels.${label}`, { message: `GET ${path} got ${res.status}, retrying`, attempt: attempt + 1, maxRetries });
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      log.error(`channels.${label}`, new Error(`GET ${path} failed ${res.status}`), { status: res.status });
      return {
        ok: false,
        status: res.status,
        error: data.error?.message ?? 'unknown',
        errorCode: data.error?.code,
        errorType: data.error?.type,
        tokenDead: isTokenDead(data),
      };
    } catch (e) {
      if (attempt < maxRetries) {
        log.warn(`channels.${label}`, { message: `GET ${path} fetch error, retrying`, attempt: attempt + 1, maxRetries });
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      log.error(`channels.${label}`, e instanceof Error ? e : new Error(String(e.message)));
      return { ok: false, error: e.message };
    }
  }
}
