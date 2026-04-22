import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { users, appointments, tenants } from "~/server/db/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { PLAN_PRICES_PLN } from "~/lib/money";
import { writeAudit, ctxIp } from "~/server/security/audit";

function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

export const exportRouter = createTRPCRouter({
  users: adminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        format: z.enum(["csv", "json"]).default("csv"),
      })
    )
    .query(async ({ ctx, input }) => {
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "export.users",
        tenantId: input.tenantId ?? null,
        detail: `format=${input.format} tenant=${input.tenantId ?? "ALL"}`,
        ip: ctxIp(ctx),
      });

      const result = input.tenantId
        ? await ctx.db
            .select()
            .from(users)
            .where(eq(users.tenantId, input.tenantId))
            .orderBy(desc(users.registeredAt))
        : await ctx.db.select().from(users).orderBy(desc(users.registeredAt));

      if (input.format === "json") {
        return { data: JSON.stringify(result, null, 2), filename: "users.json" };
      }

      const csv = toCSV(
        ["tenant_id", "chat_id", "name", "username", "phone", "lang", "registered_at"],
        result.map((u) => [
          u.tenantId,
          u.chatId,
          u.name,
          u.tgUsername,
          u.phone,
          u.tgLang,
          u.registeredAt ? new Date(u.registeredAt * 1000).toISOString() : "",
        ])
      );
      return { data: csv, filename: "users.csv" };
    }),

  appointments: adminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        format: z.enum(["csv", "json"]).default("csv"),
      })
    )
    .query(async ({ ctx, input }) => {
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "export.appointments",
        tenantId: input.tenantId ?? null,
        detail: `format=${input.format} from=${input.dateFrom ?? "-"} to=${input.dateTo ?? "-"}`,
        ip: ctxIp(ctx),
      });

      const conditions = [];
      if (input.tenantId) conditions.push(eq(appointments.tenantId, input.tenantId));
      if (input.dateFrom) conditions.push(gte(appointments.date, input.dateFrom));
      if (input.dateTo) conditions.push(lte(appointments.date, input.dateTo));

      const result =
        conditions.length > 0
          ? await ctx.db
              .select()
              .from(appointments)
              .where(and(...conditions))
              .orderBy(desc(appointments.ts))
          : await ctx.db.select().from(appointments).orderBy(desc(appointments.ts));

      if (input.format === "json") {
        return { data: JSON.stringify(result, null, 2), filename: "appointments.json" };
      }

      const csv = toCSV(
        ["id", "tenant_id", "user_name", "user_tg", "service_id", "date", "time", "status", "cancelled", "created_at"],
        result.map((a) => [
          a.id,
          a.tenantId,
          a.userName,
          a.userTg,
          a.svcId,
          a.date,
          a.time,
          a.status,
          a.cancelled,
          new Date(a.createdAt * 1000).toISOString(),
        ])
      );
      return { data: csv, filename: "appointments.csv" };
    }),

  revenue: adminProcedure
    .input(z.object({ format: z.enum(["csv", "json"]).default("csv") }))
    .query(async ({ ctx, input }) => {
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "export.revenue",
        detail: `format=${input.format}`,
        ip: ctxIp(ctx),
      });

      const allTenants = await ctx.db.select().from(tenants).orderBy(desc(tenants.createdAt));

      const rows = allTenants.map((t) => ({
        id: t.id,
        name: t.name,
        plan: t.plan,
        billingStatus: t.billingStatus,
        monthlyRevenue:
          t.billingStatus === "active" ? (PLAN_PRICES_PLN[t.plan ?? "start"] ?? 0) : 0,
        email: t.billingEmail,
        stripeId: t.stripeCustomerId,
        trialEndsAt: t.trialEndsAt
          ? new Date(t.trialEndsAt * 1000).toISOString()
          : "",
        createdAt: new Date(t.createdAt * 1000).toISOString(),
      }));

      if (input.format === "json") {
        return { data: JSON.stringify(rows, null, 2), filename: "revenue.json" };
      }

      const csv = toCSV(
        ["id", "name", "plan", "billing_status", "monthly_revenue", "email", "stripe_id", "trial_ends_at", "created_at"],
        rows.map((r) => [
          r.id,
          r.name,
          r.plan,
          r.billingStatus,
          r.monthlyRevenue,
          r.email,
          r.stripeId,
          r.trialEndsAt,
          r.createdAt,
        ])
      );
      return { data: csv, filename: "revenue.csv" };
    }),
});
