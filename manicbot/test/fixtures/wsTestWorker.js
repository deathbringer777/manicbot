/**
 * Thin test-only Worker entry for the MessengerHub WebSocket integration test.
 *
 * It re-exports the REAL MessengerHub Durable Object and delegates `fetch` to
 * the REAL upgrade/token handler (`tryMessengerWsRoute`), so the integration
 * test exercises the production auth + `idFromName(tenantId)` routing + DO
 * fan-out — not a reimplementation.
 *
 * Booting the full `src/worker.js` in the pool is avoided on purpose: it runs
 * `validateSecurityConfig(env)` and demo/preview provisioning at request time,
 * which would require a large binding surface this focused test doesn't need.
 *
 * Loaded by `vitest.workers.config.js` (the @cloudflare/vitest-pool-workers
 * project). It is not a `*.test.js` file, and the default node config also
 * excludes the integration spec, so it never runs under the node suite.
 */
import { tryMessengerWsRoute } from '../../src/http/messengerWsHttp.js';

export { MessengerHub } from '../../src/durable/messengerHub.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await tryMessengerWsRoute(request, env, url);
    return res ?? new Response('not found', { status: 404 });
  },
};
