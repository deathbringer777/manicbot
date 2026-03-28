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
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
