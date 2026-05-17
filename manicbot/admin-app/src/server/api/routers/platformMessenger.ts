/**
 * Platform messenger router (migration 0076).
 *
 * Cross-tenant DM channel between the platform (any system_admin) and one
 * web_user (typically tenant_owner). Independent from the 0067 tenant-scoped
 * messenger — see migration header for the architectural reasoning.
 *
 * Surface split:
 *   • Owner-side procedures use `protectedProcedure` and scope EVERY query
 *     by `ctx.webUser.id`. An owner can never read or write another owner's
 *     platform_threads row even by guessing its id.
 *   • Sysadmin-side procedures use `systemAdminProcedure` and accept the
 *     target `recipientWebUserId` as explicit input.
 *
 * Notification fan-out:
 *   • Every `sendDirectMessage` / `broadcast` writes a `platform.message`
 *     row into `user_notifications` for the recipient so the bell lights up.
 *   • Every `sendMyReply` (owner → platform) writes a `platform.reply` row
 *     into `user_notifications` for EVERY system_admin so on-call sees it.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";

import {
  createTRPCRouter,
  protectedProcedure,
  systemAdminProcedure,
} from "~/server/api/trpc";
import {
  platformThreads,
  platformThreadMessages,
  platformBroadcasts,
  webUsers,
  tenants,
} from "~/server/db/schema";
import { ulid } from "~/lib/ulid";
import { sanitizeText } from "~/server/security/sanitize";
import {
  notifyWebUser,
  notifyManyWebUsers,
} from "~/server/services/notifyWebUser";

// ─── Constants ──────────────────────────────────────────────────────────

const MESSAGE_BODY_MAX = 4000;
const TITLE_MAX = 200;
const PREVIEW_MAX = 200;
const BROADCAST_MAX_RECIPIENTS = 10000;
const PREVIEW_SAMPLE_SIZE = 10;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function makePreview(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_MAX ? oneLine.slice(0, PREVIEW_MAX) : oneLine;
}

// ─── Validation ─────────────────────────────────────────────────────────

const PLAN = z.enum(["start", "pro", "max"]);
const BILLING_STATUS = z.enum(["trialing", "active", "grace", "expired"]);

const AUDIENCE_FILTER = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("by_plan"), plans: z.array(PLAN).min(1) }),
  z.object({
    scope: z.literal("by_billing_status"),
    statuses: z.array(BILLING_STATUS).min(1),
  }),
]);

type AudienceFilter = z.infer<typeof AUDIENCE_FILTER>;

// ─── Helpers ────────────────────────────────────────────────────────────

interface AudienceRecipient {
  id: string;
  email: string | null;
  name: string | null;
  tenantId: string | null;
  plan: string | null;
}

/**
 * Resolve the set of recipients matching an audience filter.
 *
 * Recipients are `web_users` rows joined against `tenants` (so plan /
 * billing_status filters work). We always exclude system_admin / support /
 * technical_support roles — the platform messenger is for talking to salon
 * users, not platform staff.
 */
async function resolveAudience(
  db: any,
  audience: AudienceFilter,
): Promise<AudienceRecipient[]> {
  const conds = [
    inArray(webUsers.role, ["tenant_owner", "tenant_manager", "master"]),
    eq(webUsers.emailVerified, 1),
  ];

  if (audience.scope === "by_plan") {
    // Only owners whose tenant is on one of the selected plans
    const matchingTenants = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(inArray(tenants.plan, audience.plans));
    const ids = matchingTenants.map((t: { id: string }) => t.id);
    if (ids.length === 0) return [];
    conds.push(inArray(webUsers.tenantId, ids));
  }

  if (audience.scope === "by_billing_status") {
    const matchingTenants = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(inArray(tenants.billingStatus, audience.statuses));
    const ids = matchingTenants.map((t: { id: string }) => t.id);
    if (ids.length === 0) return [];
    conds.push(inArray(webUsers.tenantId, ids));
  }

  const rows = await db
    .select({
      id: webUsers.id,
      email: webUsers.email,
      name: webUsers.name,
      tenantId: webUsers.tenantId,
      plan: tenants.plan,
    })
    .from(webUsers)
    .leftJoin(tenants, eq(webUsers.tenantId, tenants.id))
    .where(and(...conds));

  return rows.slice(0, BROADCAST_MAX_RECIPIENTS) as AudienceRecipient[];
}

/**
 * Owner-side single-thread resolver. Returns the row or `null` — never
 * throws on miss (first-time recipients have no row yet).
 */
async function findOwnThread(db: any, webUserId: string) {
  const rows = await db
    .select()
    .from(platformThreads)
    .where(eq(platformThreads.recipientWebUserId, webUserId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get-or-create the platform_threads row for `recipientWebUserId`. Caller
 * pre-validates that the recipient is a legitimate web_user.
 */
async function ensureThread(
  db: any,
  recipientWebUserId: string,
  recipientTenantId: string | null,
): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: platformThreads.id })
    .from(platformThreads)
    .where(eq(platformThreads.recipientWebUserId, recipientWebUserId))
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };

  const id = `pt_${ulid()}`;
  const now = nowSec();
  try {
    await db.insert(platformThreads).values({
      id,
      recipientWebUserId,
      recipientTenantId,
      lastMessageAt: null,
      lastMessagePreview: null,
      lastSenderKind: null,
      recipientLastReadAt: null,
      platformLastReadAt: null,
      archived: 0,
      createdAt: now,
    });
    return { id, created: true };
  } catch {
    // Race — partial UNIQUE on recipient_web_user_id fired.
    const raced = await db
      .select({ id: platformThreads.id })
      .from(platformThreads)
      .where(eq(platformThreads.recipientWebUserId, recipientWebUserId))
      .limit(1);
    if (raced[0]) return { id: raced[0].id, created: false };
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create platform thread",
    });
  }
}

/**
 * Look up every system_admin web_user id — used to fan out owner-reply
 * notifications. Cheap query (system_admins are rare).
 */
async function listSystemAdminIds(db: any): Promise<string[]> {
  const rows = await db
    .select({ id: webUsers.id })
    .from(webUsers)
    .where(eq(webUsers.role, "system_admin"));
  return rows.map((r: { id: string }) => r.id);
}

// ─── Router ─────────────────────────────────────────────────────────────

export const platformMessengerRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════════
  //  OWNER SIDE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Read the caller's own platform thread (or empty state when none yet).
   *
   * Scoped by ctx.webUser.id — there is no way for owner A to fetch owner
   * B's thread even by guessing an id. Returns first page of messages
   * (newest first, descending ULID cursor).
   */
  getMyThread: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const webUserId = ctx.webUser!.id;
      const thread = await findOwnThread(ctx.db, webUserId);
      if (!thread) {
        return { thread: null, messages: [], unreadCount: 0, nextCursor: undefined };
      }

      const msgConds = [eq(platformThreadMessages.threadId, thread.id)];
      if (input?.cursor) {
        msgConds.push(lt(platformThreadMessages.id, input.cursor));
      }
      const messages = await ctx.db
        .select()
        .from(platformThreadMessages)
        .where(and(...msgConds))
        .orderBy(desc(platformThreadMessages.id))
        .limit(limit);

      const unreadCount = messages.filter(
        (m: typeof messages[number]) =>
          m.senderKind === "platform" &&
          (thread.recipientLastReadAt == null || m.createdAt > thread.recipientLastReadAt),
      ).length;

      const nextCursor =
        messages.length === limit ? messages[messages.length - 1]?.id : undefined;

      return {
        thread,
        messages: messages.reverse(),
        unreadCount,
        nextCursor,
      };
    }),

  /**
   * Owner marks their thread as read up to "now". Idempotent — no-op when
   * the thread doesn't exist yet.
   */
  markMyThreadRead: protectedProcedure.mutation(async ({ ctx }) => {
    const webUserId = ctx.webUser!.id;
    const thread = await findOwnThread(ctx.db, webUserId);
    if (!thread) return { ok: true };
    await ctx.db
      .update(platformThreads)
      .set({ recipientLastReadAt: nowSec() })
      .where(eq(platformThreads.id, thread.id));
    return { ok: true };
  }),

  /**
   * Owner sends a reply (or initiates the conversation if no thread yet).
   * Fan-out: writes `platform.reply` notification for every system_admin.
   */
  sendMyReply: protectedProcedure
    .input(z.object({ body: z.string().min(1).max(MESSAGE_BODY_MAX) }))
    .mutation(async ({ ctx, input }) => {
      const webUserId = ctx.webUser!.id;
      const body = sanitizeText(input.body).trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });
      }

      const { id: threadId } = await ensureThread(
        ctx.db,
        webUserId,
        ctx.webUser!.tenantId ?? null,
      );

      const messageId = ulid();
      const now = nowSec();
      const preview = makePreview(body);

      await ctx.db.insert(platformThreadMessages).values({
        id: messageId,
        threadId,
        senderKind: "owner",
        senderWebUserId: webUserId,
        body,
        attachmentsJson: null,
        broadcastId: null,
        createdAt: now,
      });

      await ctx.db
        .update(platformThreads)
        .set({
          lastMessageAt: now,
          lastMessagePreview: preview,
          lastSenderKind: "owner",
          // Owner's own message auto-counts as read by owner.
          recipientLastReadAt: now,
        })
        .where(eq(platformThreads.id, threadId));

      // Fan-out to every system_admin's bell. Best-effort — notify failures
      // never break the actual send.
      const adminIds = await listSystemAdminIds(ctx.db);
      if (adminIds.length) {
        await notifyManyWebUsers(ctx.db, adminIds, {
          kind: "platform.reply",
          title: ctx.webUser!.email ?? "Salon owner replied",
          body: preview,
          link: `/messages?platformThread=${threadId}`,
          sourceSlug: "platform_messenger",
          sourceId: `${threadId}:${messageId}`,
        });
      }

      return { id: messageId, threadId, createdAt: now };
    }),

  // ═══════════════════════════════════════════════════════════════════
  //  SYSADMIN SIDE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * List all platform threads (sysadmin inbox).
   *
   * Supports search by recipient name/email + filter by archived. Returns
   * unread count (messages from owner that the platform hasn't read).
   */
  listThreads: systemAdminProcedure
    .input(
      z
        .object({
          archived: z.boolean().default(false),
          unreadOnly: z.boolean().optional(),
          cursor: z.number().int().optional(),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .default({ archived: false }),
    )
    .query(async ({ ctx, input }) => {
      const conds = [eq(platformThreads.archived, input.archived ? 1 : 0)];
      if (input.cursor !== undefined) {
        conds.push(lt(platformThreads.lastMessageAt, input.cursor));
      }

      const rows = await ctx.db
        .select()
        .from(platformThreads)
        .where(and(...conds))
        .orderBy(desc(platformThreads.lastMessageAt), desc(platformThreads.createdAt))
        .limit(input.limit);

      if (rows.length === 0) {
        return { items: [], nextCursor: undefined as number | undefined };
      }

      // Enrich with recipient name / email — one round-trip.
      const recipientIds = rows.map((r: typeof rows[number]) => r.recipientWebUserId);
      const users = await ctx.db
        .select({
          id: webUsers.id,
          email: webUsers.email,
          name: webUsers.name,
          tenantId: webUsers.tenantId,
        })
        .from(webUsers)
        .where(inArray(webUsers.id, recipientIds));
      const byId = new Map<string, { email: string; name: string | null; tenantId: string | null }>();
      for (const u of users) {
        byId.set(u.id, { email: u.email, name: u.name, tenantId: u.tenantId });
      }

      const items = rows.map((r: typeof rows[number]) => {
        const u = byId.get(r.recipientWebUserId);
        const lastTs = r.lastMessageAt ?? 0;
        const unread =
          r.lastSenderKind === "owner" &&
          (r.platformLastReadAt == null || lastTs > r.platformLastReadAt)
            ? 1
            : 0;
        return {
          ...r,
          recipientName: u?.name ?? null,
          recipientEmail: u?.email ?? null,
          recipientTenantId: u?.tenantId ?? r.recipientTenantId ?? null,
          unread,
        };
      });

      const filtered = input.unreadOnly ? items.filter((i: typeof items[number]) => i.unread) : items;

      const nextCursor =
        rows.length === input.limit ? rows[rows.length - 1]?.lastMessageAt ?? undefined : undefined;

      return { items: filtered, nextCursor };
    }),

  /**
   * Sysadmin reads a single thread and its message page. The id may belong
   * to any owner — sysadmin has full cross-tenant read access here.
   */
  getThread: systemAdminProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [thread] = await ctx.db
        .select()
        .from(platformThreads)
        .where(eq(platformThreads.id, input.threadId))
        .limit(1);
      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      const conds = [eq(platformThreadMessages.threadId, input.threadId)];
      if (input.cursor) conds.push(lt(platformThreadMessages.id, input.cursor));
      const messages = await ctx.db
        .select()
        .from(platformThreadMessages)
        .where(and(...conds))
        .orderBy(desc(platformThreadMessages.id))
        .limit(input.limit);

      const [recipient] = await ctx.db
        .select({
          id: webUsers.id,
          email: webUsers.email,
          name: webUsers.name,
          tenantId: webUsers.tenantId,
        })
        .from(webUsers)
        .where(eq(webUsers.id, thread.recipientWebUserId))
        .limit(1);

      const nextCursor =
        messages.length === input.limit ? messages[messages.length - 1]?.id : undefined;

      return {
        thread,
        recipient: recipient ?? null,
        messages: messages.reverse(),
        nextCursor,
      };
    }),

  /**
   * Sysadmin marks a specific platform thread as read on the platform side.
   * Bumps `platform_last_read_at`. Idempotent.
   */
  markThreadReadAsPlatform: systemAdminProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [thread] = await ctx.db
        .select({ id: platformThreads.id })
        .from(platformThreads)
        .where(eq(platformThreads.id, input.threadId))
        .limit(1);
      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .update(platformThreads)
        .set({ platformLastReadAt: nowSec() })
        .where(eq(platformThreads.id, input.threadId));
      return { ok: true };
    }),

  /**
   * Sysadmin sends a 1:1 message to a specific recipient. Creates the
   * thread if it doesn't exist yet. Recipient must be a legitimate
   * web_user (tenant_owner / tenant_manager / master).
   */
  sendDirectMessage: systemAdminProcedure
    .input(
      z.object({
        recipientWebUserId: z.string().min(1),
        body: z.string().min(1).max(MESSAGE_BODY_MAX),
        title: z.string().max(TITLE_MAX).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = sanitizeText(input.body).trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });
      }

      const [recipient] = await ctx.db
        .select({
          id: webUsers.id,
          email: webUsers.email,
          tenantId: webUsers.tenantId,
          role: webUsers.role,
        })
        .from(webUsers)
        .where(eq(webUsers.id, input.recipientWebUserId))
        .limit(1);
      if (!recipient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recipient not found" });
      }
      if (
        recipient.role !== "tenant_owner" &&
        recipient.role !== "tenant_manager" &&
        recipient.role !== "master"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Recipient must be a salon user (tenant_owner / tenant_manager / master)",
        });
      }

      const { id: threadId } = await ensureThread(
        ctx.db,
        recipient.id,
        recipient.tenantId ?? null,
      );

      const messageId = ulid();
      const now = nowSec();
      const preview = makePreview(body);

      await ctx.db.insert(platformThreadMessages).values({
        id: messageId,
        threadId,
        senderKind: "platform",
        senderWebUserId: ctx.webUser!.id,
        body,
        attachmentsJson: null,
        broadcastId: null,
        createdAt: now,
      });

      await ctx.db
        .update(platformThreads)
        .set({
          lastMessageAt: now,
          lastMessagePreview: preview,
          lastSenderKind: "platform",
          platformLastReadAt: now,
        })
        .where(eq(platformThreads.id, threadId));

      // Recipient bell notification.
      await notifyWebUser(ctx.db, {
        webUserId: recipient.id,
        kind: "platform.message",
        title: input.title?.trim() || "Сообщение от ManicBot",
        body: preview,
        link: "/messages?platform=1",
        tenantId: recipient.tenantId ?? null,
        sourceSlug: "platform_messenger",
        sourceId: `${threadId}:${messageId}`,
      });

      return { id: messageId, threadId, createdAt: now };
    }),

  /**
   * Preview the recipient set for a given audience filter without sending.
   * Returns total count + a small sample for UI confirmation. Cap at
   * BROADCAST_MAX_RECIPIENTS as defense-in-depth.
   */
  previewAudience: systemAdminProcedure
    .input(z.object({ audience: AUDIENCE_FILTER }))
    .query(async ({ ctx, input }) => {
      const recipients = await resolveAudience(ctx.db, input.audience);
      return {
        count: recipients.length,
        sample: recipients.slice(0, PREVIEW_SAMPLE_SIZE).map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          tenantId: r.tenantId,
          plan: r.plan,
        })),
        capped: recipients.length >= BROADCAST_MAX_RECIPIENTS,
      };
    }),

  /**
   * Broadcast a message to every recipient matching the audience filter.
   *
   * Side effects (all best-effort, atomic per-recipient):
   *   1. INSERT a `platform_broadcasts` audit row.
   *   2. For each recipient: get-or-create platform_threads row, INSERT
   *      one platform_thread_messages row with `broadcast_id` stamped.
   *   3. Fan out `platform.message` notifications via notifyManyWebUsers
   *      (idempotent via the partial UNIQUE on user_notifications).
   */
  broadcast: systemAdminProcedure
    .input(
      z.object({
        title: z.string().max(TITLE_MAX).optional(),
        body: z.string().min(1).max(MESSAGE_BODY_MAX),
        audience: AUDIENCE_FILTER,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = sanitizeText(input.body).trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });
      }

      const recipients = await resolveAudience(ctx.db, input.audience);
      if (recipients.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Audience matched zero recipients",
        });
      }

      const broadcastId = `bc_${ulid()}`;
      const now = nowSec();
      const preview = makePreview(body);
      const title = input.title?.trim() || null;

      await ctx.db.insert(platformBroadcasts).values({
        id: broadcastId,
        senderWebUserId: ctx.webUser!.id,
        title,
        body,
        audienceFilterJson: JSON.stringify(input.audience),
        recipientsCount: recipients.length,
        createdAt: now,
      });

      let sent = 0;
      let failed = 0;
      for (const recipient of recipients) {
        try {
          const { id: threadId } = await ensureThread(
            ctx.db,
            recipient.id,
            recipient.tenantId ?? null,
          );
          const messageId = ulid();
          await ctx.db.insert(platformThreadMessages).values({
            id: messageId,
            threadId,
            senderKind: "platform",
            senderWebUserId: ctx.webUser!.id,
            body,
            attachmentsJson: null,
            broadcastId,
            createdAt: now,
          });
          await ctx.db
            .update(platformThreads)
            .set({
              lastMessageAt: now,
              lastMessagePreview: preview,
              lastSenderKind: "platform",
              platformLastReadAt: now,
            })
            .where(eq(platformThreads.id, threadId));
          sent++;
        } catch {
          failed++;
        }
      }

      // Bell notifications — independent of message-insert success so the
      // UI still shows something even if one row failed.
      const notifyResult = await notifyManyWebUsers(
        ctx.db,
        recipients.map((r) => r.id),
        {
          kind: "platform.message",
          title: title || "Объявление ManicBot",
          body: preview,
          link: "/messages?platform=1",
          sourceSlug: "platform_messenger",
          sourceId: broadcastId,
        },
      );

      return {
        id: broadcastId,
        recipientsCount: recipients.length,
        sent,
        failed,
        notifyOk: notifyResult.ok,
        notifyFailed: notifyResult.failed,
      };
    }),

  /**
   * Broadcast history for the sysadmin panel. Newest first.
   */
  listBroadcasts: systemAdminProcedure
    .input(
      z
        .object({
          cursor: z.number().int().optional(),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds: any[] = [];
      if (input.cursor !== undefined) {
        conds.push(lt(platformBroadcasts.createdAt, input.cursor));
      }
      const rows = await ctx.db
        .select()
        .from(platformBroadcasts)
        .where(conds.length ? and(...conds) : undefined as any)
        .orderBy(desc(platformBroadcasts.createdAt))
        .limit(input.limit);

      const nextCursor =
        rows.length === input.limit ? rows[rows.length - 1]?.createdAt ?? undefined : undefined;

      return { items: rows, nextCursor };
    }),

  /**
   * Unread count for the sysadmin badge (threads with last message from
   * owner that platform hasn't read).
   */
  unreadCount: systemAdminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ c: sql<number>`count(*)` })
      .from(platformThreads)
      .where(
        and(
          eq(platformThreads.lastSenderKind, "owner"),
          // owner-sent and not yet read by platform
          sql`(${platformThreads.platformLastReadAt} IS NULL OR ${platformThreads.lastMessageAt} > ${platformThreads.platformLastReadAt})`,
        ),
      );
    return { count: Number(rows[0]?.c ?? 0) };
  }),
});
