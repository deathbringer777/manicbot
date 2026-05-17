/**
 * @fileoverview MessengerHub — Durable Object for real-time messenger fan-out.
 *
 * One DO instance per tenant (`idFromName(tenantId)`). Holds open WebSocket
 * connections from staff browsers and broadcasts `message.new` /
 * `thread.updated` frames published by the Worker on inbound + outbound
 * messenger events.
 *
 * Uses Cloudflare's hibernatable WebSocket API
 * (`state.acceptWebSocket(server)`) so an idle tenant doesn't burn CPU time.
 *
 * Frames are JSON objects of shape `{ type, tenantId, payload }`. Clients
 * filter by `tenantId` defense-in-depth even though the DO is per-tenant.
 *
 * HTTP surface:
 *   - GET  /ws        — upgrade to WebSocket (caller already auth'd via JWT)
 *   - POST /publish   — JSON body broadcast to all sockets
 *
 * The Worker is responsible for verifying the JWT BEFORE forwarding the
 * upgrade — see manicbot/src/http/messengerWsHttp.js.
 */

export class MessengerHub {
  /**
   * @param {DurableObjectState} state
   * @param {object} env
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected websocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Hibernatable accept — DO can sleep between messages.
      try {
        this.state.acceptWebSocket(server);
      } catch {
        // Older runtime: fallback to manual accept.
        server.accept();
      }

      // Greet so the client knows the connection landed.
      try {
        server.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
      } catch {
        /* socket may have closed already */
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }
      const frame = JSON.stringify(payload);
      const sockets = typeof this.state.getWebSockets === 'function'
        ? this.state.getWebSockets()
        : [];
      let delivered = 0;
      for (const ws of sockets) {
        try {
          ws.send(frame);
          delivered += 1;
        } catch {
          /* drop sockets that fail to send — they'll be GC'd by the runtime */
        }
      }
      return Response.json({ ok: true, delivered });
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Inbound WebSocket message handler — required for hibernatable sockets.
   * Currently a no-op: clients only listen for broadcasts in Phase 3.
   * Phase 4 will accept `typing.start` / `typing.stop` etc.
   *
   * @param {WebSocket} ws
   * @param {string|ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    // Echo "ping" → "pong" so clients can keep the connection warm.
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      if (text === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    } catch {
      /* swallow */
    }
  }

  /**
   * Required for hibernatable sockets — runtime cleans up on disconnect.
   */
  async webSocketClose(_ws, _code, _reason, _wasClean) {
    /* nothing to clean — sockets aren't tracked manually */
  }

  /**
   * Surface socket-level errors so the runtime closes them cleanly.
   */
  async webSocketError(_ws, _err) {
    /* nothing to log — broken sockets just get dropped */
  }
}
