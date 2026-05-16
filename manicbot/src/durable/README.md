# Durable Objects

Per-tenant stateful coordinators. Currently one class lives here —
`MessengerHub` (migration 0067, Phase 3 of the internal messenger rollout).

## Wiring rules (every new DO class must follow)

1. **Export from `src/worker.js`.** `wrangler` looks at the entry module's
   exports for class symbols.

   ```js
   export { MessengerHub } from './durable/messengerHub.js';
   ```

2. **Add binding in `wrangler.toml`.**

   ```toml
   [[durable_objects.bindings]]
   name = "MESSENGER_HUB"     # ctx.MESSENGER_HUB.*
   class_name = "MessengerHub"
   ```

3. **Add a migration block for the first deploy.** Only required when the
   class is brand new (or when renaming / deleting). Subsequent deploys
   skip the migration block entirely.

   ```toml
   [[migrations]]
   tag = "v1"
   new_classes = ["MessengerHub"]
   ```

4. **Pick the partitioning key.** `idFromName(key)` is the cheapest path
   — same `key` always maps to the same instance. For messenger we use
   `tenantId` so a tenant's broadcasts stay in one instance and we don't
   cross-pollinate.

5. **Use hibernatable WebSockets.** Call `state.acceptWebSocket(server)`
   instead of `server.accept()` so the instance can sleep when idle. The
   runtime wakes it on incoming messages.

## Local development

The Worker test suite uses `environment: 'node'` (see `vitest.config.js`),
so WebSocket-level interactions aren't exercised in unit tests. For full
DO testing, switch to `@cloudflare/vitest-pool-workers` (already a dev
dependency).

For now the testing strategy is:
- **Pure-logic tests** for token signing / verification
  (`test/messenger-ws-token.test.js`).
- **End-to-end smoke** via `wrangler dev` after a deploy.
