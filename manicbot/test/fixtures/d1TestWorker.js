/**
 * Thin test-only Worker entry for the real-D1 integration tests.
 *
 * The @cloudflare/vitest-pool-workers pool requires a `main` module, but the
 * D1 tests drive `env.DB` (the real miniflare SQLite binding) directly through
 * the service layer — they never fetch this Worker — so a stub `fetch` is all
 * that's needed. Loaded by `vitest.d1.config.mjs`; not a `*.test.js` file, and
 * the default node suite excludes `*.d1.test.js`, so it never double-runs.
 */
export default {
  async fetch() {
    return new Response('not found', { status: 404 });
  },
};
