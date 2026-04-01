import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { appointments } from "~/server/db/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { env } from "~/env";

/**
 * Fire-and-forget call to Worker endpoint to trigger notifications + calendar sync.
 * Non-blocking: errors are logged but don't affect the mutation response.
 */
async function notifyWorker(action: string, appointmentId: string, tenantId: string, confirmedBy?: string | number | null) {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    console.warn("[appointments] WORKER_PUBLIC_URL or ADMIN_KEY not set — skipping Worker notification");
    return;
  }
  try {
    const resp = await fetch(`${workerUrl}/admin/appointment-action?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, appointmentId, tenantId, confirmedBy }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[appointments] Worker notification failed ${resp.status}:`, text);
    }
  } catch (e) {
    console.error("[appointments] Worker notification error:", (e as Error).message);
  }
}

export const appointmentsRouter = createTRPCRouter({
  getAll: adminProcedure
    .input(
      z.object({
        offset: z.number().default(0),
        limit: z.number().default(50),
        tenantId: z.string().optional(),
        status: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.tenantId) conditions.push(eq(appointments.tenantId, input.tenantId));
      if (input.status === "cancelled") {
        conditions.push(eq(appointments.cancelled, 1));
      } else if (input.status) {
        conditions.push(eq(appointments.status, input.status));
        conditions.push(eq(appointments.cancelled, 0));
      }
      if (input.dateFrom) conditions.push(gte(appointments.date, input.dateFrom));
      if (input.dateTo) conditions.push(lte(appointments.date, input.dateTo));

      const baseQuery = conditions.length > 0
        ? ctx.db.select().from(appointments).where(and(...conditions))
        : ctx.db.select().from(appointments);

      const [countResult, rows] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)` }).from(appointments)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
        baseQuery.orderBy(desc(appointments.ts)).limit(input.limit).offset(input.offset),
      ]);

      return {
        appointments: rows,
        total: countResult[0]?.count ?? 0,
      };
    }),

  getStats: adminProcedure
    .input(z.object({ tenantId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const today = new Date().toISOString().split("T")[0]!;
      const baseConditions = input.tenantId
        ? [eq(appointments.tenantId, input.tenantId)]
        : [];

      const [total, todayCount, pending, confirmed, cancelled, done] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(baseConditions.length > 0 ? and(...baseConditions) : undefined),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(...baseConditions, eq(appointments.date, today))),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(...baseConditions, eq(appointments.status, "pending"), eq(appointments.cancelled, 0))),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(...baseConditions, eq(appointments.status, "confirmed"), eq(appointments.cancelled, 0))),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(...baseConditions, eq(appointments.cancelled, 1))),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(...baseConditions, eq(appointments.status, "done"))),
      ]);

      return {
        total: total[0]?.count ?? 0,
        today: todayCount[0]?.count ?? 0,
        pending: pending[0]?.count ?? 0,
        confirmed: confirmed[0]?.count ?? 0,
        cancelled: cancelled[0]?.count ?? 0,
        done: done[0]?.count ?? 0,
      };
    }),

  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["confirmed", "rejected", "cancelled", "done"]),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, string | number | null> = { status: input.status };
      if (input.status === "confirmed") {
        // Set confirmedBy and masterId so the Worker cron can sync calendar events
        const adminId = ctx.user?.id ?? null;
        if (adminId) {
          updates.confirmedBy = adminId;
          // Only set masterId if not already assigned (don't overwrite a real master)
          const existing = await ctx.db
            .select({ masterId: appointments.masterId })
            .from(appointments)
            .where(eq(appointments.id, input.id))
            .limit(1);
          if (existing[0] && !existing[0].masterId) {
            updates.masterId = adminId;
          }
        }
      }
      if (input.status === "rejected") updates.rejectComment = input.comment ?? "";
      if (input.status === "cancelled") {
        updates.cancelReason = input.comment ?? "";
        updates.cancelled = 1;
      }
      // Get tenantId before update (needed for Worker notification)
      const aptRow = await ctx.db
        .select({ tenantId: appointments.tenantId })
        .from(appointments)
        .where(eq(appointments.id, input.id))
        .limit(1);
      const tenantId = aptRow[0]?.tenantId;

      await ctx.db.update(appointments).set(updates).where(eq(appointments.id, input.id));

      // Fire-and-forget: notify Worker to send Telegram message + sync calendar
      // Worker expects bare verb ("confirm" / "reject" / "cancel"), not past tense
      const workerActionMap: Record<string, string> = { confirmed: "confirm", rejected: "reject", cancelled: "cancel" };
      if (tenantId && workerActionMap[input.status]) {
        notifyWorker(workerActionMap[input.status]!, input.id, tenantId, updates.confirmedBy ?? null).catch(() => {});
      }

      return { success: true, updatedAt: Date.now() };
    }),
});
