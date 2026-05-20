/**
 * SEO audit 2026-05-20 — platform-level config (system_admin only).
 *
 * The first consumer is the /about page (founder, year, jurisdiction,
 * support contacts). Future consumers: marketing banners, feature-flag
 * defaults, anything that's "one row for the platform" and historically
 * would have lived in env vars or a constants file.
 *
 * Storage: `platform_config(key TEXT PRIMARY KEY, value TEXT)` —
 * migration 0083. JSON values are stored as TEXT and parsed at the
 * router boundary.
 */
import { z } from "zod";
import { createTRPCRouter, adminProcedure, publicProcedure } from "~/server/api/trpc";
import { platformConfig } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/** Default /about content. Editable from /system/about (admin-app)
 *  by any system_admin. Kept in code as the source-of-truth fallback
 *  so the page never 500s on a fresh install. */
export const ABOUT_DEFAULTS = {
  founderName: "Kirill Vdovin",
  foundedYear: 2025,
  jurisdiction: "Poland",
  supportEmail: "support@manicbot.com",
  telegramHandle: "manicbot_com",
  taglinePl: "ManicBot to platforma SaaS dla salonów paznokci i niezależnych mistrzów. Budujemy AI-recepcjonistę, który obsługuje rezerwacje przez Telegram, Instagram, WhatsApp i widget na stronie — 24 godziny na dobę, w czterech językach.",
  taglineRu: "ManicBot — это SaaS-платформа для nail-салонов и независимых мастеров. Мы строим AI-ресепшен, который обрабатывает записи через Telegram, Instagram, WhatsApp и виджет на сайте — 24 часа в сутки, на четырёх языках.",
  taglineUa: "ManicBot — це SaaS-платформа для nail-салонів і незалежних майстрів. Ми будуємо AI-ресепшен, який обробляє записи через Telegram, Instagram, WhatsApp і віджет на сайті — 24 години на добу, чотирма мовами.",
  taglineEn: "ManicBot is a SaaS platform for nail salons and independent masters. We build an AI receptionist that handles bookings through Telegram, Instagram, WhatsApp, and a website widget — 24/7, in four languages.",
  missionPl: "Naszą misją jest dać każdemu salonowi paznokci recepcjonistę-AI, którego stać. Bez prowizji, bez marketplace, bez wpychania klienta do cudzej aplikacji.",
  missionRu: "Наша миссия — дать каждому nail-салону AI-ресепшена, который ему по карману. Без комиссий, без marketplace, без проталкивания клиента в чужое приложение.",
  missionUa: "Наша місія — дати кожному nail-салону AI-ресепшена, який йому по кишені. Без комісій, без marketplace, без пропихування клієнта в чужий додаток.",
  missionEn: "Our mission is to give every nail salon an AI receptionist they can afford. No commissions, no marketplace, no pushing the client into someone else's app.",
};

export type AboutConfig = typeof ABOUT_DEFAULTS;

const ABOUT_SCHEMA = z.object({
  founderName: z.string().min(1).max(120),
  foundedYear: z.number().int().min(2000).max(2100),
  jurisdiction: z.string().min(1).max(60),
  supportEmail: z.string().email().max(120),
  telegramHandle: z.string().min(1).max(60),
  taglinePl: z.string().min(1).max(600),
  taglineRu: z.string().min(1).max(600),
  taglineUa: z.string().min(1).max(600),
  taglineEn: z.string().min(1).max(600),
  missionPl: z.string().min(1).max(600),
  missionRu: z.string().min(1).max(600),
  missionUa: z.string().min(1).max(600),
  missionEn: z.string().min(1).max(600),
});

const ABOUT_KEY = "about";

/**
 * Pure helper — merge a partial config blob with the defaults so any
 * missing field falls back to the default. Used by both the public
 * read path and the admin save path (to handle schema-additions
 * without breaking the read).
 */
export function mergeAbout(stored: unknown): AboutConfig {
  if (!stored || typeof stored !== "object") return ABOUT_DEFAULTS;
  return { ...ABOUT_DEFAULTS, ...(stored as Partial<AboutConfig>) };
}

async function readAbout(db: { select: (...args: unknown[]) => unknown }): Promise<AboutConfig> {
  // The chained select shape is the same as elsewhere in this codebase.
  // We deliberately await at the limit step because that's the only
  // place where the chain resolves on the in-memory db mock.
  const row = await (db as never as {
    select: (cols: unknown) => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          limit: (n: number) => Promise<Array<{ value: string }>>;
        };
      };
    };
  })
    .select({ value: platformConfig.value })
    .from(platformConfig)
    .where(eq(platformConfig.key, ABOUT_KEY))
    .limit(1);
  if (!row || row.length === 0) return ABOUT_DEFAULTS;
  try {
    return mergeAbout(JSON.parse(row[0]?.value ?? "{}"));
  } catch {
    return ABOUT_DEFAULTS;
  }
}

export const platformConfigRouter = createTRPCRouter({
  /**
   * Public read for the /about page. Returns either the stored config
   * merged with defaults, or the pure defaults if nothing has been
   * saved yet. Never throws — a misshaped DB row falls back to defaults.
   */
  getAbout: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.db) return ABOUT_DEFAULTS;
    return readAbout(ctx.db);
  }),

  /**
   * Admin-only write. Saves the validated payload under `platform_config[about]`.
   * Stamped with the writer's web user id so the audit trail is in the
   * row itself (no separate audit_log entry needed for now).
   */
  setAbout: adminProcedure
    .input(ABOUT_SCHEMA)
    .mutation(async ({ ctx, input }) => {
      const json = JSON.stringify(input);
      const now = Math.floor(Date.now() / 1000);
      // tRPC ctx exposes the web user as `ctx.webUser`.
      const updatedBy = (ctx as { webUser?: { id?: string } | null }).webUser?.id ?? null;
      // Drizzle for SQLite: INSERT … ON CONFLICT DO UPDATE.
      await (ctx.db as {
        insert: (t: unknown) => {
          values: (v: unknown) => {
            onConflictDoUpdate: (cfg: unknown) => Promise<unknown>;
          };
        };
      })
        .insert(platformConfig)
        .values({ key: ABOUT_KEY, value: json, updatedAt: now, updatedBy })
        .onConflictDoUpdate({
          target: platformConfig.key,
          set: { value: json, updatedAt: now, updatedBy },
        });
      return { ok: true };
    }),
});
