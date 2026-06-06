/**
 * Reviews router — public-surface audit (P2-7).
 *
 * Procedure-level access model (admin-app convention: `publicProcedure` is the
 * tRPC base, but every mutation/query in this router enforces an explicit
 * `assertTenantOwner(ctx, input.tenantId)` guard so a caller without a
 * NextAuth session cannot reach the data).
 *
 * Callers (verified):
 *   * `getForSalon`     — SalonDashboard → Reviews tab (owner-only).
 *   * `getStats`        — SalonDashboard / MasterDashboard cards.
 *   * `updateStatus`    — SalonDashboard owner-only moderation buttons.
 *   * `addReply` / `deleteReply` — owner-only reply editor.
 *   * `getPublicReviews` — public salon profile page (`/salon/[slug]`). This
 *     procedure is the only one in the file that does NOT call
 *     `assertTenantOwner`; instead it gates on `tenantConfig.reviews_public`
 *     and only returns `status IN ('active', 'featured')` rows + already-
 *     redacted fields (no chatId, no IP, no internal notes).
 *
 * Therefore: no procedure in this router is silently public. The file uses
 * `publicProcedure` as the tRPC scaffold; access control is at the call
 * site via `assertTenantOwner` or content-level filtering.
 */
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { reviews, masters, tenantConfig, users } from "~/server/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const tenantIdInput = z.object({ tenantId: z.string() });

export const reviewsRouter = createTRPCRouter({
  // ── Salon owner: list reviews with filters ────────────────────────────
  getForSalon: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.string().optional(),
      status: z.enum(["active", "hidden", "featured"]).optional(),
      rating: z.number().min(1).max(5).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const conditions = [eq(reviews.tenantId, input.tenantId)];
      if (input.masterId) conditions.push(eq(reviews.masterId, input.masterId));
      if (input.status) conditions.push(eq(reviews.status, input.status));
      if (input.rating) conditions.push(eq(reviews.rating, input.rating));

      const [rows, countRow] = await Promise.all([
        ctx.db.select().from(reviews)
          .where(and(...conditions))
          .orderBy(desc(reviews.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)` }).from(reviews)
          .where(and(...conditions)),
      ]);

      // Resolve user names from `users` table
      const chatIds = [...new Set(rows.map(r => r.chatId))];
      const userRows = chatIds.length > 0
        ? await ctx.db.select({ chatId: users.chatId, name: users.name })
            .from(users)
            .where(and(eq(users.tenantId, input.tenantId), inArray(users.chatId, chatIds)))
        : [];
      const nameMap = new Map(userRows.map(u => [u.chatId, u.name]));

      return {
        reviews: rows.map(r => ({
          ...r,
          photos: r.photos ? JSON.parse(r.photos) : [],
          userName: nameMap.get(r.chatId) ?? null,
        })),
        total: countRow[0]?.count ?? 0,
      };
    }),

  // ── Salon owner / master: stats ───────────────────────────────────────
  getStats: publicProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const conditions = [eq(reviews.tenantId, input.tenantId)];
      if (input.masterId) conditions.push(eq(reviews.masterId, input.masterId));

      const [avgRow, distRows] = await Promise.all([
        ctx.db.select({
          avg: sql<number>`ROUND(AVG(rating), 1)`,
          count: sql<number>`count(*)`,
        }).from(reviews).where(and(...conditions)),
        ctx.db.select({
          rating: reviews.rating,
          count: sql<number>`count(*)`,
        }).from(reviews).where(and(...conditions)).groupBy(reviews.rating),
      ]);

      const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      for (const r of distRows) dist[r.rating] = r.count;

      return {
        avg: avgRow[0]?.avg ?? 0,
        count: avgRow[0]?.count ?? 0,
        distribution: dist,
      };
    }),

  // ── Salon owner: update review status ─────────────────────────────────
  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  updateStatus: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      reviewId: z.string(),
      status: z.enum(["active", "hidden", "featured"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(reviews)
        .set({ status: input.status })
        .where(and(eq(reviews.id, input.reviewId), eq(reviews.tenantId, input.tenantId)));
      return { ok: true };
    }),

  // ── Salon owner: reply to review ──────────────────────────────────────
  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  addReply: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      reviewId: z.string(),
      text: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(reviews)
        .set({ replyText: input.text, replyAt: Math.floor(Date.now() / 1000) })
        .where(and(eq(reviews.id, input.reviewId), eq(reviews.tenantId, input.tenantId)));
      return { ok: true };
    }),

  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  deleteReply: publicProcedure
    .input(z.object({ tenantId: z.string(), reviewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(reviews)
        .set({ replyText: null, replyAt: null })
        .where(and(eq(reviews.id, input.reviewId), eq(reviews.tenantId, input.tenantId)));
      return { ok: true };
    }),

  // ── Public: reviews for salon profile ─────────────────────────────────
  getPublicReviews: publicProcedure
    .input(z.object({ tenantId: z.string(), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      // Check if reviews are public
      const cfgRow = await ctx.db.select().from(tenantConfig)
        .where(and(eq(tenantConfig.tenantId, input.tenantId), eq(tenantConfig.key, "reviews_public")))
        .limit(1);
      if (cfgRow.length && cfgRow[0]!.value === "false") return { reviews: [], rating: null };

      const [rows, avgRow] = await Promise.all([
        ctx.db.select().from(reviews)
          .where(and(
            eq(reviews.tenantId, input.tenantId),
            inArray(reviews.status, ["active", "featured"]),
          ))
          .orderBy(
            sql`CASE WHEN ${reviews.status} = 'featured' THEN 0 ELSE 1 END`,
            desc(reviews.createdAt),
          )
          .limit(input.limit),
        ctx.db.select({
          avg: sql<number>`ROUND(AVG(rating), 1)`,
          count: sql<number>`count(*)`,
        }).from(reviews).where(and(
          eq(reviews.tenantId, input.tenantId),
          inArray(reviews.status, ["active", "featured"]),
        )),
      ]);

      // Resolve master names
      const masterIds = [...new Set(rows.map(r => r.masterId).filter(Boolean))] as string[];
      const masterRows = masterIds.length > 0
        ? await ctx.db.select({ chatId: masters.chatId, name: masters.name })
            .from(masters)
            .where(eq(masters.tenantId, input.tenantId))
        : [];
      const masterMap = new Map(masterRows.map(m => [String(m.chatId), m.name]));

      return {
        reviews: rows.map(r => ({
          id: r.id,
          rating: r.rating,
          text: r.text,
          photos: r.photos ? JSON.parse(r.photos) : [],
          masterName: r.masterId ? (masterMap.get(r.masterId) ?? null) : null,
          replyText: r.replyText,
          replyAt: r.replyAt,
          createdAt: r.createdAt,
        })),
        rating: {
          avg: avgRow[0]?.avg ?? 0,
          count: avgRow[0]?.count ?? 0,
        },
      };
    }),

  // ── Salon owner: read review-collection settings ──────────────────────
  // Drives the worker post-visit rating prompt. `reviews_enabled` is read by
  // the worker as a truthy STRING ("1" = on, "" = off — never "0", which the
  // worker would treat as truthy). `reviews_prompt_timing` ∈ immediate|delayed.
  getSettings: publicProcedure
    .input(tenantIdInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db.select().from(tenantConfig)
        .where(and(
          eq(tenantConfig.tenantId, input.tenantId),
          inArray(tenantConfig.key, ["reviews_enabled", "reviews_prompt_timing", "reviews_public"]),
        ));
      const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
      return {
        enabled: !!cfg["reviews_enabled"],
        timing: cfg["reviews_prompt_timing"] === "delayed" ? "delayed" as const : "immediate" as const,
        publicOnProfile: cfg["reviews_public"] !== "false",
      };
    }),

  // ── Salon owner: update review-collection settings ────────────────────
  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  updateSettings: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      enabled: z.boolean().optional(),
      timing: z.enum(["immediate", "delayed"]).optional(),
      publicOnProfile: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const updates: Array<[string, string]> = [];
      if (input.enabled !== undefined) updates.push(["reviews_enabled", input.enabled ? "1" : ""]);
      if (input.timing !== undefined) updates.push(["reviews_prompt_timing", input.timing]);
      if (input.publicOnProfile !== undefined) updates.push(["reviews_public", input.publicOnProfile ? "true" : "false"]);
      for (const [key, value] of updates) {
        await ctx.db.insert(tenantConfig)
          .values({ tenantId: input.tenantId, key, value })
          .onConflictDoUpdate({ target: [tenantConfig.tenantId, tenantConfig.key], set: { value } });
      }
      return { ok: true };
    }),

  // ── Salon owner: per-master rating breakdown (monitoring) ─────────────
  getMasterBreakdown: publicProcedure
    .input(tenantIdInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db.select({
        masterId: reviews.masterId,
        avg: sql<number>`ROUND(AVG(${reviews.rating}), 1)`,
        count: sql<number>`count(*)`,
      }).from(reviews)
        .where(eq(reviews.tenantId, input.tenantId))
        .groupBy(reviews.masterId);
      const masterRows = await ctx.db.select({ chatId: masters.chatId, name: masters.name })
        .from(masters).where(eq(masters.tenantId, input.tenantId));
      const nameMap = new Map(masterRows.map((m) => [String(m.chatId), m.name]));
      return rows
        .filter((r) => r.masterId)
        .map((r) => ({
          masterId: r.masterId as string,
          masterName: nameMap.get(r.masterId as string) ?? null,
          avg: r.avg ?? 0,
          count: r.count ?? 0,
        }))
        .sort((a, b) => b.count - a.count);
    }),
});
