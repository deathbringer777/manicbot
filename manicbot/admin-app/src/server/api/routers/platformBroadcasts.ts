/**
 * platformBroadcasts router (migration 0100) — God-Mode authoring surface for
 * operator → tenant scheduled / recurring / templated multi-channel messaging
 * (Маркетинг → Рассылки). EVERY procedure is `systemAdminProcedure`: this is a
 * cross-tenant platform tool, never reachable by tenant users.
 *
 * The admin-app only AUTHORS + CONFIGS (writes platform_campaigns /
 * platform_message_templates rows), PREVIEWS the audience, and reads the
 * delivery history. Actual delivery + scheduling runs in the Worker cron
 * (phasePlatformCampaigns) off the same rows.
 *
 * monthly_report + subscription_reminder are singleton rows (deterministic
 * ids) edited via the settings procedures; announcements are free CRUD.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { createTRPCRouter, systemAdminProcedure } from "~/server/api/trpc";
import {
  platformCampaigns,
  platformCampaignDeliveries,
  platformMessageTemplates,
} from "~/server/db/schema";
import { ulid } from "~/lib/ulid";
import { sanitizeText, sanitizeHtml } from "~/server/security/sanitize";
import {
  AUDIENCE_FILTER,
  resolveAudience,
  PREVIEW_SAMPLE_SIZE,
  BROADCAST_MAX_RECIPIENTS,
} from "~/server/api/routers/platformMessenger";

// ─── Constants ──────────────────────────────────────────────────────────

const SYS_MONTHLY_REPORT = "sys_monthly_report";
const SYS_SUBSCRIPTION_REMINDER = "sys_subscription_reminder";
const SYS_WELCOME = "sys_welcome";
const WELCOME_DEFAULT_TITLE = "Добро пожаловать в ManicBot 👋";
const NOW_GRACE_SEC = 60; // a 'once' campaign must be at least this far in the future

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function rid(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

// ─── Validation ───────────────────────────────────────────────────────────

const CHANNEL = z.enum(["center", "bell", "telegram", "email"]);

// `center` (the ManicBot message-center channel) is always-on — enforced here
// so a client can never persist a campaign that bypasses the channel of record.
const CHANNELS = z
  .array(CHANNEL)
  .min(1)
  .refine((cs) => cs.includes("center"), { message: "center_channel_required" })
  .transform((cs) => Array.from(new Set(cs)));

const EMAIL_BODY = z.object({
  subject: z.string().min(1).max(300),
  html: z.string().min(1).max(40000),
});

const BODIES = z.object({
  center: z.string().max(4000).optional(),
  bell: z.string().max(2000).optional(),
  telegram: z.string().max(4000).optional(),
  email: EMAIL_BODY.optional(),
});

const RECURRENCE = z.discriminatedUnion("freq", [
  z.object({
    freq: z.literal("daily"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
  }),
  z.object({
    freq: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
  }),
  z.object({
    freq: z.literal("monthly"),
    day: z.number().int().min(1).max(28),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
  }),
]);

const SCHEDULE = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("now") }),
  z.object({ kind: z.literal("once"), scheduledAt: z.number().int().positive() }),
  z.object({ kind: z.literal("recurring"), recurrence: RECURRENCE }),
]);

type ScheduleInput = z.infer<typeof SCHEDULE>;
type BodiesInput = z.infer<typeof BODIES>;

interface SanitizedBodies {
  center?: string;
  bell?: string;
  telegram?: string;
  email?: { subject: string; html: string };
}

function sanitizeBodies(bodies: BodiesInput): SanitizedBodies {
  const out: SanitizedBodies = {};
  if (bodies.center != null) out.center = sanitizeText(bodies.center, 4000);
  if (bodies.bell != null) out.bell = sanitizeText(bodies.bell, 2000);
  if (bodies.telegram != null) out.telegram = sanitizeText(bodies.telegram, 4000);
  if (bodies.email) {
    out.email = {
      subject: sanitizeText(bodies.email.subject, 300),
      html: sanitizeHtml(bodies.email.html, "marketingHtml"),
    };
  }
  return out;
}

interface ScheduleResult {
  scheduleKind: ScheduleInput["kind"];
  status: "active" | "scheduled";
  scheduledAt: number | null;
  recurrenceJson: string | null;
  nextRunAt: number | null;
}

function computeSchedule(schedule: ScheduleInput): ScheduleResult {
  const t = now();
  if (schedule.kind === "now") {
    return { scheduleKind: "now", status: "active", scheduledAt: null, recurrenceJson: null, nextRunAt: t };
  }
  if (schedule.kind === "once") {
    if (schedule.scheduledAt <= t + NOW_GRACE_SEC) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "scheduled_at_in_past" });
    }
    return {
      scheduleKind: "once", status: "scheduled", scheduledAt: schedule.scheduledAt,
      recurrenceJson: null, nextRunAt: schedule.scheduledAt,
    };
  }
  // recurring — next_run_at stays NULL so every cron tick re-scans; the due
  // engine + delivery ledger decide the exact firing.
  return {
    scheduleKind: "recurring", status: "active", scheduledAt: null,
    recurrenceJson: JSON.stringify(schedule.recurrence), nextRunAt: null,
  };
}

function parseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObj(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── Router ─────────────────────────────────────────────────────────────

export const platformBroadcastsRouter = createTRPCRouter({
  // ═══ Announcement campaigns (free CRUD) ═══

  campaignList: systemAdminProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds = [eq(platformCampaigns.kind, "announcement")];
      if (input.status) conds.push(eq(platformCampaigns.status, input.status));
      const rows = await ctx.db
        .select()
        .from(platformCampaigns)
        .where(and(...conds))
        .orderBy(desc(platformCampaigns.updatedAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),

  campaignGet: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(platformCampaigns)
        .where(eq(platformCampaigns.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  campaignCreate: systemAdminProcedure
    .input(
      z.object({
        title: z.string().max(200).optional(),
        bodies: BODIES,
        audience: AUDIENCE_FILTER,
        channels: CHANNELS,
        schedule: SCHEDULE,
        templateId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bodies = sanitizeBodies(input.bodies);
      if (!bodies.center) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "center_body_required" });
      }
      const sched = computeSchedule(input.schedule);
      const id = rid("pcamp");
      const t = now();
      await ctx.db.insert(platformCampaigns).values({
        id,
        kind: "announcement",
        title: input.title ? sanitizeText(input.title, 200) : null,
        body: bodies.center,
        bodiesJson: JSON.stringify(bodies),
        audienceFilterJson: JSON.stringify(input.audience),
        channelsJson: JSON.stringify(input.channels),
        scheduleKind: sched.scheduleKind,
        scheduledAt: sched.scheduledAt,
        recurrenceJson: sched.recurrenceJson,
        templateId: input.templateId ?? null,
        status: sched.status,
        nextRunAt: sched.nextRunAt,
        lastRunAt: null,
        createdBy: ctx.webUser!.id,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  campaignUpdate: systemAdminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().max(200).optional(),
        bodies: BODIES.optional(),
        audience: AUDIENCE_FILTER.optional(),
        channels: CHANNELS.optional(),
        schedule: SCHEDULE.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.title !== undefined) patch.title = sanitizeText(input.title, 200);
      if (input.bodies) {
        const b = sanitizeBodies(input.bodies);
        patch.bodiesJson = JSON.stringify(b);
        if (b.center) patch.body = b.center;
      }
      if (input.audience) patch.audienceFilterJson = JSON.stringify(input.audience);
      if (input.channels) patch.channelsJson = JSON.stringify(input.channels);
      if (input.schedule) {
        const sched = computeSchedule(input.schedule);
        patch.scheduleKind = sched.scheduleKind;
        patch.status = sched.status;
        patch.scheduledAt = sched.scheduledAt;
        patch.recurrenceJson = sched.recurrenceJson;
        patch.nextRunAt = sched.nextRunAt;
      }
      await ctx.db.update(platformCampaigns).set(patch).where(eq(platformCampaigns.id, input.id));
      return { ok: true };
    }),

  campaignDelete: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Belt-and-suspenders: drop deliveries explicitly (FK cascade may be off
      // depending on D1 pragma) then the campaign.
      await ctx.db.delete(platformCampaignDeliveries).where(eq(platformCampaignDeliveries.campaignId, input.id));
      await ctx.db.delete(platformCampaigns).where(eq(platformCampaigns.id, input.id));
      return { ok: true };
    }),

  campaignPause: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(platformCampaigns)
        .set({ status: "paused", updatedAt: now() })
        .where(eq(platformCampaigns.id, input.id));
      return { ok: true };
    }),

  campaignResume: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(platformCampaigns)
        .set({ status: "active", updatedAt: now() })
        .where(eq(platformCampaigns.id, input.id));
      return { ok: true };
    }),

  // Activate + schedule for the next cron tick. Delivery happens in the Worker
  // cron (≤ one tick); the ledger keeps endpoint + cron from double-sending.
  campaignSendNow: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(platformCampaigns)
        .where(eq(platformCampaigns.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .update(platformCampaigns)
        .set({ status: "active", nextRunAt: now(), updatedAt: now() })
        .where(eq(platformCampaigns.id, input.id));
      return { ok: true, id: input.id, triggered: false };
    }),

  previewAudience: systemAdminProcedure
    .input(z.object({ audience: AUDIENCE_FILTER }))
    .query(async ({ ctx, input }) => {
      const recipients = await resolveAudience(ctx.db, input.audience);
      return {
        count: recipients.length,
        sample: recipients.slice(0, PREVIEW_SAMPLE_SIZE).map((r) => ({
          id: r.id, email: r.email, name: r.name, tenantId: r.tenantId, plan: r.plan,
        })),
        capped: recipients.length >= BROADCAST_MAX_RECIPIENTS,
      };
    }),

  deliveriesList: systemAdminProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(platformCampaignDeliveries)
        .where(eq(platformCampaignDeliveries.campaignId, input.campaignId))
        .orderBy(desc(platformCampaignDeliveries.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),

  // ═══ Singleton automation settings ═══

  getMonthlyReportSettings: systemAdminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(platformCampaigns)
      .where(eq(platformCampaigns.id, SYS_MONTHLY_REPORT))
      .limit(1);
    const rec = parseJsonObj(row?.recurrenceJson ?? null);
    return {
      enabled: row?.status === "active",
      channels: parseJsonArray(row?.channelsJson ?? null),
      atHour: typeof rec.hour === "number" ? rec.hour : 7,
      atMinute: typeof rec.minute === "number" ? rec.minute : 0,
      templateId: row?.templateId ?? null,
    };
  }),

  setMonthlyReportSettings: systemAdminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        channels: CHANNELS,
        atHour: z.number().int().min(0).max(23).default(7),
        atMinute: z.number().int().min(0).max(59).default(0),
        templateId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = now();
      const recurrenceJson = JSON.stringify({ freq: "monthly", day: 1, hour: input.atHour, minute: input.atMinute });
      await ctx.db
        .insert(platformCampaigns)
        .values({
          id: SYS_MONTHLY_REPORT,
          kind: "monthly_report",
          title: "Monthly statistics report",
          channelsJson: JSON.stringify(input.channels),
          scheduleKind: "recurring",
          recurrenceJson,
          templateId: input.templateId ?? null,
          status: input.enabled ? "active" : "paused",
          createdAt: t,
          updatedAt: t,
        })
        .onConflictDoUpdate({
          target: platformCampaigns.id,
          set: {
            channelsJson: JSON.stringify(input.channels),
            recurrenceJson,
            templateId: input.templateId ?? null,
            status: input.enabled ? "active" : "paused",
            updatedAt: t,
          },
        });
      return { ok: true };
    }),

  getSubscriptionReminderSettings: systemAdminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(platformCampaigns)
      .where(eq(platformCampaigns.id, SYS_SUBSCRIPTION_REMINDER))
      .limit(1);
    const rec = parseJsonObj(row?.recurrenceJson ?? null);
    return {
      enabled: row?.status === "active",
      channels: parseJsonArray(row?.channelsJson ?? null),
      daysBefore: typeof rec.daysBefore === "number" ? rec.daysBefore : 3,
      atHour: typeof rec.hour === "number" ? rec.hour : 9,
      templateId: row?.templateId ?? null,
    };
  }),

  setSubscriptionReminderSettings: systemAdminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        channels: CHANNELS,
        daysBefore: z.number().int().min(1).max(30).default(3),
        atHour: z.number().int().min(0).max(23).default(9),
        templateId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = now();
      const recurrenceJson = JSON.stringify({ freq: "daily", hour: input.atHour, minute: 0, daysBefore: input.daysBefore });
      await ctx.db
        .insert(platformCampaigns)
        .values({
          id: SYS_SUBSCRIPTION_REMINDER,
          kind: "subscription_reminder",
          title: "Subscription renewal reminder",
          channelsJson: JSON.stringify(input.channels),
          scheduleKind: "recurring",
          recurrenceJson,
          templateId: input.templateId ?? null,
          status: input.enabled ? "active" : "paused",
          createdAt: t,
          updatedAt: t,
        })
        .onConflictDoUpdate({
          target: platformCampaigns.id,
          set: {
            channelsJson: JSON.stringify(input.channels),
            recurrenceJson,
            templateId: input.templateId ?? null,
            status: input.enabled ? "active" : "paused",
            updatedAt: t,
          },
        });
      return { ok: true };
    }),

  // ═══ Welcome message (sys_welcome singleton — fires on registration + cron backfill) ═══

  getWelcomeSettings: systemAdminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(platformCampaigns)
      .where(eq(platformCampaigns.id, SYS_WELCOME))
      .limit(1);
    const bodies = parseJsonObj(row?.bodiesJson ?? null);
    return {
      enabled: row?.status === "active",
      channels: parseJsonArray(row?.channelsJson ?? null),
      title: row?.title ?? WELCOME_DEFAULT_TITLE,
      body: typeof bodies.center === "string" ? bodies.center : (row?.body ?? ""),
    };
  }),

  setWelcomeSettings: systemAdminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        channels: CHANNELS,
        title: z.string().max(200).optional(),
        body: z.string().min(1, "body_required").max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = now();
      const title = (input.title ?? "").trim() || WELCOME_DEFAULT_TITLE;
      // Tokens ({salon_name} etc.) survive sanitizeText (stripHtml only); they
      // are substituted at delivery by platformCampaignVars / welcomeOnRegister.
      const body = sanitizeText(input.body, 4000);
      const bodiesJson = JSON.stringify(sanitizeBodies({ center: input.body }));
      await ctx.db
        .insert(platformCampaigns)
        .values({
          id: SYS_WELCOME,
          kind: "welcome",
          title,
          body,
          bodiesJson,
          channelsJson: JSON.stringify(input.channels),
          scheduleKind: "now",
          status: input.enabled ? "active" : "paused",
          createdAt: t,
          updatedAt: t,
        })
        .onConflictDoUpdate({
          target: platformCampaigns.id,
          set: {
            title,
            body,
            bodiesJson,
            channelsJson: JSON.stringify(input.channels),
            status: input.enabled ? "active" : "paused",
            updatedAt: t,
          },
        });
      return { ok: true };
    }),

  // ═══ Template library ═══

  templateList: systemAdminProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          status: z.enum(["draft", "approved", "archived"]).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds = [];
      if (input.category) conds.push(eq(platformMessageTemplates.category, input.category));
      if (input.status) conds.push(eq(platformMessageTemplates.status, input.status));
      const rows = await ctx.db
        .select()
        .from(platformMessageTemplates)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(platformMessageTemplates.updatedAt));
      return rows;
    }),

  templateGet: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(platformMessageTemplates)
        .where(eq(platformMessageTemplates.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  templateCreate: systemAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        category: z.string().max(60).optional(),
        channels: CHANNELS,
        bodies: BODIES,
        locale: z.string().max(8).default("ru"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = rid("pmt");
      const t = now();
      await ctx.db.insert(platformMessageTemplates).values({
        id,
        name: sanitizeText(input.name, 120),
        category: input.category ?? null,
        channelsJson: JSON.stringify(input.channels),
        bodiesJson: JSON.stringify(sanitizeBodies(input.bodies)),
        locale: input.locale,
        isBuiltin: 0,
        createdBy: ctx.webUser!.id,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  templateUpdate: systemAdminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        category: z.string().max(60).optional(),
        channels: CHANNELS.optional(),
        bodies: BODIES.optional(),
        locale: z.string().max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(platformMessageTemplates)
        .where(eq(platformMessageTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isBuiltin === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "builtin_readonly" });
      }
      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = sanitizeText(input.name, 120);
      if (input.category !== undefined) patch.category = input.category;
      if (input.channels) patch.channelsJson = JSON.stringify(input.channels);
      if (input.bodies) patch.bodiesJson = JSON.stringify(sanitizeBodies(input.bodies));
      if (input.locale) patch.locale = input.locale;
      await ctx.db.update(platformMessageTemplates).set(patch).where(eq(platformMessageTemplates.id, input.id));
      return { ok: true };
    }),

  templateDelete: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(platformMessageTemplates)
        .where(eq(platformMessageTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isBuiltin === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "builtin_readonly" });
      }
      await ctx.db.delete(platformMessageTemplates).where(eq(platformMessageTemplates.id, input.id));
      return { ok: true };
    }),

  // Approve a draft template → 'approved'. 'approved' is the state the Worker
  // reactive engine requires before it will deliver a keyed template. Built-in
  // rows are read-only (mirrors the templateUpdate/templateDelete guard).
  templateApprove: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(platformMessageTemplates)
        .where(eq(platformMessageTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isBuiltin === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "builtin_readonly" });
      }
      await ctx.db
        .update(platformMessageTemplates)
        .set({ status: "approved", updatedAt: now() })
        .where(eq(platformMessageTemplates.id, input.id));
      return { ok: true };
    }),

  // Archive a template → 'archived' (removed from the deliverable pool). Same
  // built-in read-only guard as approve/update/delete.
  templateArchive: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(platformMessageTemplates)
        .where(eq(platformMessageTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isBuiltin === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "builtin_readonly" });
      }
      await ctx.db
        .update(platformMessageTemplates)
        .set({ status: "archived", updatedAt: now() })
        .where(eq(platformMessageTemplates.id, input.id));
      return { ok: true };
    }),

  // ═══ Seasonal content plan (ThinkPad-generated occasion drafts) ═══

  // platform_campaigns rows tagged with an occasion_key are seasonal drafts
  // generated by the ThinkPad holidays pipeline, awaiting operator review.
  contentPlanList: systemAdminProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds = [isNotNull(platformCampaigns.occasionKey)];
      if (input.status) conds.push(eq(platformCampaigns.status, input.status));
      const rows = await ctx.db
        .select()
        .from(platformCampaigns)
        .where(and(...conds))
        .orderBy(desc(platformCampaigns.scheduledAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),

  // Approve a seasonal draft → 'active' so the cron picks it up at its slot.
  contentPlanApprove: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(platformCampaigns)
        .set({ status: "active", updatedAt: now() })
        .where(eq(platformCampaigns.id, input.id));
      return { ok: true };
    }),

  // Skip a seasonal draft → 'done' so it is excluded without being deleted.
  contentPlanSkip: systemAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(platformCampaigns)
        .set({ status: "done", updatedAt: now() })
        .where(eq(platformCampaigns.id, input.id));
      return { ok: true };
    }),
});
