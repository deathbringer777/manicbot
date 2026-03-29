import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import {
  tenants,
  bots,
  platformRoles,
  supportAgents,
  tenantRoles,
  appointments,
} from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

function randomId(len = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => chars[b % chars.length])
    .join("");
}

export const provisioningRouter = createTRPCRouter({
  // ─── TENANTS ────────────────────────────────────────────────

  createTenant: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        plan: z.enum(["start", "pro", "studio"]).default("pro"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = "t_" + randomId(6);
      const now = Math.floor(Date.now() / 1000);
      const trialEndsAt = now + 30 * 24 * 3600; // 30 days

      await ctx.db.insert(tenants).values({
        id: tenantId,
        name: input.name.trim(),
        active: 1,
        plan: input.plan,
        billingStatus: "trialing",
        trialEndsAt,
        cancelAtPeriodEnd: 0,
        createdAt: now,
        updatedAt: now,
      });

      return { ok: true, tenantId, name: input.name.trim() };
    }),

  // ─── BOTS ────────────────────────────────────────────────────

  linkBot: adminProcedure
    .input(
      z.object({
        botId: z.string().min(1),
        botUsername: z.string().optional(),
        tenantId: z.string().optional(),
        webhookSecret: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .insert(bots)
        .values({
          botId: input.botId,
          tenantId: input.tenantId ?? null,
          botUsername: input.botUsername ?? null,
          webhookSecret: input.webhookSecret ?? null,
          active: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: bots.botId,
          set: {
            tenantId: input.tenantId ?? null,
            botUsername: input.botUsername ?? null,
            updatedAt: now,
          },
        });
      return { ok: true };
    }),

  // ─── CONFIRM ALL PENDING ─────────────────────────────────────

  confirmAllPending: adminProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const confirmedBy = 321706035; // creator
      await ctx.db
        .update(appointments)
        .set({ status: "confirmed", confirmedBy })
        .where(
          and(
            eq(appointments.tenantId, input.tenantId),
            eq(appointments.status, "pending"),
            eq(appointments.cancelled, 0)
          )
        );
      return { ok: true };
    }),

  cancelAllPending: adminProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(appointments)
        .set({ status: "cancelled", cancelled: 1, cancelReason: "Cancelled by admin" })
        .where(
          and(
            eq(appointments.tenantId, input.tenantId),
            eq(appointments.status, "pending"),
            eq(appointments.cancelled, 0)
          )
        );
      return { ok: true };
    }),

  // ─── PLATFORM SUPPORT AGENTS ─────────────────────────────────

  listAgents: adminProcedure.query(async ({ ctx }) => {
    const agents = await ctx.db.select().from(supportAgents);
    const roles = await ctx.db.select().from(platformRoles);
    return {
      support: agents.filter((a) => a.type === "support").map((a) => a.chatId),
      techSupport: agents.filter((a) => a.type === "technical_support").map((a) => a.chatId),
      platformAdmins: roles.filter((r) => r.role === "system_admin").map((r) => r.chatId),
    };
  }),

  addAgent: adminProcedure
    .input(
      z.object({
        chatId: z.number(),
        type: z.enum(["support", "technical_support", "system_admin"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);

      if (input.type === "system_admin") {
        await ctx.db
          .insert(platformRoles)
          .values({ chatId: input.chatId, role: "system_admin", createdAt: now })
          .onConflictDoUpdate({
            target: platformRoles.chatId,
            set: { role: "system_admin" },
          });
      } else {
        await ctx.db
          .insert(supportAgents)
          .values({ chatId: input.chatId, type: input.type })
          .onConflictDoUpdate({
            target: supportAgents.chatId,
            set: { type: input.type },
          });
        const role = input.type === "support" ? "support" : "technical_support";
        await ctx.db
          .insert(platformRoles)
          .values({ chatId: input.chatId, role, createdAt: now })
          .onConflictDoUpdate({
            target: platformRoles.chatId,
            set: { role },
          });
      }
      return { ok: true };
    }),

  removeAgent: adminProcedure
    .input(z.object({ chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(supportAgents)
        .where(eq(supportAgents.chatId, input.chatId));
      await ctx.db
        .delete(platformRoles)
        .where(eq(platformRoles.chatId, input.chatId));
      return { ok: true };
    }),

  // ─── TENANT ROLES ─────────────────────────────────────────────

  setTenantRole: adminProcedure
    .input(
      z.object({
        tenantId: z.string(),
        chatId: z.number(),
        role: z.enum(["tenant_owner", "master", "admin"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .insert(tenantRoles)
        .values({
          tenantId: input.tenantId,
          chatId: input.chatId,
          role: input.role,
          createdAt: now,
        })
        .onConflictDoNothing();
      return { ok: true };
    }),

  removeTenantRole: adminProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(tenantRoles)
        .where(
          and(
            eq(tenantRoles.tenantId, input.tenantId),
            eq(tenantRoles.chatId, input.chatId)
          )
        );
      return { ok: true };
    }),

  listTenantRoles: adminProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(tenantRoles)
        .where(eq(tenantRoles.tenantId, input.tenantId));
    }),
});
