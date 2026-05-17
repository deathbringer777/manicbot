/**
 * pluginReminders router — CRUD + calendar feed for the Reminders plugin.
 *
 * Access model:
 *   - Reading is open to any tenant member who has the plugin enabled for
 *     their tenant (assertPluginEnabled guards every procedure).
 *   - `tenant_owner` / `tenant_manager` / `system_admin` can create / edit /
 *     archive any reminder in their tenant.
 *   - `master` can create / edit / archive only their OWN reminders
 *     (`created_by_web_user_id === ctx.webUser.id`). They can target
 *     themselves or null (owner). They cannot target other masters.
 *
 * Recurrence shape is validated by `validateRecurrence` (the same pure
 * helper used by the worker cron). Channels are restricted to
 * `inapp | telegram`.
 *
 * listForCalendar expands occurrences inside [from, to] so the day/week
 * calendar can render thin chips at the right slot — even for recurring
 * routines (one chip per fire time in the requested window).
 */

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, managerProcedure } from "~/server/api/trpc";
import { pluginReminders, pluginReminderFires } from "~/server/db/schema";
import { assertTenantMember } from "~/server/api/tenantAccess";
import { assertPluginEnabled } from "~/server/plugins/assertPluginEnabled";
import { validateRecurrence, expandOccurrences } from "~/lib/recurrence";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CHANNEL = z.enum(["inapp", "telegram"]);
const KIND = z.enum(["reminder", "routine"]);

const RECURRENCE = z.union([
  z.object({ type: z.literal("once") }),
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(TIME_RE),
    until: z.string().regex(DATE_RE).optional(),
  }),
  z.object({
    type: z.literal("weekly"),
    time: z.string().regex(TIME_RE),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1),
    until: z.string().regex(DATE_RE).optional(),
  }),
  z.object({
    type: z.literal("monthly_day"),
    time: z.string().regex(TIME_RE),
    dayOfMonth: z.number().int().min(1).max(28),
    until: z.string().regex(DATE_RE).optional(),
  }),
]);

const CREATE_INPUT = z.object({
  tenantId: z.string().min(1),
  kind: KIND.default("reminder"),
  title: z.string().min(1).max(120),
  note: z.string().max(500).optional().nullable(),
  startsOn: z.string().regex(DATE_RE),
  time: z.string().regex(TIME_RE),
  recurrence: RECURRENCE,
  targetMasterId: z.number().int().positive().nullable().optional(),
  channels: z.array(CHANNEL).min(1).max(2).default(["inapp"]),
});

const UPDATE_PATCH = z.object({
  kind: KIND.optional(),
  title: z.string().min(1).max(120).optional(),
  note: z.string().max(500).nullable().optional(),
  startsOn: z.string().regex(DATE_RE).optional(),
  time: z.string().regex(TIME_RE).optional(),
  recurrence: RECURRENCE.optional(),
  targetMasterId: z.number().int().positive().nullable().optional(),
  channels: z.array(CHANNEL).min(1).max(2).optional(),
});

function newReminderId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const raw =
    g.crypto?.randomUUID?.()?.replace(/-/g, "").slice(0, 16) ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `rm_${raw}`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Sanitize recurrence via the shared DSL helper. Throws on invalid input. */
function ensureValidRecurrence(rec: unknown) {
  try {
    return validateRecurrence(rec);
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: e instanceof Error ? e.message : "Invalid recurrence",
    });
  }
}

/**
 * For master-role callers, refuse to target a master other than themselves
 * (or null, meaning self/owner).
 */
async function enforceMasterScopeOnCreate(
  ctx: { webUser: { id: string; webRole: string } | null | undefined; db: unknown },
  input: { targetMasterId?: number | null },
): Promise<void> {
  if (ctx.webUser?.webRole !== "master") return;
  if (input.targetMasterId == null) return; // self
  // Look up the master's web_user_id via Drizzle. Cheap.
  const { masters } = await import("~/server/db/schema");
  const rows = await (ctx.db as {
    select: (fields: unknown) => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          limit: (n: number) => Promise<Array<{ webUserId: string | null }>>;
        };
      };
    };
  })
    .select({ webUserId: masters.webUserId })
    .from(masters)
    .where(eq(masters.chatId, input.targetMasterId))
    .limit(1);
  const ownerWebUserId = rows[0]?.webUserId;
  if (ownerWebUserId && ownerWebUserId === ctx.webUser?.id) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "master role can only target self",
  });
}

async function loadOwnReminderOrThrow(
  ctx: { webUser: { id: string; webRole: string } | null | undefined; db: unknown },
  tenantId: string,
  id: string,
) {
  const rows = await (ctx.db as {
    select: () => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          limit: (n: number) => Promise<Array<typeof pluginReminders.$inferSelect>>;
        };
      };
    };
  })
    .select()
    .from(pluginReminders)
    .where(
      and(
        eq(pluginReminders.id, id),
        eq(pluginReminders.tenantId, tenantId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (ctx.webUser?.webRole === "master" && row.createdByWebUserId !== ctx.webUser.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "master can only edit their own reminders",
    });
  }
  return row;
}

export const pluginRemindersRouter = createTRPCRouter({
  // -------------------------------------------------------------------
  // list — every active (non-archived) reminder for the tenant. Used by
  // the runtime panel; calendar uses listForCalendar instead.
  // -------------------------------------------------------------------
  list: managerProcedure
    .input(z.object({ tenantId: z.string().min(1), includeArchived: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      const conds: ReturnType<typeof eq>[] = [eq(pluginReminders.tenantId, input.tenantId)];
      const rows = await ctx.db
        .select()
        .from(pluginReminders)
        .where(and(...conds))
        .orderBy(desc(pluginReminders.createdAt));
      return input.includeArchived ? rows : rows.filter((r) => r.archivedAt === null);
    }),

  // -------------------------------------------------------------------
  // listForCalendar — expanded occurrence rows in the requested window.
  // -------------------------------------------------------------------
  listForCalendar: managerProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        from: z.string().regex(DATE_RE),
        to: z.string().regex(DATE_RE),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");

      const rows = await ctx.db
        .select()
        .from(pluginReminders)
        .where(eq(pluginReminders.tenantId, input.tenantId));

      const fromDate = new Date(`${input.from}T00:00:00.000Z`);
      const toDate = new Date(`${input.to}T23:59:59.999Z`);

      const occurrences: Array<{
        reminderId: string;
        kind: "reminder" | "routine";
        title: string;
        note: string | null;
        targetMasterId: number | null;
        firesAt: string; // ISO
        firesAtDate: string; // YYYY-MM-DD
        firesAtTime: string; // HH:MM
      }> = [];

      for (const r of rows) {
        if (r.archivedAt !== null) continue;
        let rec;
        try {
          rec = validateRecurrence(JSON.parse(r.recurrenceJson));
        } catch {
          continue;
        }
        let occs: Date[];
        try {
          if (rec.type === "once") {
            // Combine starts_on + time on the row.
            const tp = r.time.split(":").map((s) => Number(s));
            const dp = r.startsOn.split("-").map((s) => Number(s));
            const occ = new Date(Date.UTC(dp[0]!, dp[1]! - 1, dp[2]!, tp[0]!, tp[1]!));
            occs = occ >= fromDate && occ <= toDate ? [occ] : [];
          } else {
            occs = expandOccurrences(rec, r.startsOn, fromDate, toDate);
          }
        } catch {
          continue;
        }
        for (const occ of occs) {
          const iso = occ.toISOString();
          occurrences.push({
            reminderId: r.id,
            kind: r.kind as "reminder" | "routine",
            title: r.title,
            note: r.note,
            targetMasterId: r.targetMasterId,
            firesAt: iso,
            firesAtDate: iso.slice(0, 10),
            firesAtTime: iso.slice(11, 16),
          });
        }
      }
      return occurrences;
    }),

  // -------------------------------------------------------------------
  // get — single reminder by id.
  // -------------------------------------------------------------------
  get: managerProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      return loadOwnReminderOrThrow(ctx as never, input.tenantId, input.id);
    }),

  // -------------------------------------------------------------------
  // create — insert a new reminder.
  // -------------------------------------------------------------------
  create: managerProcedure
    .input(CREATE_INPUT)
    .mutation(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      const rec = ensureValidRecurrence(input.recurrence);
      await enforceMasterScopeOnCreate(ctx as never, input);

      const id = newReminderId();
      const t = nowSec();
      await ctx.db.insert(pluginReminders).values({
        id,
        tenantId: input.tenantId,
        createdByWebUserId: ctx.webUser!.id,
        targetMasterId: input.targetMasterId ?? null,
        kind: input.kind,
        title: input.title,
        note: input.note ?? null,
        startsOn: input.startsOn,
        time: input.time,
        recurrenceJson: JSON.stringify(rec),
        channelsJson: JSON.stringify(input.channels),
        archivedAt: null,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  // -------------------------------------------------------------------
  // update — patch fields on an existing reminder.
  // -------------------------------------------------------------------
  update: managerProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.string().min(1),
      patch: UPDATE_PATCH,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      const existing = await loadOwnReminderOrThrow(ctx as never, input.tenantId, input.id);

      const patch: Partial<typeof pluginReminders.$inferInsert> = { updatedAt: nowSec() };
      if (input.patch.kind !== undefined) patch.kind = input.patch.kind;
      if (input.patch.title !== undefined) patch.title = input.patch.title;
      if (input.patch.note !== undefined) patch.note = input.patch.note;
      if (input.patch.startsOn !== undefined) patch.startsOn = input.patch.startsOn;
      if (input.patch.time !== undefined) patch.time = input.patch.time;
      if (input.patch.recurrence !== undefined) {
        patch.recurrenceJson = JSON.stringify(ensureValidRecurrence(input.patch.recurrence));
      }
      if (input.patch.targetMasterId !== undefined) {
        await enforceMasterScopeOnCreate(ctx as never, { targetMasterId: input.patch.targetMasterId });
        patch.targetMasterId = input.patch.targetMasterId;
      }
      if (input.patch.channels !== undefined) patch.channelsJson = JSON.stringify(input.patch.channels);

      await ctx.db
        .update(pluginReminders)
        .set(patch)
        .where(eq(pluginReminders.id, existing.id));
      return { ok: true };
    }),

  // -------------------------------------------------------------------
  // archive — soft delete.
  // -------------------------------------------------------------------
  archive: managerProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      const existing = await loadOwnReminderOrThrow(ctx as never, input.tenantId, input.id);
      const t = nowSec();
      await ctx.db
        .update(pluginReminders)
        .set({ archivedAt: t, updatedAt: t })
        .where(eq(pluginReminders.id, existing.id));
      return { ok: true };
    }),

  // -------------------------------------------------------------------
  // unarchive — restore a soft-deleted reminder.
  // -------------------------------------------------------------------
  unarchive: managerProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      const existing = await loadOwnReminderOrThrow(ctx as never, input.tenantId, input.id);
      await ctx.db
        .update(pluginReminders)
        .set({ archivedAt: null, updatedAt: nowSec() })
        .where(eq(pluginReminders.id, existing.id));
      return { ok: true };
    }),

  // -------------------------------------------------------------------
  // getRecentFires — last N fire log rows for a reminder (detail panel).
  // -------------------------------------------------------------------
  getRecentFires: managerProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      reminderId: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantMember(ctx, input.tenantId);
      await assertPluginEnabled(ctx as never, "reminders");
      await loadOwnReminderOrThrow(ctx as never, input.tenantId, input.reminderId);
      const rows = await ctx.db
        .select()
        .from(pluginReminderFires)
        .where(eq(pluginReminderFires.reminderId, input.reminderId))
        .orderBy(desc(pluginReminderFires.firesAtEpoch))
        .limit(input.limit);
      return rows;
    }),
});
