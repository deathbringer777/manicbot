import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // The MessengerHub WebSocket e2e runs in the workers pool, not node — it
    // has its own config (vitest.workers.config.js / npm run test:ws). Exclude
    // it here so `npm test` (node) doesn't try to load `cloudflare:test`.
    exclude: [...configDefaults.exclude, 'test/messenger-ws-integration.test.js'],
    // Node.js environment — crypto.subtle доступен в Node 19+
    // @cloudflare/vitest-pool-workers установлен, но не используется:
    // Workers-specific API (Cache, Durable Objects) не нужны в unit-тестах.
    // Если понадобится — добавить: pool: '@cloudflare/vitest-pool-workers'
    environment: 'node',
    // Явно разрешаем использование ES modules из src/
    globals: false,
    // Покрытие — запускается отдельно: vitest run --coverage
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/worker.js'],
    },
  },
});
