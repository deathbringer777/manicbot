import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const isProduction = process.env.NODE_ENV === "production";

/**
 * @param {string} name
 * @param {number} [minLength]
 */
function secret(name, minLength = 32) {
  return z.string().optional().superRefine((value, ctx) => {
    if (!isProduction) return;
    if (!value || value.length < minLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${name} must be at least ${minLength} characters in production`,
      });
    }
  });
}

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    ADMIN_CHAT_ID: z.string().optional(),
    AUTH_SECRET: secret("AUTH_SECRET", 32),
    /** Публичный URL Worker (без слэша в конце), для подсказок webhook в Mini App */
    WORKER_PUBLIC_URL: z.string().optional(),
    /** Worker ADMIN_KEY — for calling internal Worker APIs (appointment-action, etc.) */
    ADMIN_KEY: secret("ADMIN_KEY", 32),
    /**
     * AES-GCM master key for encrypting bot tokens stored in D1 `bots.token_encrypted`
     * (#H3 — admin-app `connectBot`). MUST be the same value as the Worker secret of
     * the same name, otherwise the Worker cannot decrypt tokens written from the UI.
     */
    BOT_ENCRYPTION_KEY: secret("BOT_ENCRYPTION_KEY", 32),
    /** Shared secret used to sign short-lived upload tokens (must match Worker UPLOAD_TOKEN_SECRET) */
    UPLOAD_TOKEN_SECRET: secret("UPLOAD_TOKEN_SECRET", 32),
    /** Должны совпадать с секретами Worker META_VERIFY_TOKEN_WA / META_VERIFY_TOKEN_IG */
    META_VERIFY_TOKEN_WA: z.string().optional(),
    META_VERIFY_TOKEN_IG: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    /** Resend transactional email */
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM: z.string().optional(),
    /** Stripe billing */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PRICE_START_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_MAX_MONTHLY: z.string().optional(),
    STRIPE_PRICE_START_ANNUAL: z.string().optional(),
    STRIPE_PRICE_PRO_ANNUAL: z.string().optional(),
    STRIPE_PRICE_MAX_ANNUAL: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    /** Mirror of Worker var: "1" when the IG autopilot cron phase is live. */
    MARKETING_AUTOPILOT_ENABLED: z.string().optional(),
    /**
     * Shared HMAC secret for messenger WebSocket tokens. Must match the
     * Worker secret of the same name — the Worker verifies tokens minted
     * here on /ws/messenger upgrade.
     */
    WS_TOKEN_SECRET: secret("WS_TOKEN_SECRET", 32),
    /**
     * Web Push (browser push notifications) — VAPID public key. Returned
     * to the browser by pushSubscriptions.getVapidPublicKey so the
     * browser can call PushManager.subscribe({ applicationServerKey }).
     * Non-secret by design. When unset, the push opt-in UI hides itself.
     */
    VAPID_PUBLIC_KEY: z.string().optional(),
  },

  client: {
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  },

  runtimeEnv: {
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
    AUTH_SECRET: process.env.AUTH_SECRET,
    WORKER_PUBLIC_URL: process.env.WORKER_PUBLIC_URL,
    ADMIN_KEY: process.env.ADMIN_KEY,
    BOT_ENCRYPTION_KEY: process.env.BOT_ENCRYPTION_KEY,
    UPLOAD_TOKEN_SECRET: process.env.UPLOAD_TOKEN_SECRET,
    META_VERIFY_TOKEN_WA: process.env.META_VERIFY_TOKEN_WA,
    META_VERIFY_TOKEN_IG: process.env.META_VERIFY_TOKEN_IG,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_START_MONTHLY: process.env.STRIPE_PRICE_START_MONTHLY,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_MAX_MONTHLY: process.env.STRIPE_PRICE_MAX_MONTHLY,
    STRIPE_PRICE_START_ANNUAL: process.env.STRIPE_PRICE_START_ANNUAL,
    STRIPE_PRICE_PRO_ANNUAL: process.env.STRIPE_PRICE_PRO_ANNUAL,
    STRIPE_PRICE_MAX_ANNUAL: process.env.STRIPE_PRICE_MAX_ANNUAL,
    NODE_ENV: process.env.NODE_ENV,
    MARKETING_AUTOPILOT_ENABLED: process.env.MARKETING_AUTOPILOT_ENABLED,
    WS_TOKEN_SECRET: process.env.WS_TOKEN_SECRET,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
