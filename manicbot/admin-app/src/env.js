import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    ADMIN_CHAT_ID: z.string().optional(),
    /** Публичный URL Worker (без слэша в конце), для подсказок webhook в Mini App */
    WORKER_PUBLIC_URL: z.string().optional(),
    /** Должны совпадать с секретами Worker META_VERIFY_TOKEN_WA / META_VERIFY_TOKEN_IG */
    META_VERIFY_TOKEN_WA: z.string().optional(),
    META_VERIFY_TOKEN_IG: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  client: {},

  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
    WORKER_PUBLIC_URL: process.env.WORKER_PUBLIC_URL,
    META_VERIFY_TOKEN_WA: process.env.META_VERIFY_TOKEN_WA,
    META_VERIFY_TOKEN_IG: process.env.META_VERIFY_TOKEN_IG,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
