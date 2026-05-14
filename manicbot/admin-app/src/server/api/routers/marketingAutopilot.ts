import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { env } from "~/env";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { marketingContentPlan, marketingPublishQueue } from "~/server/db/schema";

/**
 * @manicbot_com IG autopilot — God Mode only.
 *
 * Read-only access to the content_plan + manual control endpoints.
 * `tenant_id IS NULL` is the @manicbot_com singleton — when the
 * marketing module graduates into a per-tenant plugin, this router
 * will fork into a tenant-scoped variant.
 *
 * Worker-side mutations (regenerate, publish-one, tick) proxy
 * through the Worker via ADMIN_KEY-authenticated HTTP, so the actual
 * Workers AI / Anthropic API / Meta calls always happen in the
 * Worker runtime (where the bindings live), not in admin-app edge
 * functions.
 */

const STATUS = z.enum([
  "pending",
  "generating",
  "ready",
  "publishing",
  "posted",
  "failed",
  "paused",
]);

async function callWorker(path: string, init?: RequestInit) {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "WORKER_PUBLIC_URL / ADMIN_KEY not configured on admin-app",
    });
  }
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${adminKey}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new TRPCError({
      code: res.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
      message: `Worker ${path} returned ${res.status}: ${(body as { error?: string }).error ?? text.slice(0, 120)}`,
    });
  }
  return body;
}

export const marketingAutopilotRouter = createTRPCRouter({
  // ── reads ───────────────────────────────────────────────────────────────
  listSlots: adminProcedure
    .input(
      z
        .object({
          status: STATUS.optional(),
          dateFrom: z.number().int().nonnegative().optional(),
          dateTo: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().nonnegative().default(0),
          order: z.enum(["asc", "desc"]).default("asc"),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds = [isNull(marketingContentPlan.tenantId)];
      if (input.status) conds.push(eq(marketingContentPlan.status, input.status));
      if (input.dateFrom !== undefined)
        conds.push(gte(marketingContentPlan.scheduledAt, input.dateFrom));
      if (input.dateTo !== undefined)
        conds.push(lte(marketingContentPlan.scheduledAt, input.dateTo));

      const orderExpr =
        input.order === "asc"
          ? asc(marketingContentPlan.scheduledAt)
          : desc(marketingContentPlan.scheduledAt);

      const rows = await ctx.db
        .select()
        .from(marketingContentPlan)
        .where(and(...conds))
        .orderBy(orderExpr)
        .limit(input.limit)
        .offset(input.offset);

      const totalRows = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(marketingContentPlan)
        .where(and(...conds));

      return {
        rows: rows.map((r) => ({
          ...r,
          hashtags: safeParseHashtags(r.hashtagsJson),
        })),
        total: Number(totalRows[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  getSlot: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(marketingContentPlan)
        .where(
          and(
            eq(marketingContentPlan.id, input.id),
            isNull(marketingContentPlan.tenantId),
          ),
        )
        .limit(1);
      if (row.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "slot not found" });
      }
      const slot = row[0]!;
      const queue = await ctx.db
        .select()
        .from(marketingPublishQueue)
        .where(eq(marketingPublishQueue.contentPlanId, input.id))
        .limit(1);
      return {
        ...slot,
        hashtags: safeParseHashtags(slot.hashtagsJson),
        publishQueue: queue[0] ?? null,
      };
    }),

  getStatus: adminProcedure.query(async ({ ctx }) => {
    const counts = await ctx.db
      .select({
        status: marketingContentPlan.status,
        count: sql<number>`count(*)`,
      })
      .from(marketingContentPlan)
      .where(isNull(marketingContentPlan.tenantId))
      .groupBy(marketingContentPlan.status);

    return {
      counts: counts.map((c) => ({ status: c.status, n: Number(c.count) })),
      autopilotEnabled: env.MARKETING_AUTOPILOT_ENABLED === "1",
    };
  }),

  // ── mutations (D1-only — no Worker side effects) ────────────────────────
  pauseSlot: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const result = await ctx.db
        .update(marketingContentPlan)
        .set({ status: "paused", updatedAt: now })
        .where(
          and(
            eq(marketingContentPlan.id, input.id),
            isNull(marketingContentPlan.tenantId),
          ),
        )
        .returning({ id: marketingContentPlan.id, status: marketingContentPlan.status });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "slot not found" });
      }
      return result[0];
    }),

  resumeSlot: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const result = await ctx.db
        .update(marketingContentPlan)
        .set({
          status: "pending",
          errorCount: 0,
          errorMsg: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(marketingContentPlan.id, input.id),
            isNull(marketingContentPlan.tenantId),
          ),
        )
        .returning({ id: marketingContentPlan.id, status: marketingContentPlan.status });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "slot not found" });
      }
      return result[0];
    }),

  regenerateSlot: adminProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        clearCaption: z.boolean().default(true),
        clearImage: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const updates: Partial<typeof marketingContentPlan.$inferInsert> = {
        status: "pending",
        errorCount: 0,
        errorMsg: null,
        updatedAt: now,
        publishedAt: null,
        metaPostId: null,
        permalink: null,
      };
      if (input.clearCaption) {
        updates.headlinePl = null;
        updates.captionPl = null;
        updates.hashtagsJson = null;
        updates.imagePrompt = null;
      }
      if (input.clearImage) {
        updates.imageUrl = null;
      }
      const result = await ctx.db
        .update(marketingContentPlan)
        .set(updates)
        .where(
          and(
            eq(marketingContentPlan.id, input.id),
            isNull(marketingContentPlan.tenantId),
          ),
        )
        .returning({ id: marketingContentPlan.id, status: marketingContentPlan.status });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "slot not found" });
      }
      return result[0];
    }),

  // ── Worker proxies ──────────────────────────────────────────────────────
  publishOneManual: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const url = `/admin/marketing-publish-one?slot_id=${encodeURIComponent(input.id)}`;
      const result = await callWorker(url, { method: "POST" });
      return result;
    }),

  runTickManual: adminProcedure.mutation(async () => {
    return callWorker("/admin/marketing-tick", { method: "POST" });
  }),
});

function safeParseHashtags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
