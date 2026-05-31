/**
 * MessengerHub WebSocket — end-to-end integration test.
 *
 * Unlike `messenger-hub-typing.test.js` (a unit stub of the DO class), this
 * test drives the REAL path inside workerd via @cloudflare/vitest-pool-workers:
 *   real HMAC token  →  real `tryMessengerWsRoute` (auth + tenant guard)
 *   →  real `idFromName(tenantId)` routing  →  real MessengerHub DO
 *   →  real hibernatable WebSocket fan-out.
 *
 * Scope = server-observable truth only. The connect/reconnect/disconnect
 * "connection-status" state machine lives CLIENT-side in
 * `admin-app/src/hooks/useMessengerSocket.ts` (the server never emits a
 * connected/reconnecting/disconnected frame), so it is intentionally NOT
 * asserted here — it belongs in a frontend unit test.
 *
 * Runs only under `vitest.workers.config.js` (npm run test:ws).
 */
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { mintWsToken } from '../src/utils/wsToken.js';

const SECRET = env.WS_TOKEN_SECRET;

async function tokenFor(tenantId, webUserId = 'wu_test') {
  return mintWsToken(SECRET, { tenantId, webUserId });
}

function wsUrl(tenantId, token) {
  const q = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
  return `https://hub.test/ws/messenger/${tenantId}${q}`;
}

/**
 * Open an authenticated socket. Returns `{ res, ws, frames }`. On a non-101
 * response `ws` is null and `frames` stays empty. Frames are parsed JSON.
 */
async function openSocket(tenantId, token, { upgrade = true } = {}) {
  const headers = upgrade ? { Upgrade: 'websocket' } : {};
  const res = await SELF.fetch(wsUrl(tenantId, token), { headers });
  if (res.status !== 101 || !res.webSocket) return { res, ws: null, frames: [] };
  const ws = res.webSocket;
  const frames = [];
  ws.accept();
  ws.addEventListener('message', (e) => {
    try {
      frames.push(JSON.parse(e.data));
    } catch {
      frames.push(e.data);
    }
  });
  return { res, ws, frames };
}

/** Poll `pred` until true or timeout; returns whether it became true. */
async function until(pred, { timeout = 2000, interval = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    if (pred()) return true;
    if (Date.now() - start >= timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

const hasType = (frames, type) => frames.some((f) => f && f.type === type);
const ofType = (frames, type) => frames.filter((f) => f && f.type === type);

describe('MessengerHub WebSocket integration (real Durable Object)', () => {
  it('connect with a valid token → 101 and a hello frame', async () => {
    const { res, ws, frames } = await openSocket('t_connect', await tokenFor('t_connect'));
    expect(res.status).toBe(101);
    expect(ws).not.toBeNull();
    expect(await until(() => hasType(frames, 'hello'))).toBe(true);
    expect(typeof frames.find((f) => f.type === 'hello').ts).toBe('number');
    ws.close();
  });

  it('peer typing is delivered to the OTHER socket, never the sender', async () => {
    const tok = await tokenFor('t_typing');
    const a = await openSocket('t_typing', tok);
    const b = await openSocket('t_typing', tok);
    expect(await until(() => hasType(a.frames, 'hello') && hasType(b.frames, 'hello'))).toBe(true);

    a.ws.send(JSON.stringify({ type: 'typing', threadId: 'th_1', memberRef: 'w_a', displayName: 'Anna' }));

    expect(await until(() => hasType(b.frames, 'typing'))).toBe(true);
    const t = ofType(b.frames, 'typing')[0];
    expect(t.threadId).toBe('th_1');
    expect(t.memberRef).toBe('w_a');
    expect(t.displayName).toBe('Anna');
    expect(t.until).toBeGreaterThan(Date.now());
    // The sender must not receive its own typing echo (only its own hello).
    expect(ofType(a.frames, 'typing')).toHaveLength(0);
    a.ws.close();
    b.ws.close();
  });

  it('cross-tenant isolation: tenant B never receives tenant A typing', async () => {
    const a = await openSocket('t_iso_a', await tokenFor('t_iso_a'));
    const b = await openSocket('t_iso_b', await tokenFor('t_iso_b'));
    expect(await until(() => hasType(a.frames, 'hello') && hasType(b.frames, 'hello'))).toBe(true);

    a.ws.send(JSON.stringify({ type: 'typing', threadId: 'th_x', memberRef: 'w_a' }));
    // Give the broadcast ample time; B (a different idFromName DO) must stay quiet.
    await new Promise((r) => setTimeout(r, 300));
    expect(ofType(b.frames, 'typing')).toHaveLength(0);
    a.ws.close();
    b.ws.close();
  });

  it('token bound to another tenant → 403, no socket', async () => {
    const tokenForA = await tokenFor('t_real');
    const res = await SELF.fetch(wsUrl('t_other', tokenForA), { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(403);
    expect(res.webSocket == null).toBe(true);
  });

  it('missing token → 401', async () => {
    const res = await SELF.fetch(wsUrl('t_real', undefined), { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(401);
  });

  it('valid token but no Upgrade header → 426', async () => {
    const res = await SELF.fetch(wsUrl('t_real', await tokenFor('t_real')), { headers: {} });
    expect(res.status).toBe(426);
  });

  it('after a peer disconnects, the remaining socket still sends/receives', async () => {
    const tok = await tokenFor('t_disc');
    const a = await openSocket('t_disc', tok);
    const b = await openSocket('t_disc', tok);
    expect(await until(() => hasType(a.frames, 'hello') && hasType(b.frames, 'hello'))).toBe(true);

    b.ws.close();
    await new Promise((r) => setTimeout(r, 100));

    // A new peer C joins; A's typing must still fan out to live sockets.
    const c = await openSocket('t_disc', tok);
    expect(await until(() => hasType(c.frames, 'hello'))).toBe(true);
    a.ws.send(JSON.stringify({ type: 'typing', threadId: 'th_2', memberRef: 'w_a' }));
    expect(await until(() => hasType(c.frames, 'typing'))).toBe(true);
    a.ws.close();
    c.ws.close();
  });
});
