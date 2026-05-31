import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Workers-pool project for the MessengerHub WebSocket integration test.
 *
 * Runs ONLY `test/messenger-ws-integration.test.js` inside the real workerd
 * runtime (@cloudflare/vitest-pool-workers) so the test drives a genuine
 * Durable Object + hibernatable WebSocket. Every other Worker test stays on
 * the default node config (`vitest.config.js`), which excludes this spec.
 *
 * Vitest 4 reworked pools: the pool is registered as a Vite *plugin* via
 * `cloudflareTest(workersOptions)` — there is no `test.pool`/`test.poolOptions`
 * and no `@cloudflare/vitest-pool-workers/config` subpath in 0.16.x.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      // Thin fixture: re-exports the real MessengerHub + mounts the real
      // messengerWsHttp upgrade/token handler.
      main: './test/fixtures/wsTestWorker.js',
      miniflare: {
        // Mirror wrangler.toml (compatibility_date = "2025-01-01", no flags).
        compatibilityDate: '2025-01-01',
        // Bind the DO inline against the fixture's MessengerHub export.
        durableObjects: {
          MESSENGER_HUB: { className: 'MessengerHub' },
        },
        // HMAC secret the upgrade handler verifies against. Test-only value;
        // the test mints tokens with the SAME secret via mintWsToken.
        bindings: {
          WS_TOKEN_SECRET: 'test-ws-secret-please-32-bytes-minimum-aaaa',
        },
      },
    }),
  ],
  test: {
    include: ['test/messenger-ws-integration.test.js'],
  },
});
