import { z } from "zod";
import { createTRPCRouter, masterProcedure } from "~/server/api/trpc";
import {
  appointments,
  masters,
  users,
  services,
  tenants,
  tenantActionRequests,
  masterClientBlocks,
  bots,
  masterPairingCodes,
  webUsers,
} from "~/server/db/schema";
import { eq, and, gte, lte, desc, inArray, isNull, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sanitizeText } from "~/server/security/sanitize";
import { isHttpsUrl } from "~/server/lib/url";
import {
  parseMasterHours,
  isValidMasterHours,
  serializeMasterHours,
  parseMasterWorkDays,
  serializeMasterWorkDays,
  decodeMasterSchedule,
  validateMasterSchedule,
  serializeMasterSchedule,
  deriveWorkDaysFromSchedule,
} from "~/lib/workHours";
import { readMasterSchedulePolicy } from "~/lib/masterSchedulePolicy";
import { notifyOrCapture } from "~/server/services/notifyOrCapture";
import { nowSec } from "~/lib/time";
import { t, type Lang } from "~/lib/i18n";
import { notifyWorker } from "~/server/utils/notifyWorker";
import {
  generatePairingToken,
  buildDeepLink,
  PAIRING_TOKEN_TTL_SEC,
} from "~/server/api/masterPairing/tokenLogic";
import { decryptMasterPassword } from "~/server/security/masterPasswordVault";
import { writeAudit, ctxIp } from "~/server/security/audit";
import type { TenantAccessCtx } from "~/server/api/tenantAccess";
import { env } from "~/env";
import { log } from "~/server/utils/logger";

/** Assert caller is master on a personal (independent) tenant — allows service/config management */
async function assertPersonalMaster(ctx: TenantAccessCtx, tenantId: string) {
  await assertMaster(ctx, tenantId);
  if (ctx.webUser?.webRole === "system_admin") return;
  const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t?.isPersonal) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Service management is only available for independent masters" });
  }
}

async function assertMaster(ctx: TenantAccessCtx, tenantId: string) {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const r = ctx.webUser.webRole;
  if (r === "system_admin") return;
  if ((r === "master" || r === "tenant_owner") && ctx.webUser.tenantId === tenantId) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Master access required" });
}

/**
 * #S-01 / #P0-4 — close master IDOR.
 *
 * For role === "master": the caller may only target their OWN master row.
 * The binding lives in `masters.web_user_id` (migration 0043). Migration
 * 0046 backfills web_user_id for legacy personal-tenant rows so this lookup
 * is now authoritative.
 *
 * For role === "tenant_owner" or "system_admin": any master in the tenant.
 *
 * Throws FORBIDDEN if no binding can be proven. The previous count-based
 * fallback for personal tenants was removed (race condition: a second master
 * being added would silently widen the hole). If a personal master shows up
 * here without web_user_id set, the owner needs to rebind via the dashboard
 * — false-negative is preferable to false-positive in a security guard.
 */
async function assertCallerIsMaster(ctx: TenantAccessCtx, tenantId: string, masterId: number) {
  await assertMaster(ctx, tenantId);
  // assertMaster guarantees ctx.webUser is set, but bind it locally so the
  // compiler can narrow `id` below (TenantAccessCtx.webUser is nullable).
  const webUser = ctx.webUser;
  if (!webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const role = webUser.webRole;
  if (role === "system_admin" || role === "tenant_owner") return;
  if (role !== "master") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Master access required" });
  }

  // Authoritative: row pinned to this web user.
  const [boundRow] = await ctx.db
    .select({ chatId: masters.chatId })
    .from(masters)
    .where(and(
      eq(masters.tenantId, tenantId),
      eq(masters.webUserId, webUser.id),
      eq(masters.active, 1),
    ))
    .limit(1);
  if (!boundRow) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot act on another master's record" });
  }
  if (boundRow.chatId !== masterId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot act on another master's record" });
  }
}

/** `tenant_action_requests.action` value carrying a proposed schedule change. */
const SCHEDULE_CHANGE_ACTION = "master.schedule_change";

const SUPPORTED_LANGS: readonly Lang[] = ["ru", "ua", "en", "pl"];
function asLang(raw: unknown): Lang {
  return typeof raw === "string" && (SUPPORTED_LANGS as readonly string[]).includes(raw)
    ? (raw as Lang)
    : "en";
}

/**
 * Create — or, if one is already pending for this master, update — the
 * schedule-change request. One pending request per master keeps the owner's
 * queue clean (a master tweaking their proposal twice shouldn't spawn two).
 * The proposed values live in `payload` keyed by chatId so the owner-side
 * review can locate the master row + reuse the booking-engine shape.
 */
async function upsertPendingScheduleRequest(
  ctx: TenantAccessCtx,
  tenantId: string,
  masterId: number,
  requesterId: string,
  workHours: string | undefined,
  workDays: string | undefined,
): Promise<string> {
  const payloadObj: Record<string, unknown> = { masterId };
  if (workHours !== undefined) payloadObj.workHours = workHours;
  if (workDays !== undefined) payloadObj.workDays = workDays;
  const payload = JSON.stringify(payloadObj);

  const [existing] = await ctx.db
    .select({ id: tenantActionRequests.id })
    .from(tenantActionRequests)
    .where(and(
      eq(tenantActionRequests.tenantId, tenantId),
      eq(tenantActionRequests.requesterId, requesterId),
      eq(tenantActionRequests.action, SCHEDULE_CHANGE_ACTION),
      eq(tenantActionRequests.status, "pending"),
    ))
    .limit(1);

  if (existing?.id) {
    await ctx.db
      .update(tenantActionRequests)
      .set({ payload, createdAt: nowSec() })
      .where(eq(tenantActionRequests.id, existing.id));
    return existing.id;
  }

  const id = crypto.randomUUID();
  await ctx.db.insert(tenantActionRequests).values({
    id,
    tenantId,
    requesterId,
    action: SCHEDULE_CHANGE_ACTION,
    payload,
    status: "pending",
    createdAt: nowSec(),
  });
  return id;
}

/** Best-effort in-app bell to the salon owner about a pending schedule request. */
async function notifyOwnerOfScheduleRequest(
  ctx: TenantAccessCtx,
  tenantId: string,
  requestId: string,
): Promise<void> {
  const [owner] = await ctx.db
    .select({ id: webUsers.id, lang: webUsers.lang })
    .from(webUsers)
    .where(and(eq(webUsers.tenantId, tenantId), eq(webUsers.role, "tenant_owner")))
    .limit(1);
  if (!owner?.id) return;
  const lang = asLang(owner.lang);
  await notifyOrCapture(
    ctx.db,
    {
      webUserId: owner.id,
      kind: "approval",
      tenantId,
      title: t("notify.scheduleRequest.title", lang),
      body: t("notify.scheduleRequest.body", lang),
      link: "?tab=masters",
      sourceSlug: "schedule_request",
      sourceId: requestId,
    },
    { path: "master.updateWorkHours" },
  );
}

/** Apply a master-owned vacation toggle (never gated by the schedule policy). */
async function applyMasterVacationToggle(
  ctx: TenantAccessCtx,
  tenantId: string,
  masterId: number,
  onVacation: number,
): Promise<void> {
  const setObj: Record<string, unknown> = { onVacation };
  if (onVacation === 0) {
    setObj.vacationFrom = null;
    setObj.vacationUntil = null;
  }
  await ctx.db.update(masters).set(setObj)
    .where(and(eq(masters.tenantId, tenantId), eq(masters.chatId, masterId)));
}

export const masterRouter = createTRPCRouter({
  updateDelegation: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      allowDelegation: z.number().min(0).max(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // Only the master themselves can change this setting (not the owner, not the admin).
      // #S-01: enforce that input.masterId IS the caller's own master row.
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (ctx.webUser.webRole !== "master" || ctx.webUser.tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the master can change delegation setting" });
      }
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      await ctx.db.update(masters)
        .set({ allowDelegation: input.allowDelegation })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),

  /**
   * Master-owned setting (migration 0049). Controls peer-to-peer calendar
   * visibility within the tenant. The salon owner always sees all masters'
   * calendars regardless of this value (enforced elsewhere).
   *
   * Role gating:
   *   - master:        may set their OWN row only (IDOR-guarded).
   *   - tenant_owner:  rejected. Masters own this toggle by design.
   *   - system_admin:  may set any row (support escalation path).
   */
  updateCalendarVisibility: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      visibility: z.enum(["private", "salon_only", "salon_and_peers"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      const role = ctx.webUser.webRole;
      if (role !== "master" && role !== "system_admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the master themselves can change calendar visibility",
        });
      }
      // For master role: enforce same-tenant + own-row binding (IDOR).
      // system_admin skips both gates.
      if (role === "master") {
        if (ctx.webUser.tenantId !== input.tenantId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the master themselves can change calendar visibility",
          });
        }
        await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      }
      await ctx.db.update(masters)
        .set({ calendarVisibility: input.visibility })
        .where(and(
          eq(masters.tenantId, input.tenantId),
          eq(masters.chatId, input.masterId),
        ));
      return { success: true };
    }),


  getMySchedule: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const today = new Date().toISOString().slice(0, 10);
      return ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
          eq(appointments.date, today),
        ))
        .orderBy(appointments.time);
    }),

  getMyAppointments: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const rows = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
          ...(input.dateFrom ? [gte(appointments.date, input.dateFrom)] : []),
          ...(input.dateTo ? [lte(appointments.date, input.dateTo)] : []),
        ))
        .orderBy(desc(appointments.ts))
        .limit(200);
      return rows;
    }),

  getMyEarnings: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const rows = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
          eq(appointments.status, "confirmed"),
          ...(input.dateFrom ? [gte(appointments.date, input.dateFrom)] : []),
          ...(input.dateTo ? [lte(appointments.date, input.dateTo)] : []),
        ));
      // Get service prices
      const svcRows = await ctx.db.select().from(services).where(eq(services.tenantId, input.tenantId));
      const priceMap = Object.fromEntries(svcRows.map((s: any) => [s.svcId, s.price]));
      const total = rows.reduce((sum: number, a: any) => sum + (priceMap[a.svcId] ?? 0), 0);
      return { total, count: rows.length };
    }),

  getMyClients: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const apts = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
        ))
        .orderBy(desc(appointments.ts));
      // Unique client chat IDs with last appointment
      const seen = new Map<number, any>();
      for (const a of apts) {
        if (!seen.has(a.chatId)) seen.set(a.chatId, a);
      }
      const clientIds = Array.from(seen.keys());
      if (!clientIds.length) return [];
      const clientRows = await ctx.db.select().from(users)
        .where(and(eq(users.tenantId, input.tenantId), inArray(users.chatId, clientIds)));
      const clientMap = Object.fromEntries(clientRows.map((u: any) => [u.chatId, u]));
      return clientIds.map(id => ({
        ...clientMap[id],
        lastAppointment: seen.get(id),
      }));
    }),

  markNoShow: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      noShowBy: z.enum(["client", "master"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      // #S-01: a master may only mark THEIR OWN appointments as no-show.
      // tenant_owner / system_admin keep blanket access.
      if (ctx.webUser?.webRole === "master") {
        const [apt] = await ctx.db
          .select({ masterId: appointments.masterId })
          .from(appointments)
          .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
          .limit(1);
        if (!apt) throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        if (apt.masterId == null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Unassigned appointment — only the salon owner can mark it" });
        }
        await assertCallerIsMaster(ctx, input.tenantId, apt.masterId);
      }
      await ctx.db.update(appointments).set({
        noShow: 1,
        noShowBy: input.noShowBy,
        status: "no_show",
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      const action = input.noShowBy === "client" ? "no_show_client" : "no_show_master";
      notifyWorker(action, input.id, input.tenantId, null).catch(() => {});
      return { success: true };
    }),

  /**
   * Tenant-scoped pending → confirmed for the master surface. Mirrors
   * `salon.confirmAppointment` but enforces the master IDOR guard when
   * the caller is a salon-employed master.
   */
  confirmAppointment: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const [row] = await ctx.db
        .select({
          status: appointments.status,
          cancelled: appointments.cancelled,
          masterId: appointments.masterId,
        })
        .from(appointments)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
      }
      if (ctx.webUser?.webRole === "master") {
        if (row.masterId == null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Unassigned appointment — only the salon owner can confirm it" });
        }
        await assertCallerIsMaster(ctx, input.tenantId, row.masterId);
      }
      if (row.cancelled || (row.status !== "pending" && row.status !== "confirmed")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_status_transition" });
      }
      await ctx.db
        .update(appointments)
        .set({ status: "confirmed" })
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      notifyWorker("confirm", input.id, input.tenantId, null).catch(() => {});
      return { success: true };
    }),

  /**
   * Tenant-scoped confirmed → done for the master surface. Refuses if the
   * appointment time hasn't passed yet (product decision: cannot mark an
   * appointment complete before its start).
   */
  markDone: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const [row] = await ctx.db
        .select({
          status: appointments.status,
          cancelled: appointments.cancelled,
          ts: appointments.ts,
          masterId: appointments.masterId,
        })
        .from(appointments)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
      }
      if (ctx.webUser?.webRole === "master") {
        if (row.masterId == null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Unassigned appointment — only the salon owner can mark it" });
        }
        await assertCallerIsMaster(ctx, input.tenantId, row.masterId);
      }
      if (row.cancelled || (row.status !== "confirmed" && row.status !== "pending")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_status_transition" });
      }
      // appointments.ts is epoch MILLISECONDS (Warsaw→UTC); compare against
      // Date.now() in ms. BUG-02: comparing against seconds rejected every real
      // (ms) past bot booking, so masters/owners could never mark them Done.
      if (row.ts > Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot_mark_done_before_start" });
      }
      await ctx.db
        .update(appointments)
        .set({ status: "done" })
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      notifyWorker("done", input.id, input.tenantId, null).catch(() => {});
      return { success: true };
    }),

  getMyProfile: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const row = await ctx.db.select().from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)))
        .limit(1);
      if (!row[0]) return null;
      const m = row[0];
      let portfolio: string[] = [];
      try { portfolio = m.portfolio ? JSON.parse(m.portfolio) : []; } catch { /* ignore */ }
      return { ...m, portfolio };
    }),

  /**
   * Master-side "show my original password" — surface the salon-issued
   * plaintext password to the master themselves. Owner-side peek lives in
   * `salon.peekMasterPassword` (OTP-gated). This procedure is the inverse:
   * the master inspects their OWN credential after they've logged in and
   * verified their email, so they can keep a record of it for password-
   * manager onboarding before rotating it via the standard change-password
   * flow.
   *
   * Requirements:
   *   1. Caller's web session resolves to a master row in this tenant
   *      (assertCallerIsMaster — closes IDOR).
   *   2. Account is salon-owned (origin='salon_created') AND has a
   *      reversibly-encrypted password (web_users.password_encrypted IS NOT
   *      NULL). Self-registered + invited masters own their own credentials
   *      and never have a recoverable copy.
   *   3. Email is verified — for synthetic *.salon.manicbot.local mailboxes
   *      email_verified=1 is set at creation time, so the master sees the
   *      button immediately. Real-email overrides must verify first.
   *   4. BOT_ENCRYPTION_KEY is configured on Pages — without it,
   *      decryptMasterPassword returns null and we surface
   *      `password_not_vaulted` instead of a 500.
   *
   * Audit: every successful peek lands in `audit_log` with action
   * `tenant.master.password.peek_self` and the caller's email. No OTP
   * (the master already authenticated to the web session).
   */
  peekMyOriginalPassword: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      if (!ctx.webUser?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Resolve the master row + linked web user in one query for the
      // origin / email-verified / encrypted-blob checks.
      const [row] = await ctx.db
        .select({
          origin: masters.origin,
          webUserId: masters.webUserId,
          email: webUsers.email,
          emailVerified: webUsers.emailVerified,
          passwordEncrypted: webUsers.passwordEncrypted,
        })
        .from(masters)
        .leftJoin(webUsers, eq(webUsers.id, masters.webUserId))
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "master_not_found" });
      if (row.origin !== "salon_created") {
        throw new TRPCError({ code: "FORBIDDEN", message: "not_owned_by_salon" });
      }
      if (!row.webUserId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "master_has_no_web_user" });
      }
      // Defense in depth: the master must be peeking their OWN row. Even
      // though assertCallerIsMaster already pinned masterId→ctx.webUser.id,
      // re-verify the web-user binding so a future refactor of the auth
      // layer can't quietly widen the hole.
      if (row.webUserId !== ctx.webUser.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot peek another master's password" });
      }
      if (!row.emailVerified) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "email_not_verified" });
      }
      const blob = row.passwordEncrypted;
      if (!blob) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "password_not_vaulted" });
      }
      const plain = await decryptMasterPassword(blob, env.BOT_ENCRYPTION_KEY ?? null);
      if (!plain) {
        log.error(
          "master.peekMyOriginalPassword",
          new Error("decrypt_failed (BOT_ENCRYPTION_KEY mismatch or tampered blob)"),
        );
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "password_not_vaulted" });
      }

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: "tenant.master.password.peek_self",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterId}`,
        ip: ctxIp(ctx),
      });

      return { password: plain };
    }),

  updateProfile: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      bio: z.string().max(500).optional(),
      // SEC-003: https-only. `.url()` accepts `javascript:`/`data:`; both fields
      // render into `<img src>` and could move into an `<a href>` later.
      photo: z.string().max(2048).refine(isHttpsUrl, { message: "url_must_be_https" }).optional().or(z.literal("")),
      portfolio: z.array(z.string().max(2048).refine(isHttpsUrl, { message: "url_must_be_https" })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const setObj: Record<string, unknown> = {};
      if (input.bio !== undefined) setObj.bio = input.bio ? sanitizeText(input.bio, 500) : null;
      if (input.portfolio !== undefined) {
        setObj.portfolio = JSON.stringify(input.portfolio);
        // Keep masters.photo in sync with first portfolio entry for backward compat
        setObj.photo = input.portfolio[0] ?? null;
      } else if (input.photo !== undefined) {
        setObj.photo = input.photo || null;
      }
      if (Object.keys(setObj).length === 0) return { success: true };
      await ctx.db.update(masters)
        .set(setObj)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),

  // ── Service management for independent (personal tenant) masters ──

  getMyServices: masterProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      return ctx.db.select().from(services)
        .where(eq(services.tenantId, input.tenantId))
        .orderBy(services.sortOrder);
    }),

  createService: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      emoji: z.string().optional(),
      duration: z.number(),
      price: z.number(),
      names: z.string(),
      description: z.string().optional(),
      photos: z.string().optional(),
      promo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertPersonalMaster(ctx, input.tenantId);
      const svcId = `svc_${Date.now()}`;
      await ctx.db.insert(services).values({
        tenantId: input.tenantId,
        svcId,
        emoji: input.emoji ?? null,
        duration: input.duration,
        price: input.price,
        names: sanitizeText(input.names, 500),
        description: input.description ? sanitizeText(input.description, 2000) : null,
        photos: input.photos ?? null,
        promo: input.promo ? sanitizeText(input.promo, 500) : null,
        active: 1,
        hidden: 0,
        sortOrder: 0,
      });
      return { svcId };
    }),

  updateService: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      svcId: z.string(),
      price: z.number().optional(),
      duration: z.number().optional(),
      emoji: z.string().optional(),
      names: z.string().optional(),
      active: z.number().min(0).max(1).optional(),
      description: z.string().optional(),
      photos: z.string().optional(),
      promo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertPersonalMaster(ctx, input.tenantId);
      const { tenantId, svcId, ...updates } = input;
      if (updates.names !== undefined) updates.names = sanitizeText(updates.names, 500);
      if (updates.description !== undefined) updates.description = sanitizeText(updates.description, 2000);
      if (updates.promo !== undefined) updates.promo = sanitizeText(updates.promo, 500);
      const setObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) setObj[k] = v;
      }
      if (Object.keys(setObj).length === 0) return { success: true };
      await ctx.db.update(services).set(setObj).where(
        and(eq(services.tenantId, tenantId), eq(services.svcId, svcId))
      );
      return { success: true };
    }),

  deleteService: masterProcedure
    .input(z.object({ tenantId: z.string(), svcId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertPersonalMaster(ctx, input.tenantId);
      await ctx.db.update(services).set({ active: 0, hidden: 1 }).where(
        and(eq(services.tenantId, input.tenantId), eq(services.svcId, input.svcId))
      );
      return { success: true };
    }),

  /** Update work hours for independent master */
  updateWorkHours: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      // Preferred: per-day `{"days":{…}}` schedule (per-day hours + one optional
      // break). Legacy `{from,to}` + 0..6 weekday array still accepted — both
      // normalize to the shape the Worker booking engine reads (see ~/lib/workHours).
      workSchedule: z.string().max(2000).optional(),
      workHours: z.string().max(200).optional(),
      workDays: z.string().max(200).optional(),
      onVacation: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      // Validate + normalize the schedule inputs once (shared by every path),
      // to the booking-engine shape the Worker reads. Reject malformed input.
      // Prefer the per-day `workSchedule`; fall back to the legacy pair.
      let whStr: string | undefined;
      let wdStr: string | undefined;
      if (input.workSchedule !== undefined) {
        const state = decodeMasterSchedule(input.workSchedule);
        if (!state) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_schedule" });
        }
        const v = validateMasterSchedule(state);
        if (!v.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `invalid_master_schedule_${v.reason}` });
        }
        whStr = serializeMasterSchedule(state);
        wdStr = serializeMasterWorkDays(deriveWorkDaysFromSchedule(state));
      } else {
        if (input.workHours !== undefined) {
          const parsed = parseMasterHours(input.workHours);
          if (!parsed || !isValidMasterHours(parsed.from, parsed.to)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_hours" });
          }
          whStr = serializeMasterHours(parsed.from, parsed.to);
        }
        if (input.workDays !== undefined) {
          const parsed = parseMasterWorkDays(input.workDays);
          if (parsed === null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_work_days" });
          }
          wdStr = serializeMasterWorkDays(parsed);
        }
      }

      // Salon-level policy gates ONLY the `master` role's own schedule edits —
      // never the owner (who writes via salon.updateMaster) and never the
      // master-owned vacation toggle.
      const callerIsMaster = ctx.webUser?.webRole === "master";
      const touchesSchedule = whStr !== undefined || wdStr !== undefined;
      if (callerIsMaster && touchesSchedule) {
        const [tRow] = await ctx.db
          .select({ salon: tenants.salon })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        const policy = readMasterSchedulePolicy(tRow?.salon ?? null);

        if (policy === "salon_only") {
          throw new TRPCError({ code: "FORBIDDEN", message: "master_schedule_locked" });
        }
        if (policy === "master_approval") {
          const requestId = await upsertPendingScheduleRequest(
            ctx, input.tenantId, input.masterId, ctx.webUser!.id, whStr, wdStr,
          );
          await notifyOwnerOfScheduleRequest(ctx, input.tenantId, requestId);
          // A vacation toggle, if also present, is master-owned — apply now.
          if (input.onVacation !== undefined) {
            await applyMasterVacationToggle(ctx, input.tenantId, input.masterId, input.onVacation);
          }
          return { pending: true as const, requestId };
        }
        // master_free → fall through to the direct write below.
      }

      const setObj: Record<string, unknown> = {};
      if (whStr !== undefined) setObj.workHours = whStr;
      if (wdStr !== undefined) setObj.workDays = wdStr;
      if (input.onVacation !== undefined) {
        setObj.onVacation = input.onVacation;
        // Toggling the legacy flag OFF clears any pinned date range — the
        // master can't be "back at work" and still have a future end date.
        if (input.onVacation === 0) {
          setObj.vacationFrom = null;
          setObj.vacationUntil = null;
        }
      }
      if (Object.keys(setObj).length === 0) return { success: true };
      await ctx.db.update(masters).set(setObj)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),

  /** Salon-level master-schedule policy (gates this master's own editor). */
  getSchedulePolicy: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const [tRow] = await ctx.db
        .select({ salon: tenants.salon })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      return { policy: readMasterSchedulePolicy(tRow?.salon ?? null) };
    }),

  /** This master's outstanding schedule-change request (master_approval mode). */
  getMyPendingScheduleRequest: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const [row] = await ctx.db
        .select()
        .from(tenantActionRequests)
        .where(and(
          eq(tenantActionRequests.tenantId, input.tenantId),
          eq(tenantActionRequests.requesterId, ctx.webUser!.id),
          eq(tenantActionRequests.action, SCHEDULE_CHANGE_ACTION),
          eq(tenantActionRequests.status, "pending"),
        ))
        .orderBy(desc(tenantActionRequests.createdAt))
        .limit(1);
      if (!row) return { pending: null };
      let payload: unknown = null;
      try { payload = row.payload ? JSON.parse(row.payload) : null; } catch { /* ignore */ }
      return { pending: { id: row.id, createdAt: row.createdAt, payload } };
    }),

  /**
   * Booksy-style vacation range. Either both dates set (a closed window)
   * or both null (clears the vacation entirely). The legacy `on_vacation`
   * boolean is kept in lock-step so the Worker booking + notification
   * paths (which still read the old flag) don't have to be changed in
   * the same release. Range semantics:
   *   from <= NOW <= until → flag = 1
   *   future range         → flag = 0 (will flip when from <= NOW)
   *   cleared              → flag = 0
   *
   * The "flip-when-range-starts" transition is handled lazily on every
   * read by `publicSalon.getProfile` (renders `onVacation` from the live
   * range) and on every booking attempt by the existing cron + ui paths,
   * so we don't need a scheduled task to flip it.
   */
  setVacation: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      // Both null = clear vacation. Otherwise both required.
      vacationFrom: z.number().int().nullable(),
      vacationUntil: z.number().int().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);

      const { vacationFrom, vacationUntil } = input;
      if ((vacationFrom == null) !== (vacationUntil == null)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "vacationFrom and vacationUntil must both be set or both be null",
        });
      }
      if (vacationFrom != null && vacationUntil != null) {
        if (vacationUntil < vacationFrom) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "vacationUntil must be on or after vacationFrom",
          });
        }
        // Hard cap of 2y to keep the column from being abused for indefinite hides
        // (that's what `salon.setMasterPublicHidden` is for).
        const MAX_RANGE = 2 * 365 * 24 * 60 * 60;
        if (vacationUntil - vacationFrom > MAX_RANGE) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Vacation range cannot exceed 2 years",
          });
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const onVacationNow =
        vacationFrom != null && vacationUntil != null
          ? (vacationFrom <= now && now <= vacationUntil ? 1 : 0)
          : 0;

      await ctx.db.update(masters)
        .set({
          vacationFrom: vacationFrom,
          vacationUntil: vacationUntil,
          onVacation: onVacationNow,
        })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));

      return { success: true, onVacation: onVacationNow === 1 };
    }),

  // ── Per-master client blocks (0062: clients overhaul) ──────────────────
  //
  // A master may hide specific clients from their own slot picker. The
  // block is one-sided: it does NOT cancel existing appointments, just
  // refuses future bookings of (this master × this client). Owners /
  // system_admin can manage blocks for any master in their tenant.

  /** Block a client for one master. */
  blockClient: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number().int(),
      clientChatId: z.number().int(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);

      // Verify the client actually exists in this tenant — prevents
      // accidental blocks against arbitrary chat IDs.
      const [client] = await ctx.db
        .select({ chatId: users.chatId })
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.clientChatId)))
        .limit(1);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "client_not_found" });
      }

      const blockedBy = ctx.webUser?.webRole === "master" ? input.masterId : input.masterId; // actor recorded as the master being affected — owner-overrides retain this for audit clarity
      const now = Math.floor(Date.now() / 1000);
      const reason = input.reason ? sanitizeText(input.reason, 500) : null;

      // INSERT-OR-IGNORE pattern via Drizzle `.onConflictDoNothing` —
      // double-block is a no-op, not an error.
      await ctx.db
        .insert(masterClientBlocks)
        .values({
          tenantId: input.tenantId,
          masterChatId: input.masterId,
          clientChatId: input.clientChatId,
          reason,
          blockedBy,
          blockedAt: now,
        })
        .onConflictDoNothing();
      return { ok: true };
    }),

  /** Unblock a client for one master. */
  unblockClient: masterProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number().int(),
      clientChatId: z.number().int(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      await ctx.db
        .delete(masterClientBlocks)
        .where(and(
          eq(masterClientBlocks.tenantId, input.tenantId),
          eq(masterClientBlocks.masterChatId, input.masterId),
          eq(masterClientBlocks.clientChatId, input.clientChatId),
        ));
      return { ok: true };
    }),

  /** List clients this master has blocked, with display names from `users`. */
  listMyBlockedClients: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const rows = await ctx.db
        .select({
          clientChatId: masterClientBlocks.clientChatId,
          reason: masterClientBlocks.reason,
          blockedAt: masterClientBlocks.blockedAt,
          clientName: users.name,
          clientPhone: users.phone,
        })
        .from(masterClientBlocks)
        .leftJoin(users, and(
          eq(users.tenantId, masterClientBlocks.tenantId),
          eq(users.chatId, masterClientBlocks.clientChatId),
        ))
        .where(and(
          eq(masterClientBlocks.tenantId, input.tenantId),
          eq(masterClientBlocks.masterChatId, input.masterId),
        ))
        .orderBy(desc(masterClientBlocks.blockedAt));
      return rows;
    }),

  // ═══════════════════════════════════════════════════════════════════
  //  0072 — TELEGRAM PAIRING (master self-service)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Return the master's current pairing state — primary `chatId`, the
   * paired `telegramChatId` (if any), the active pending code's expiry
   * (if any), and the bot username for the deep-link.
   *
   * Master role + `assertCallerIsMaster` IDOR guard (the master may only
   * read their OWN row). System-admin bypass for support escalation.
   */
  getMyPairingState: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      const [row] = await ctx.db
        .select({
          chatId: masters.chatId,
          telegramChatId: masters.telegramChatId,
          isSynthetic: masters.isSynthetic,
          archivedAt: masters.archivedAt,
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const now = Math.floor(Date.now() / 1000);
      const [active] = await ctx.db
        .select({ expiresAt: masterPairingCodes.expiresAt })
        .from(masterPairingCodes)
        .where(and(
          eq(masterPairingCodes.tenantId, input.tenantId),
          eq(masterPairingCodes.masterChatId, input.masterId),
          isNull(masterPairingCodes.consumedAt),
          gt(masterPairingCodes.expiresAt, now),
        ))
        .orderBy(desc(masterPairingCodes.createdAt))
        .limit(1);

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);

      return {
        chatId: row.chatId,
        telegramChatId: row.telegramChatId ?? null,
        isSynthetic: row.isSynthetic === 1,
        archived: row.archivedAt !== null,
        hasActiveCode: !!active,
        activeCodeExpiresAt: active?.expiresAt ?? null,
        botUsername: bot?.botUsername ?? null,
      };
    }),

  /**
   * Mint a fresh pairing token, persist its SHA-256 hash + 7-day TTL in
   * `master_pairing_codes`, and return the raw token + deep-link URL.
   *
   * The raw token leaves the server exactly once in this response and is
   * then irrecoverable (only `SHA-256(raw)` is stored). The Worker's
   * `/start mst_<raw>` consumer recomputes the hash, looks up the row,
   * binds `masters.telegram_chat_id`, and marks the code consumed.
   *
   * Authorization: master role on their OWN row only (IDOR-guarded). The
   * salon-owner-initiated mint lives at `salon.createMasterPairingCode`
   * with `assertTenantOwner`.
   */
  requestPairingCode: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (ctx.webUser.webRole !== "master" || ctx.webUser.tenantId !== input.tenantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the master themselves can request a pairing code",
        });
      }
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);

      const [row] = await ctx.db
        .select({ archivedAt: masters.archivedAt })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.archivedAt !== null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Master account is archived" });
      }

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);
      if (!bot?.botUsername) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Salon has no active Telegram bot — ask the salon to connect one",
        });
      }

      const { raw, hash } = await generatePairingToken();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + PAIRING_TOKEN_TTL_SEC;

      await ctx.db.insert(masterPairingCodes).values({
        tokenHash: hash,
        tenantId: input.tenantId,
        masterChatId: input.masterId,
        createdByWebUserId: ctx.webUser.id,
        createdAt: now,
        expiresAt,
      });

      return {
        deepLink: buildDeepLink(bot.botUsername, raw),
        expiresAt,
      };
    }),

  /**
   * Unbind a previously-paired Telegram account. Sets
   * `masters.telegram_chat_id = NULL`. Does NOT delete past pairing-code
   * rows (audit trail) and does NOT cancel pending unconsumed codes —
   * the master is free to re-mint and re-pair.
   *
   * Authorization: same as `requestPairingCode` — master, own row only.
   */
  unpairTelegram: masterProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (ctx.webUser.webRole !== "master" || ctx.webUser.tenantId !== input.tenantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the master themselves can unpair their Telegram",
        });
      }
      await assertCallerIsMaster(ctx, input.tenantId, input.masterId);
      await ctx.db
        .update(masters)
        .set({ telegramChatId: null })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),
});
