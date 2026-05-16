import { createTRPCRouter, adminProcedure, publicProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { appointments, users, masters, services } from "~/server/db/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { env } from "~/env";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { slotsBusy } from "~/server/api/slotsBusy";
import { log } from "~/server/utils/logger";

/**
 * Fire-and-forget call to Worker endpoint to trigger notifications + calendar sync.
 * Non-blocking: errors are logged but don't affect the mutation response.
 */
async function notifyWorker(action: string, appointmentId: string, tenantId: string, confirmedBy?: string | number | null) {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    log.warn("appointments.notifyWorker", { message: "WORKER_PUBLIC_URL or ADMIN_KEY not set — skipping" });
    return;
  }
  try {
    // #S9: ADMIN_KEY moved from query string to Authorization: Bearer header.
    const resp = await fetch(`${workerUrl}/admin/appointment-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ action, appointmentId, tenantId, confirmedBy }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log.error("appointments.notifyWorker", new Error(`Worker notification failed ${resp.status}`), { body: text });
    }
  } catch (e) {
    log.error("appointments.notifyWorker", e instanceof Error ? e : new Error(String(e)));
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
      } else if (input.status === "no_show") {
        conditions.push(eq(appointments.noShow, 1));
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

      const [total, todayCount, pending, confirmed, cancelled, done, noShow] = await Promise.all([
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
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(...baseConditions, eq(appointments.noShow, 1))),
      ]);

      return {
        total: total[0]?.count ?? 0,
        today: todayCount[0]?.count ?? 0,
        pending: pending[0]?.count ?? 0,
        confirmed: confirmed[0]?.count ?? 0,
        cancelled: cancelled[0]?.count ?? 0,
        done: done[0]?.count ?? 0,
        noShow: noShow[0]?.count ?? 0,
      };
    }),

  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["confirmed", "rejected", "cancelled", "done", "no_show"]),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, string | number | null> = { status: input.status };
      if (input.status === "confirmed") {
        // Set confirmedBy and masterId so the Worker cron can sync calendar events
        // Web session: use webUser.id → numeric hash fallback (null is fine — cron still syncs via masterId)
        const adminId: number | null = null;
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
        updates.cancelledBy = "admin";
        updates.cancelledAt = Math.floor(Date.now() / 1000);
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

  markNoShow: adminProcedure
    .input(
      z.object({
        id: z.string(),
        noShowBy: z.enum(["client", "master"]),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const aptRow = await ctx.db
        .select({ tenantId: appointments.tenantId })
        .from(appointments)
        .where(eq(appointments.id, input.id))
        .limit(1);
      if (!aptRow[0]) return { success: false };

      await ctx.db.update(appointments).set({
        noShow: 1,
        noShowBy: input.noShowBy,
        status: "no_show",
        cancelReason: input.comment ?? null,
      }).where(eq(appointments.id, input.id));

      return { success: true, updatedAt: Date.now() };
    }),

  /**
   * Sprint 3: Manual booking from dashboard (owner → any master; master → self only).
   * Enforces slot-conflict check + auto-creates client if name+phone provided.
   */
  createManual: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      clientChatId: z.number().int().optional(),
      clientName: z.string().min(1).max(100).optional(),
      clientPhone: z.string().min(6).max(30).optional(),
      masterId: z.number().int(),
      serviceId: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      note: z.string().max(500).optional(),
    }).refine(d => d.clientChatId || (d.clientName && d.clientPhone), {
      message: "Either clientChatId or (clientName + clientPhone) required",
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Role scoping: masters can only book on their own calendar.
      // For web sessions, masterId must match the master row tied to the caller's tenantId.
      if (ctx.webUser?.webRole === "master") {
        const [masterRow] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(eq(masters.tenantId, input.tenantId), eq(masters.active, 1)))
          .limit(1);
        if (!masterRow || masterRow.chatId !== input.masterId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only book on their own calendar",
          });
        }
      }

      // Resolve service duration for slot-conflict check
      const svcRows = await ctx.db
        .select()
        .from(services)
        .where(and(
          eq(services.tenantId, input.tenantId),
          eq(services.svcId, input.serviceId),
        ))
        .limit(1);
      const svc = svcRows[0];
      if (!svc) throw new TRPCError({ code: "NOT_FOUND", message: "service_not_found" });

      // Slot-conflict check — unions appointments AND appointment_blocks so
      // a master can't be double-booked between a client and a self-block.
      // Calendar overhaul (2026-05-16): replaces the old appointments-only
      // walk that let bookings slip through reservations / time-off rows.
      const busy = await slotsBusy({
        db: ctx.db,
        tenantId: input.tenantId,
        masterId: input.masterId,
        date: input.date,
        startTime: input.time,
        durationMin: svc.duration,
      });
      if (busy.busy) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "slot_conflict",
          cause: busy.conflict,
        });
      }
      const [h, m] = input.time.split(":").map(Number);

      // Resolve or create client
      let chatId = input.clientChatId ?? null;
      if (!chatId && input.clientName && input.clientPhone) {
        // Synthetic negative chatId for manually-created clients (no Telegram ID)
        chatId = -Math.floor(Date.now() / 1000);
        try {
          await ctx.db.insert(users).values({
            tenantId: input.tenantId,
            chatId,
            name: input.clientName,
            phone: input.clientPhone,
            registeredAt: Math.floor(Date.now() / 1000),
            firstSource: "manual_dashboard",
          });
        } catch (e) {
          log.error("appointments.createManual", e instanceof Error ? e : new Error(String(e)));
        }
      }
      if (!chatId) throw new TRPCError({ code: "BAD_REQUEST", message: "client_resolution_failed" });

      // Create appointment
      const aptId = `a${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Math.floor(Date.now() / 1000);
      const [y, mo, d] = input.date.split("-").map(Number);
      const startTs = Math.floor(Date.UTC(y!, mo! - 1, d!, h!, m!) / 1000);

      try {
        await ctx.db.insert(appointments).values({
          id: aptId,
          tenantId: input.tenantId,
          chatId,
          svcId: input.serviceId,
          date: input.date,
          time: input.time,
          ts: startTs,
          status: "confirmed",
          masterId: input.masterId,
          userName: input.clientName ?? null,
          userPhone: input.clientPhone ?? null,
          confirmedBy: null,
          cancelled: 0,
          noShow: 0,
          remH24: 0,
          remH2: 0,
          createdAt: now,
        });
      } catch (e) {
        // Race: a concurrent booking just claimed this slot. The partial
        // UNIQUE index idx_apt_unique_active_slot (migration 0044) caught
        // the duplicate. Surface as 409 so the dashboard can re-fetch slots.
        if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? ""))) {
          throw new TRPCError({ code: "CONFLICT", message: "slot_conflict" });
        }
        throw e;
      }

      // Analytics event (best-effort via raw D1 binding — Drizzle doesn't
      // export .execute() on this DB variant).
      try {
        const d1 = (ctx as unknown as { db: { $client?: { prepare?: (s: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown> } } } } }).db.$client;
        const actorId = String(ctx.webUser?.id ?? "unknown");
        const props = JSON.stringify({ source: "manual_dashboard", masterId: input.masterId, serviceId: input.serviceId, aptId });
        if (d1?.prepare) {
          await d1.prepare("INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(input.tenantId, actorId, "booking.created", props, now).run();
        }
      } catch { /* non-fatal */ }

      return { ok: true, appointmentId: aptId };
    }),

  /**
   * rescheduleAppointment — move an existing booking to a new time slot
   * (and/or master) without going through the full create flow. Powers
   * Google-Calendar-style drag-to-reschedule from the Day/Week grids.
   *
   * Behaviour:
   *   - Slot-conflict guard via shared `slotsBusy()` with
   *     `excludeAppointmentId` so the appointment doesn't collide with
   *     itself.
   *   - Resets `syncRetries / syncRetryAfter / syncLastError` so the next
   *     `phaseGcalSync` cron picks the row back up and updates the linked
   *     Google Calendar event at the new time. The Google event_id is
   *     preserved on the row so the sync becomes a PATCH, not a re-create.
   *   - Re-arms the reminder flags (`remH24 / remH2 = 0`) so the cron fires
   *     reminders for the NEW time, not the old one.
   *   - Worker notify is intentionally NOT called here — drag-to-reschedule
   *     happens frequently during the day and we don't want to spam the
   *     client with a "your appointment moved" message every time the
   *     owner nudges a block by 15 minutes. Adding an explicit "notify
   *     client" action stays as a future, opt-in follow-up.
   */
  rescheduleAppointment: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      appointmentId: z.string().min(1),
      newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      newTime: z.string().regex(/^\d{2}:\d{2}$/),
      newMasterId: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Load the appointment up front — we need its current master/service
      // both for the conflict check (service duration) and for the master
      // role-scoping rule below.
      const [apt] = await ctx.db
        .select()
        .from(appointments)
        .where(and(
          eq(appointments.id, input.appointmentId),
          eq(appointments.tenantId, input.tenantId),
        ))
        .limit(1);
      if (!apt) throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });

      // Refuse to move terminal rows — cancelled / rejected / no-show /
      // done bookings shouldn't be revivable by a drag gesture.
      if (apt.cancelled === 1 || apt.noShow === 1 || apt.status === "rejected" || apt.status === "done") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "appointment_terminal" });
      }

      const newMasterId = input.newMasterId ?? apt.masterId;
      if (newMasterId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "master_required" });

      // Role scoping: masters can only move bookings on their own calendar
      // and can't reassign to another master. Mirrors `createManual`.
      if (ctx.webUser?.webRole === "master") {
        const [masterRow] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(eq(masters.tenantId, input.tenantId), eq(masters.active, 1)))
          .limit(1);
        if (!masterRow || masterRow.chatId !== apt.masterId || newMasterId !== apt.masterId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only reschedule on their own calendar",
          });
        }
      }

      // No-op short-circuit: if nothing actually changed, return early so
      // we don't pay the conflict check + sync-reset cost.
      if (
        apt.date === input.newDate &&
        apt.time === input.newTime &&
        apt.masterId === newMasterId
      ) {
        return { ok: true, appointmentId: apt.id, unchanged: true };
      }

      // Resolve service duration for the conflict check.
      const [svc] = await ctx.db
        .select()
        .from(services)
        .where(and(
          eq(services.tenantId, input.tenantId),
          eq(services.svcId, apt.svcId),
        ))
        .limit(1);
      const durationMin = svc?.duration ?? 60;

      const busy = await slotsBusy({
        db: ctx.db,
        tenantId: input.tenantId,
        masterId: newMasterId,
        date: input.newDate,
        startTime: input.newTime,
        durationMin,
        excludeAppointmentId: apt.id,
      });
      if (busy.busy) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "slot_conflict",
          cause: busy.conflict,
        });
      }

      const [h, m] = input.newTime.split(":").map(Number);
      const [y, mo, d] = input.newDate.split("-").map(Number);
      const newTs = Math.floor(Date.UTC(y!, mo! - 1, d!, h!, m!) / 1000);

      try {
        await ctx.db
          .update(appointments)
          .set({
            date: input.newDate,
            time: input.newTime,
            ts: newTs,
            masterId: newMasterId,
            // Re-queue Google Calendar sync — googleEventId stays so the
            // sync handler PATCHes the existing event instead of creating
            // a duplicate.
            syncRetries: 0,
            syncRetryAfter: null,
            syncLastError: null,
            // Re-arm reminders so they fire at the new time.
            remH24: 0,
            remH2: 0,
          })
          .where(and(
            eq(appointments.id, apt.id),
            eq(appointments.tenantId, input.tenantId),
          ));
      } catch (e) {
        if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? ""))) {
          throw new TRPCError({ code: "CONFLICT", message: "slot_conflict" });
        }
        throw e;
      }

      // Analytics event — best-effort, mirrors createManual.
      try {
        const d1 = (ctx as unknown as { db: { $client?: { prepare?: (s: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown> } } } } }).db.$client;
        const actorId = String(ctx.webUser?.id ?? "unknown");
        const now = Math.floor(Date.now() / 1000);
        const props = JSON.stringify({
          source: "drag_reschedule",
          appointmentId: apt.id,
          fromDate: apt.date,
          fromTime: apt.time,
          fromMasterId: apt.masterId,
          toDate: input.newDate,
          toTime: input.newTime,
          toMasterId: newMasterId,
        });
        if (d1?.prepare) {
          await d1.prepare("INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(input.tenantId, actorId, "booking.rescheduled", props, now).run();
        }
      } catch { /* non-fatal */ }

      return { ok: true, appointmentId: apt.id, unchanged: false };
    }),
});
