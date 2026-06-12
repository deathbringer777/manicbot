/**
 * Promo codes router (Sprint 4).
 *
 * Supports manual codes + auto-generated (birthday/returning/stamp_reward).
 * Redemption is recorded in `promo_code_uses` with a unique constraint per
 * (promo_code_id, appointment_id) to prevent double-application.
 *
 * Public-surface audit (P2-7).
 *
 * Every procedure in this router calls `assertTenantOwner(ctx, input.tenantId)`
 * before reading or writing. Since #259 closure (2026-06-12) the base is
 * `protectedProcedure` — a typed session gate at the boundary; the in-handler
 * assert remains the tenant-scope authority (personal masters pass it).
 *
 * Callers (verified):
 *   * `list`     — SalonDashboard / MasterDashboard promo-code tabs.
 *   * `create`   — SalonDashboard "New code" modal.
 *   * `delete`   — SalonDashboard delete button.
 *   * `validate` — Booking-flow validation (modal + AI tag handler). The
 *     guard ensures only the owner of `tenantId` can read code metadata —
 *     prevents a competitor from probing whether a code is active.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { promoCodes, promoCodeUses } from "~/server/db/schema";
import { and, eq, gte, lte, desc, sql, isNull, or } from "drizzle-orm";

function nowSec(): number { return Math.floor(Date.now() / 1000); }

const createInput = z.object({
  tenantId: z.string(),
  code: z.string().min(3).max(40),
  discountType: z.enum(["percent", "fixed_pln"]),
  discountValue: z.number().int().min(1).max(10_000),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerClient: z.number().int().min(1).default(1),
  validFrom: z.number().int(),
  validUntil: z.number().int().optional(),
  minOrderPln: z.number().int().optional(),
  serviceIds: z.array(z.string()).optional(),
  kind: z.enum(["manual", "birthday", "returning", "stamp_reward", "referral"]).default("manual"),
});

export const promoCodesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ tenantId: z.string(), activeOnly: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      const conditions = [eq(promoCodes.tenantId, input.tenantId)];
      if (input.activeOnly) {
        conditions.push(lte(promoCodes.validFrom, now));
        conditions.push(or(isNull(promoCodes.validUntil), gte(promoCodes.validUntil, now))!);
      }
      const rows = await ctx.db
        .select()
        .from(promoCodes)
        .where(and(...conditions))
        .orderBy(desc(promoCodes.createdAt))
        .limit(200);
      return rows;
    }),
  create: protectedProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      // Creator identity: require a web session (tenant_owner only)
      const creatorId = ctx.webUser?.id ?? "unknown";
      await ctx.db.insert(promoCodes).values({
        tenantId: input.tenantId,
        code: input.code.toUpperCase(),
        kind: input.kind,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxUses: input.maxUses ?? null,
        maxUsesPerClient: input.maxUsesPerClient,
        validFrom: input.validFrom,
        validUntil: input.validUntil ?? null,
        minOrderPln: input.minOrderPln ?? null,
        serviceIds: input.serviceIds ? JSON.stringify(input.serviceIds) : null,
        createdBy: String(creatorId),
        createdAt: now,
      });
      return { ok: true };
    }),
  delete: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .delete(promoCodes)
        .where(and(eq(promoCodes.tenantId, input.tenantId), eq(promoCodes.id, input.id)));
      return { ok: true };
    }),

  /**
   * Validate a code against current tenant state. Returns { valid, reason, discountType, discountValue }.
   * Called from the booking flow (manual booking modal + AI tag handler).
   */
  validate: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      code: z.string().min(1),
      clientId: z.string().optional(),
      serviceId: z.string().optional(),
      orderPln: z.number().int().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = nowSec();
      const rows = await ctx.db
        .select()
        .from(promoCodes)
        .where(and(
          eq(promoCodes.tenantId, input.tenantId),
          eq(promoCodes.code, input.code.toUpperCase()),
        ))
        .limit(1);
      const row = rows[0];
      if (!row) return { valid: false as const, reason: "not_found" };
      if (row.validFrom > now) return { valid: false as const, reason: "not_started" };
      if (row.validUntil && row.validUntil < now) return { valid: false as const, reason: "expired" };
      if (row.clientId && input.clientId && row.clientId !== input.clientId) {
        return { valid: false as const, reason: "client_mismatch" };
      }
      if (row.minOrderPln && input.orderPln != null && input.orderPln < row.minOrderPln) {
        return { valid: false as const, reason: "below_min_order" };
      }
      // max_uses check
      if (row.maxUses != null) {
        const usesRows = await ctx.db
          .select({ c: sql<number>`count(*)` })
          .from(promoCodeUses)
          .where(eq(promoCodeUses.promoCodeId, row.id));
        if ((usesRows[0]?.c ?? 0) >= row.maxUses) {
          return { valid: false as const, reason: "max_uses_reached" };
        }
      }
      return {
        valid: true as const,
        discountType: row.discountType,
        discountValue: row.discountValue,
        promoCodeId: row.id,
      };
    }),
});
