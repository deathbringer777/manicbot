/**
 * Consent router — APPEND-ONLY audit trail for cookie banner decisions.
 *
 * The `record` mutation is intentionally `publicProcedure`: anonymous landing
 * visitors must be able to log their decision before any account exists. It
 * is rate-limited and Zod-validated; see consentLogic.ts.
 *
 * Admin-side reads (recent decisions, acceptance rates) require
 * adminProcedure so only system_admin / support / technical_support can see
 * the audit trail.
 */
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { adminProcedure, createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { cookieConsentLog } from "~/server/db/schema";
import { checkRateLimit } from "~/server/auth/rateLimit";
import { log } from "~/server/utils/logger";
import {
  CONSENT_RECORD_INPUT_SCHEMA,
  buildConsentInsertRow,
  parseClientIp,
  truncateUserAgent,
} from "~/server/api/consent/consentLogic";

const RECORD_RATE_LIMIT_MAX = 30;
const RECORD_RATE_LIMIT_WINDOW_MS = 60_000;

export const consentRouter = createTRPCRouter({
  /**
   * Append a consent decision. Returns `{ ok: true }` on success and never
   * echoes back the row — keeps the response surface minimal so a malicious
   * caller cannot probe stored values via this endpoint.
   */
  // nosemgrep: trpc-public-procedure-mutation -- anonymous consent capture (no session by design, IP-rate-limited)
  record: publicProcedure
    .input(CONSENT_RECORD_INPUT_SCHEMA)
    .mutation(async ({ ctx, input }) => {
      const ip = parseClientIp(ctx.headers);
      const rateKey = ip ?? `anon:${input.anonymousId}`;
      try {
        const rl = await checkRateLimit(
          ctx.db,
          rateKey,
          "consent_record",
          RECORD_RATE_LIMIT_MAX,
          RECORD_RATE_LIMIT_WINDOW_MS,
        );
        if (!rl.allowed) {
          // Don't 429 the user — they need to be able to record consent. We
          // simply drop the duplicate. The server-side log captured the first
          // decision; subsequent rapid changes would be drift / replay noise.
          return { ok: false as const, reason: "rate_limited" as const };
        }
      } catch (e) {
        // Rate limit failures must never block consent recording.
        log.error("consent.record.rate_limit", e instanceof Error ? e : new Error(String(e)));
      }

      try {
        const row = buildConsentInsertRow(input, {
          webUserId: ctx.webUser?.id ?? null,
          ip,
          userAgent: truncateUserAgent(ctx.headers.get("user-agent")),
          nowSec: Math.floor(Date.now() / 1000),
        });
        await ctx.db.insert(cookieConsentLog).values({
          anonymousId: row.anonymousId,
          webUserId: row.webUserId,
          categories: row.categories,
          policyVersion: row.policyVersion,
          source: row.source,
          ip: row.ip,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
        });
        return { ok: true as const };
      } catch (e) {
        log.error("consent.record.insert", e instanceof Error ? e : new Error(String(e)));
        return { ok: false as const, reason: "insert_failed" as const };
      }
    }),

  /**
   * Most recent decisions across all visitors. system_admin only.
   * Used by the God Mode analytics panel.
   */
  getRecentDecisions: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          rangeHours: z.number().int().min(1).max(720).default(168),
        })
        .default({ limit: 50, rangeHours: 168 }),
    )
    .query(async ({ ctx, input }) => {
      const sinceSec = Math.floor(Date.now() / 1000) - input.rangeHours * 3600;
      const rows = await ctx.db
        .select({
          id: cookieConsentLog.id,
          anonymousId: cookieConsentLog.anonymousId,
          webUserId: cookieConsentLog.webUserId,
          categories: cookieConsentLog.categories,
          policyVersion: cookieConsentLog.policyVersion,
          source: cookieConsentLog.source,
          createdAt: cookieConsentLog.createdAt,
        })
        .from(cookieConsentLog)
        .where(gte(cookieConsentLog.createdAt, sinceSec))
        .orderBy(desc(cookieConsentLog.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({
        ...r,
        // Truncate the visible anonymous_id so a screenshare doesn't leak the full handle.
        anonymousId: r.anonymousId.slice(0, 8) + "…",
        categories: safeParse(r.categories),
      }));
    }),

  /**
   * Aggregate acceptance rate per category over a window. system_admin only.
   */
  getCategoryAcceptanceRates: adminProcedure
    .input(
      z
        .object({ rangeHours: z.number().int().min(1).max(720).default(168) })
        .default({ rangeHours: 168 }),
    )
    .query(async ({ ctx, input }) => {
      const sinceSec = Math.floor(Date.now() / 1000) - input.rangeHours * 3600;
      const rows = await ctx.db
        .select({ categories: cookieConsentLog.categories })
        .from(cookieConsentLog)
        .where(gte(cookieConsentLog.createdAt, sinceSec));
      const total = rows.length;
      let analytics = 0;
      let marketing = 0;
      let ux = 0;
      for (const r of rows) {
        const c = safeParse(r.categories);
        if (c?.analytics) analytics++;
        if (c?.marketing) marketing++;
        if (c?.ux) ux++;
      }
      const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
      return {
        total,
        rangeHours: input.rangeHours,
        analyticsAcceptedPct: pct(analytics),
        marketingAcceptedPct: pct(marketing),
        uxAcceptedPct: pct(ux),
      };
    }),
});

function safeParse(s: string): { necessary: boolean; analytics: boolean; marketing: boolean; ux: boolean } | null {
  try {
    const p = JSON.parse(s) as Record<string, unknown>;
    return {
      necessary: p.necessary === true,
      analytics: p.analytics === true,
      marketing: p.marketing === true,
      ux: p.ux === true,
    };
  } catch {
    return null;
  }
}
