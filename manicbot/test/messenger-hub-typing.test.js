/**
 * MessengerHub typing re-broadcast: ephemeral, delivered to OTHER sockets only,
 * server-clamped, never persisted. Ping keep-alive must still work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerHub } from '../src/durable/messengerHub.js';

function mkWs() {
  return { send: vi.fn() };
}
function mkHub(sockets) {
  const state = {
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
  };
  return new MessengerHub(state, {});
}

describe('MessengerHub.webSocketMessage — typing', () => {
  let wsA, wsB, hub;
  beforeEach(() => {
    wsA = mkWs();
    wsB = mkWs();
    hub = mkHub([wsA, wsB]);
  });

  it('re-broadcasts a typing frame to OTHER sockets, not the sender', async () => {
    await hub.webSocketMessage(
      wsA,
      JSON.stringify({ type: 'typing', threadId: 'th_1', memberRef: 'w_a', displayName: 'Anna' }),
    );
    expect(wsA.send).not.toHaveBeenCalled();
    expect(wsB.send).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsB.send.mock.calls[0][0]);
    expect(frame.type).toBe('typing');
    expect(frame.threadId).toBe('th_1');
    expect(frame.memberRef).toBe('w_a');
    expect(frame.displayName).toBe('Anna');
    expect(frame.until).toBeGreaterThan(Date.now());
  });

  it('still answers ping with pong', async () => {
    await hub.webSocketMessage(wsA, 'ping');
    expect(wsA.send).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsA.send.mock.calls[0][0]);
    expect(frame.type).toBe('pong');
  });

  it('ignores malformed JSON', async () => {
    await hub.webSocketMessage(wsA, 'not json{');
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it('ignores a typing frame missing threadId/memberRef', async () => {
    await hub.webSocketMessage(wsA, JSON.stringify({ type: 'typing' }));
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it('clamps a client-supplied until to ~6s server-side', async () => {
    await hub.webSocketMessage(
      wsA,
      JSON.stringify({ type: 'typing', threadId: 'th_1', memberRef: 'w_a', until: 9_999_999_999_999 }),
    );
    const frame = JSON.parse(wsB.send.mock.calls[0][0]);
    expect(frame.until).toBeLessThanOrEqual(Date.now() + 6000);
  });

  it('truncates an overlong displayName', async () => {
    await hub.webSocketMessage(
      wsA,
      JSON.stringify({ type: 'typing', threadId: 'th_1', memberRef: 'w_a', displayName: 'x'.repeat(200) }),
    );
    const frame = JSON.parse(wsB.send.mock.calls[0][0]);
    expect(frame.displayName.length).toBe(80);
  });
});
