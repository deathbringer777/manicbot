import { createTRPCRouter, adminProcedure, managerProcedure, publicProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { appointments, users, masters, services, masterClientBlocks } from "~/server/db/schema";
import { eq, desc, sql, and, gte, lte, isNull, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { assertTenantOwner, assertTenantBillingActive } from "~/server/api/tenantAccess";
import { slotsBusy } from "~/server/api/slotsBusy";
import { appointmentNameColumns, foldAppointmentNames } from "~/server/api/appointmentNames";
import { log } from "~/server/utils/logger";
import { notifyWorker, type AppointmentAction } from "~/server/utils/notifyWorker";
import { syncMarketingContact } from "~/server/clients/marketingSync";
import { warsawToUtcMs } from "~/lib/time";

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

      // Resolve client + service names at read time (see appointmentNames.ts).
      // tenant-scan-ignore: adminProcedure god-mode listing; the per-tenant filter is optional (conditions[]).
      const baseSelect = ctx.db
        .select({ ...getTableColumns(appointments), ...appointmentNameColumns })
        .from(appointments);
      const baseQuery = conditions.length > 0
        ? baseSelect.where(and(...conditions))
        : baseSelect;

      const [countResult, rows] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)` }).from(appointments)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
        baseQuery.orderBy(desc(appointments.ts)).limit(input.limit).offset(input.offset),
      ]);

      return {
        appointments: rows.map(foldAppointmentNames),
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
        // God Mode acts ON an explicit tenant — never inferred from session.
        tenantId: z.string(),
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
            .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
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
      // Defense-in-depth: confirm the appointment belongs to the asserted
      // tenant, then scope the write by (id, tenantId) so a stale tab or
      // wrong-row click can never mutate another salon's appointment.
      const aptRow = await ctx.db
        .select({ tenantId: appointments.tenantId })
        .from(appointments)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!aptRow[0]) return { success: false };
      const tenantId = input.tenantId;

      await ctx.db.update(appointments)
        .set(updates)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));

      // Fire-and-forget: notify Worker to send Telegram message + sync calendar
      // Worker expects bare verb ("confirm" / "reject" / "cancel"), not past tense
      const workerActionMap: Record<string, AppointmentAction | undefined> = {
        confirmed: "confirm",
        rejected: "reject",
        cancelled: "cancel",
      };
      const mappedAction = workerActionMap[input.status];
      if (tenantId && mappedAction) {
        notifyWorker(mappedAction, input.id, tenantId, updates.confirmedBy ?? null).catch(() => {});
      }

      return { success: true, updatedAt: Date.now() };
    }),

  /**
   * Claim-first confirmation of a booking request from the "Заявки" inbox.
   *
   * Allowed for tenant members (managerProcedure: master / tenant_owner /
   * tenant_manager / system_admin). A salon MASTER claims a request and is
   * assigned to it; an OWNER/manager may confirm without claiming to self.
   *
   * The claim is ATOMIC — the conditional UPDATE only matches while the
   * request is still unassigned + pending, so if two masters race, exactly one
   * gets a non-empty RETURNING and wins; the loser gets
   * { ok:false, reason:'already_taken' }. A master may also confirm a request
   * already assigned to themselves, but never one assigned to another master.
   */
  claimAndConfirm: managerProcedure
    .input(z.object({ tenantId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Resolve the caller's master chatId (salon masters claim to self). The
      // lookup is bound to web_user_id = caller — matching the createManual
      // IDOR rule so a master can only ever act as their own row.
      let callerChatId: number | null = null;
      if (ctx.webUser?.webRole === "master") {
        const [m] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(
            and(
              eq(masters.tenantId, input.tenantId),
              eq(masters.active, 1),
              eq(masters.webUserId, ctx.webUser.id),
            ),
          )
          .limit(1);
        if (!m) {
          throw new TRPCError({ code: "FORBIDDEN", message: "not_a_master_in_tenant" });
        }
        callerChatId = m.chatId;
      } else {
        // owner / manager / system_admin — must own this tenant.
        await assertTenantOwner(ctx, input.tenantId);
      }

      let claimed: { id: string }[] = [];
      if (callerChatId != null) {
        // 1. Claim an unassigned pending request (first-come-first-served).
        claimed = await ctx.db
          .update(appointments)
          .set({ status: "confirmed", masterId: callerChatId, confirmedBy: callerChatId })
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.id, input.id),
              isNull(appointments.masterId),
              eq(appointments.status, "pending"),
              eq(appointments.cancelled, 0),
            ),
          )
          .returning({ id: appointments.id });
        // 2. Or confirm a request already assigned to THIS master.
        if (!claimed.length) {
          claimed = await ctx.db
            .update(appointments)
            .set({ status: "confirmed", confirmedBy: callerChatId })
            .where(
              and(
                eq(appointments.tenantId, input.tenantId),
                eq(appointments.id, input.id),
                eq(appointments.masterId, callerChatId),
                eq(appointments.status, "pending"),
                eq(appointments.cancelled, 0),
              ),
            )
            .returning({ id: appointments.id });
        }
      } else {
        // Owner/manager confirm — no self-assignment.
        claimed = await ctx.db
          .update(appointments)
          .set({ status: "confirmed" })
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.id, input.id),
              eq(appointments.status, "pending"),
              eq(appointments.cancelled, 0),
            ),
          )
          .returning({ id: appointments.id });
      }

      if (!claimed.length) {
        return { ok: false as const, reason: "already_taken" as const };
      }

      // Worker side-effects: client confirmation message + calendar sync.
      notifyWorker("confirm", input.id, input.tenantId, callerChatId ?? null).catch(() => {});
      return { ok: true as const };
    }),

  markNoShow: adminProcedure
    .input(
      z.object({
        // God Mode acts ON an explicit tenant — never inferred from session.
        tenantId: z.string(),
        id: z.string(),
        noShowBy: z.enum(["client", "master"]),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId));
      const aptRow = await ctx.db
        .select({ tenantId: appointments.tenantId })
        .from(appointments)
        .where(scope)
        .limit(1);
      if (!aptRow[0]) return { success: false };

      await ctx.db.update(appointments).set({
        noShow: 1,
        noShowBy: input.noShowBy,
        status: "no_show",
        cancelReason: input.comment ?? null,
      }).where(scope);

      return { success: true, updatedAt: Date.now() };
    }),

  /**
   * Sprint 3: Manual booking from dashboard (owner → any master; master → self only).
   * Enforces slot-conflict check + auto-creates client if name+phone provided.
   */
  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  createManual: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      clientChatId: z.number().int().optional(),
      clientName: z.string().min(1).max(100).optional(),
      // Phone is no longer strictly required — the client may arrive via
      // email / Telegram nick / Instagram handle. The refinement below
      // enforces ≥1 contact.
      clientPhone: z.string().min(6).max(30).optional(),
      clientEmail: z.union([z.string().email(), z.literal("")]).optional(),
      clientTgUsername: z.string().max(64).optional(),
      clientIgUsername: z.string().max(64).optional(),
      // Optional (2026-05-26): salon owners may book a slot without
      // assigning a specific master — useful for empty-roster onboarding
      // or when the owner wants to assign later. Master role still must
      // specify their own masterId (enforced below).
      masterId: z.number().int().optional(),
      serviceId: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      note: z.string().max(500).optional(),
    }).refine(
      (d) =>
        d.clientChatId ||
        (d.clientName &&
          (d.clientPhone || (d.clientEmail && d.clientEmail !== "") || d.clientTgUsername || d.clientIgUsername)),
      { message: "Either clientChatId or (clientName + at least one contact: phone | email | telegram | instagram) required" },
    ))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // CS-1 (audit 2026-06-12): the billing gate must hold server-side, not
      // only as the client render-swap — booking writes are locked for an
      // expired-trial / churned tenant.
      await assertTenantBillingActive(ctx, input.tenantId);

      // Role scoping: masters can only book on their own calendar. The
      // lookup MUST be bound to `web_user_id = caller` — filtering only on
      // (tenantId, active=1) returns the first row regardless of who's
      // calling, so in a multi-master salon the wrong master row decided
      // the IDOR check (mirrors the masterRouter.assertCallerIsMaster
      // pattern, #P0-4).
      if (ctx.webUser?.webRole === "master") {
        // Masters must always own the booking. Refuse unassigned creates
        // outright — there is nothing to validate against.
        if (input.masterId === undefined) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only book on their own calendar",
          });
        }
        const [masterRow] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(
            eq(masters.tenantId, input.tenantId),
            eq(masters.active, 1),
            eq(masters.webUserId, ctx.webUser.id),
          ))
          .limit(1);
        if (!masterRow || masterRow.chatId !== input.masterId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only book on their own calendar",
          });
        }
      }

      // 0062 — fail-fast block check for existing clients. New-client
      // bookings (input.clientChatId omitted) can't be blocked yet
      // because the row doesn't exist, so we defer the post-resolve
      // check below. For existing clients we want the clearest error
      // message — refuse the booking up-front before spending queries
      // on slot-conflict and service-duration lookups.
      // Snapshot of an existing client's name/phone — copied onto the
      // appointment row so it stays self-describing for CSV export and any
      // raw-row reader (read-time resolution handles the live UI, but the
      // booking modal sends clientName=undefined for existing clients, which
      // would otherwise leave user_name NULL on the row).
      let existingClientName: string | null = null;
      let existingClientPhone: string | null = null;
      if (input.clientChatId != null) {
        const [existingClient] = await ctx.db
          .select({
            isBlockedGlobal: users.isBlockedGlobal,
            name: users.name,
            phone: users.phone,
          })
          .from(users)
          .where(and(
            eq(users.tenantId, input.tenantId),
            eq(users.chatId, input.clientChatId),
          ))
          .limit(1);
        if (existingClient?.isBlockedGlobal === 1) {
          throw new TRPCError({ code: "FORBIDDEN", message: "client_blocked_global" });
        }
        existingClientName = existingClient?.name ?? null;
        existingClientPhone = existingClient?.phone ?? null;
        // Per-master block check only when a master is assigned. With
        // masterId omitted there is no per-master scope to enforce.
        if (input.masterId !== undefined) {
          const [earlyMblock] = await ctx.db
            .select({ id: masterClientBlocks.id })
            .from(masterClientBlocks)
            .where(and(
              eq(masterClientBlocks.tenantId, input.tenantId),
              eq(masterClientBlocks.masterChatId, input.masterId),
              eq(masterClientBlocks.clientChatId, input.clientChatId),
            ))
            .limit(1);
          if (earlyMblock) {
            throw new TRPCError({ code: "FORBIDDEN", message: "client_blocked_for_master" });
          }
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
      //
      // Unassigned (no master) bookings skip this check — there is no
      // per-master schedule to conflict against. The slot conflict guard
      // re-runs in `appointments.update` once the owner assigns a master.
      if (input.masterId !== undefined) {
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
      }
      const [h, m] = input.time.split(":").map(Number);

      // Resolve or create client. New-client branch (0062) accepts any
      // contact channel (phone | email | telegram | instagram) — name +
      // at-least-one-contact, validated by the input schema.
      const normEmail = input.clientEmail && input.clientEmail !== "" ? input.clientEmail.toLowerCase() : null;
      const normTg = input.clientTgUsername ? input.clientTgUsername.replace(/^@+/, "") : null;
      const normIg = input.clientIgUsername ? input.clientIgUsername.replace(/^@+/, "") : null;

      let chatId = input.clientChatId ?? null;
      if (!chatId && input.clientName) {
        // Synthetic negative chatId for manually-created clients (no Telegram ID)
        chatId = -Math.floor(Date.now() / 1000);
        const nowSecForUser = Math.floor(Date.now() / 1000);
        try {
          await ctx.db.insert(users).values({
            tenantId: input.tenantId,
            chatId,
            name: input.clientName,
            phone: input.clientPhone ?? null,
            email: normEmail,
            tgUsername: normTg,
            igUsername: normIg,
            registeredAt: nowSecForUser,
            updatedAt: nowSecForUser,
            firstSource: "manual_dashboard",
          });
          // Mirror into the marketing directory so the new lead is
          // deduped + reachable by future campaigns. Non-fatal on
          // failure — the booking itself succeeds either way.
          try {
            const mcid = await syncMarketingContact(
              ctx.db,
              input.tenantId,
              {
                chatId,
                name: input.clientName,
                phone: input.clientPhone ?? null,
                email: normEmail,
                tgUsername: normTg,
                igUsername: normIg,
              },
              "booking_manual",
              nowSecForUser,
            );
            if (mcid) {
              await ctx.db
                .update(users)
                .set({ marketingContactId: mcid })
                .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, chatId)));
            }
          } catch (syncErr) {
            log.warn("appointments.createManual.marketingSync", {
              error: syncErr instanceof Error ? syncErr.message : String(syncErr),
            });
          }
        } catch (e) {
          log.error("appointments.createManual", e instanceof Error ? e : new Error(String(e)));
        }
      }
      if (!chatId) throw new TRPCError({ code: "BAD_REQUEST", message: "client_resolution_failed" });

      // 0062: client-block enforcement.
      // (1) Global tenant-wide block on the user — refuse outright.
      // (2) Per-master block (master_client_blocks) — refuse this combo only.
      const [blockedRow] = await ctx.db
        .select({ isBlockedGlobal: users.isBlockedGlobal })
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, chatId)))
        .limit(1);
      if (blockedRow?.isBlockedGlobal === 1) {
        throw new TRPCError({ code: "FORBIDDEN", message: "client_blocked_global" });
      }
      // Per-master block re-check — skipped for unassigned bookings.
      if (input.masterId !== undefined) {
        const [mblock] = await ctx.db
          .select({ id: masterClientBlocks.id })
          .from(masterClientBlocks)
          .where(and(
            eq(masterClientBlocks.tenantId, input.tenantId),
            eq(masterClientBlocks.masterChatId, input.masterId),
            eq(masterClientBlocks.clientChatId, chatId),
          ))
          .limit(1);
        if (mblock) {
          throw new TRPCError({ code: "FORBIDDEN", message: "client_blocked_for_master" });
        }
      }

      // Create appointment
      const aptId = `a${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Math.floor(Date.now() / 1000);
      const [y, mo, d] = input.date.split("-").map(Number);
      // Canonical appointment `ts` = epoch MILLISECONDS for the Warsaw wall
      // clock (matches the Worker bot/cron/GCal/stats). BUG-01: was seconds +
      // raw UTC, breaking reminders/sync/stats/cleanup for admin-booked rows.
      const startTs = warsawToUtcMs(y!, mo!, d!, h!, m!);

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
          masterId: input.masterId ?? null,
          userName: input.clientName ?? existingClientName ?? null,
          userPhone: input.clientPhone ?? existingClientPhone ?? null,
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
        const props = JSON.stringify({ source: "manual_dashboard", masterId: input.masterId ?? null, serviceId: input.serviceId, aptId });
        if (d1?.prepare) {
          await d1.prepare("INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(input.tenantId, actorId, "booking.created", props, now).run();
        }
      } catch { /* non-fatal */ }

      // Fire-and-forget: push the new booking to the connected Google Calendar
      // immediately. A manual dashboard booking is created already-confirmed
      // but was previously left to the ≤15-min `phaseGcalSync` cron, so it
      // didn't show up in Google Calendar until the next tick. "sync_calendar"
      // is calendar-only — it does NOT message the client (manual bookings stay
      // silent by design). We pass the row payload in `apt` so the Worker can
      // sync even when the freshly-inserted row isn't yet visible to its D1
      // read (read-after-write); the Worker uses this payload only when it is
      // tenant-matched. See adminKeyHttp sync_calendar.
      notifyWorker("sync_calendar", aptId, input.tenantId, null, {
        apt: {
          id: aptId,
          tenantId: input.tenantId,
          chatId,
          svcId: input.serviceId,
          date: input.date,
          time: input.time,
          ts: startTs,
          status: "confirmed",
          masterId: input.masterId ?? null,
          userName: input.clientName ?? existingClientName ?? null,
          userPhone: input.clientPhone ?? existingClientPhone ?? null,
        },
      }).catch(() => {});

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
   *     owner nudges a block by 15 minutes. The explicit "Save" flow in
   *     the detail panel uses `appointments.update` (below) which DOES
   *     notify — separation by user intent.
   */
  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  rescheduleAppointment: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      appointmentId: z.string().min(1),
      newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      newTime: z.string().regex(/^\d{2}:\d{2}$/),
      newMasterId: z.number().int().optional(),
      // Drag-the-bottom-edge resize: when present, overrides the stored
      // duration (decoupled from the service nominal) AND sizes the conflict
      // window. Omitted for a plain move.
      newDurationMin: z.number().int().min(15).max(60 * 24).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // CS-1: server-side billing gate (see createManual).
      await assertTenantBillingActive(ctx, input.tenantId);

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

      // One shared calendar (no masters) is supported: an unassigned booking
      // (master_id NULL) stays unassigned and skips the per-master conflict
      // check below — there is no master schedule to collide with, and
      // overlapping bookings on a shared calendar are allowed by design.
      const newMasterId = input.newMasterId ?? apt.masterId;

      // Role scoping: masters can only move bookings on their own calendar
      // and can't reassign to another master. The lookup is bound to
      // `web_user_id = caller` — see createManual for the rationale.
      if (ctx.webUser?.webRole === "master") {
        const [masterRow] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(
            eq(masters.tenantId, input.tenantId),
            eq(masters.active, 1),
            eq(masters.webUserId, ctx.webUser.id),
          ))
          .limit(1);
        if (!masterRow || masterRow.chatId !== apt.masterId || newMasterId !== apt.masterId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only reschedule on their own calendar",
          });
        }
      }

      // No-op short-circuit: if nothing actually changed, return early so we
      // don't pay the conflict check + sync-reset cost. A duration-only change
      // (resize in place) still counts as a real change.
      const durationChanged =
        input.newDurationMin != null && input.newDurationMin !== apt.duration;
      if (
        apt.date === input.newDate &&
        apt.time === input.newTime &&
        apt.masterId === newMasterId &&
        !durationChanged
      ) {
        return { ok: true, appointmentId: apt.id, unchanged: true };
      }

      // Per-master conflict check — skipped for unassigned (no-master)
      // bookings, mirroring createManual. With master_id NULL there is no
      // per-master schedule to collide with, so an unassigned drag just
      // moves the row to the new slot (overlaps allowed on a shared calendar).
      if (newMasterId != null) {
        // Resolve service duration for the conflict check.
        const [svc] = await ctx.db
          .select()
          .from(services)
          .where(and(
            eq(services.tenantId, input.tenantId),
            eq(services.svcId, apt.svcId),
          ))
          .limit(1);
        // Resize overrides the conflict window; otherwise use the service's
        // nominal duration (falling back to 60 when the service is missing).
        const durationMin = input.newDurationMin ?? svc?.duration ?? 60;

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
      }

      const [h, m] = input.newTime.split(":").map(Number);
      const [y, mo, d] = input.newDate.split("-").map(Number);
      // ms + Warsaw→UTC (BUG-04: same defect as createManual).
      const newTs = warsawToUtcMs(y!, mo!, d!, h!, m!);

      try {
        await ctx.db
          .update(appointments)
          .set({
            date: input.newDate,
            time: input.newTime,
            ts: newTs,
            masterId: newMasterId,
            // Persist a resized duration (decoupled from the service nominal).
            ...(input.newDurationMin != null ? { duration: input.newDurationMin } : {}),
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

  /**
   * Tenant-scoped edit for an existing appointment — powers the rich
   * detail panel on the salon day view (reschedule / change master /
   * change service from one place).
   *
   * Unlike `rescheduleAppointment` (silent, frequent, drag-driven), `update`
   * represents an EXPLICIT user save and DOES fire the Worker notify — the
   * client gets an `apt_rescheduled` "Was X → Now Y" message when the slot
   * actually moves. No-op saves and note-only changes (when we add a note
   * column) skip the notify.
   *
   * Authorization mirrors `createManual`: `assertTenantOwner` (covers
   * `tenant_owner`, `system_admin`, and `master` on personal tenants).
   * Salon-employed masters land at FORBIDDEN — by design the owner
   * reshuffles bookings in a multi-master salon.
   */
  // nosemgrep: trpc-public-procedure-mutation -- TODO(#259): auth via assertTenantOwner inside handler; migrate to tenantOwnerProcedure post-launch
  update: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        masterId: z.number().int().optional(),
        serviceId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load the current row + tenant so we can authorize before mutating.
      const [current] = await ctx.db
        .select({
          id: appointments.id,
          tenantId: appointments.tenantId,
          date: appointments.date,
          time: appointments.time,
          masterId: appointments.masterId,
          svcId: appointments.svcId,
        })
        // tenant-scan-ignore: load-by-id to read the row's tenant; assertTenantOwner(current.tenantId) below authorizes before any write.
        .from(appointments)
        .where(eq(appointments.id, input.id))
        .limit(1);
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
      }

      await assertTenantOwner(ctx, current.tenantId);
      // CS-1: server-side billing gate (see createManual).
      await assertTenantBillingActive(ctx, current.tenantId);

      // Cross-tenant guards — never trust the input. masterId/serviceId
      // must belong to the same tenant as the appointment.
      if (input.masterId !== undefined && input.masterId !== current.masterId) {
        const [m] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(eq(masters.tenantId, current.tenantId), eq(masters.chatId, input.masterId)))
          .limit(1);
        if (!m) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "master_not_in_tenant" });
        }
      }
      let nextSvcDuration: number | null = null;
      if (input.serviceId !== undefined && input.serviceId !== current.svcId) {
        const [s] = await ctx.db
          .select({ svcId: services.svcId, duration: services.duration })
          .from(services)
          .where(and(eq(services.tenantId, current.tenantId), eq(services.svcId, input.serviceId)))
          .limit(1);
        if (!s) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "service_not_in_tenant" });
        }
        nextSvcDuration = s.duration;
      }

      // Resolve the effective post-update tuple.
      const nextDate = input.date ?? current.date;
      const nextTime = input.time ?? current.time;
      const nextMaster = input.masterId ?? current.masterId;
      const nextSvc = input.serviceId ?? current.svcId;

      const slotChanged =
        nextDate !== current.date
        || nextTime !== current.time
        || nextMaster !== current.masterId
        || nextSvc !== current.svcId;

      // Only run the conflict check when the slot actually moves — a save
      // that touches only metadata (none today; reserved for future fields)
      // should never trip on its own row.
      if (slotChanged && nextMaster != null) {
        // Need the duration of the post-update service to size the busy window.
        let durationMin = nextSvcDuration;
        if (durationMin == null) {
          const [s] = await ctx.db
            .select({ duration: services.duration })
            .from(services)
            .where(and(eq(services.tenantId, current.tenantId), eq(services.svcId, nextSvc)))
            .limit(1);
          if (!s) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "service_not_in_tenant" });
          }
          durationMin = s.duration;
        }
        const busy = await slotsBusy({
          db: ctx.db,
          tenantId: current.tenantId,
          masterId: nextMaster,
          date: nextDate,
          startTime: nextTime,
          durationMin,
          excludeAppointmentId: current.id,
        });
        if (busy.busy) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "slot_conflict",
            cause: busy.conflict,
          });
        }
      }

      // Recompute `ts` from date+time so list ORDER BY ts stays correct
      // after a reschedule. ms + Warsaw→UTC, same helper as createManual
      // (BUG-04).
      const [yyyy, mm, dd] = nextDate.split("-").map(Number);
      const [hh, mi] = nextTime.split(":").map(Number);
      const nextTs = warsawToUtcMs(yyyy!, mm!, dd!, hh!, mi!);

      const updates: Record<string, string | number | null> = {
        date: nextDate,
        time: nextTime,
        masterId: nextMaster ?? null,
        svcId: nextSvc,
        ts: nextTs,
      };
      await ctx.db.update(appointments).set(updates).where(eq(appointments.id, current.id));

      // Notify Worker only when the client-visible slot actually moved.
      // Sends apt_rescheduled with prior date/time so the message reads
      // "Was X → Now Y". Fire-and-forget; failure logs and does not
      // bubble.
      if (slotChanged) {
        notifyWorker(
          "reschedule",
          current.id,
          current.tenantId,
          null,
          { oldDate: current.date, oldTime: current.time },
        ).catch(() => {});
      }

      return {
        ok: true,
        id: current.id,
        date: nextDate,
        time: nextTime,
        masterId: nextMaster,
        svcId: nextSvc,
        notified: slotChanged,
      };
    }),
});
