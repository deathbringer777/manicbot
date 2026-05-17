/**
 * @fileoverview /ws/messenger/{tenantId} — WebSocket upgrade endpoint.
 *
 * Auth flow:
 *   1. admin-app calls `messenger.issueWsToken({ tenantId })` → returns a
 *      short-lived HMAC token bound to (tenantId, webUserId, exp).
 *   2. Browser opens `wss://manicbot.com/ws/messenger/{tenantId}?token=...`.
 *   3. This handler verifies the token, then forwards the Upgrade request
 *      to the tenant's MessengerHub Durable Object.
 *
 * Worker MUST verify the token claims match the tenantId in the path — a
 * leaked token for tenant A must not let the holder subscribe to tenant B.
 */

import { verifyWsToken } from '../utils/wsToken.js';
import { log } from '../utils/logger.js';

/**
 * @param {Request} request
 * @param {object} env
 * @param {URL} url
 * @returns {Promise<Response|null>}
 */
export async function tryMessengerWsRoute(request, env, url) {
  if (!url.pathname.startsWith('/ws/messenger/')) return null;

  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  // Path: /ws/messenger/{tenantId}
  const tenantId = url.pathname.slice('/ws/messenger/'.length);
  if (!tenantId || tenantId.includes('/')) {
    return new Response('Bad tenant id', { status: 400 });
  }

  if (!env.WS_TOKEN_SECRET) {
    log.error('messengerWs', new Error('WS_TOKEN_SECRET not configured'), { tenantId });
    return new Response('WS realtime not configured', { status: 503 });
  }
  if (!env.MESSENGER_HUB) {
    log.error('messengerWs', new Error('MESSENGER_HUB DO binding missing'), { tenantId });
    return new Response('WS realtime not bound', { status: 503 });
  }

  const token = url.searchParams.get('token');
  if (!token) return new Response('token required', { status: 401 });

  const claims = await verifyWsToken(env.WS_TOKEN_SECRET, token);
  if (!claims) return new Response('Invalid or expired token', { status: 401 });
  if (claims.tenantId !== tenantId) {
    // Token bound to a different tenant — refuse defense-in-depth.
    return new Response('Token/tenant mismatch', { status: 403 });
  }

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected websocket upgrade', { status: 426 });
  }

  // Forward the upgrade request to the tenant's MessengerHub DO.
  const id = env.MESSENGER_HUB.idFromName(tenantId);
  const stub = env.MESSENGER_HUB.get(id);
  // Rewrite path so the DO sees /ws, regardless of the public path.
  const forwarded = new Request(new URL('/ws', request.url), request);
  return stub.fetch(forwarded);
}

/**
 * Publish a frame to the MessengerHub DO for a tenant. Called by Worker
 * inbound + outbound paths. Best-effort: failures log but don't break the
 * caller's request — polling fallback still updates the UI within 5s.
 *
 * @param {object} env
 * @param {string} tenantId
 * @param {object} payload - any JSON-serializable frame; must include `type`
 */
export async function publishToMessengerHub(env, tenantId, payload) {
  if (!env?.MESSENGER_HUB || !tenantId || !payload) return false;
  try {
    const id = env.MESSENGER_HUB.idFromName(tenantId);
    const stub = env.MESSENGER_HUB.get(id);
    const resp = await stub.fetch('https://hub.local/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, tenantId }),
    });
    return resp.ok;
  } catch (e) {
    log.warn('messengerWs.publish', { tenantId, error: e?.message });
    return false;
  }
}
