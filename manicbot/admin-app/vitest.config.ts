import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // t3-env validates on import; keep tests hermetic without a real .env
    env: {
      TELEGRAM_BOT_TOKEN: "0:TEST_dummy_token_for_vitest_only",
      SKIP_ENV_VALIDATION: "1",
    },
  },
  resolve: {
    alias: [
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      // Stub next-auth in test env (avoids importing next/server in Node.js)
      { find: /^next-auth\/providers\/credentials$/, replacement: path.resolve(__dirname, "src/__mocks__/next-auth-providers-credentials.ts") },
      { find: /^next-auth$/, replacement: path.resolve(__dirname, "src/__mocks__/next-auth.ts") },
    ],
  },
});
