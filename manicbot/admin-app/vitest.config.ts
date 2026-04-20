import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
      { find: /^@plugins\/(.*)$/, replacement: path.resolve(__dirname, "../plugins") + "/$1" },
      // Stub next-auth in test env (avoids importing next/server in Node.js)
      { find: /^next-auth\/providers\/credentials$/, replacement: path.resolve(__dirname, "src/__mocks__/next-auth-providers-credentials.ts") },
      { find: /^next-auth$/, replacement: path.resolve(__dirname, "src/__mocks__/next-auth.ts") },
      // Stub @cloudflare/next-on-pages — real module imports `server-only`
      // which throws outside RSC. runtimeEnv.ts treats a throw as "not in
      // Cloudflare request scope" and falls back to process.env.
      { find: /^@cloudflare\/next-on-pages$/, replacement: path.resolve(__dirname, "src/__mocks__/cloudflare-next-on-pages.ts") },
    ],
  },
});
