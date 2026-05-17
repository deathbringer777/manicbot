/**
 * Internal messenger router (migration 0067).
 *
 * Surfaces all four thread kinds for the tenant-scoped `/messages` UI:
 *   - staff_dm    — 1:1 between two web_users
 *   - staff_group — N web_users with a title
 *   - client_conv — mirror of `conversations` row; Worker auto-creates on inbound (Phase 2)
 *   - system      — system notifications (read-only in UI)
 *
 * Auth: `protectedProcedure` + `assertMessengerTenantAccess(tenantId)` on every
 * procedure. Per-thread access uses `assertThreadMember()` which additionally
 * verifies the caller has a `thread_members` row (system_admin bypasses for
 * support escalation but the thread must still live in tenantId).
 *
 * Phase 1 (this PR) — router + UI only. Phase 2 wires the Worker auto-create.
 * Phase 3 adds Durable Object + WebSocket realtime fan-out.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, desc, lt, sql, inArray, gt, isNull } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  threads,
  threadMembers,
  threadMessages,
  webUsers,
  masters,
  masterInvitations,
} from "~/server/db/schema";
import { ulid } from "~/lib/ulid";
import { sanitizeText } from "~/server/security/sanitize";
import { computeDmKey } from "~/server/api/messenger/dmKey";
import {
  assertMessengerTenantAccess,
  assertThreadMember,
} from "~/server/api/messenger/access";
import { mintWsToken } from "~/lib/wsToken";
import { env } from "~/env";
import { log } from "~/server/utils/logger";

// ─── Validation ────────────────────────────────────────────────────

const THREAD_KIND = z.enum(["staff_dm", "staff_group", "client_conv", "system"]);

const MESSAGE_BODY_MAX = 4000;
const PREVIEW_MAX = 200;
const TITLE_MAX = 120;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function preview(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_MAX ? oneLine.slice(0, PREVIEW_MAX) : oneLine;
}

/**
 * Relay a client_conv reply through the Worker → channel adapter.
 *
 * Returns:
 *   { ok: true, externalMsgId } on successful send
 *   { ok: false, error } on channel/transport/permission failure
 *
 * Never throws — the admin-app already wrote the thread_messages row before
 * we call this, so the staff message is preserved even if the relay fails.
 * UI surfaces the error chip so the user can retry / switch to a template.
 */
async function relayToWorker(args: {
  tenantId: string;
  threadId: string;
  body: string;
  replyToMessageId?: string;
}): Promise<{ ok: true; externalMsgId: string | null } | { ok: false; error: string }> {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    log.warn("messenger.relay", {
      message: "WORKER_PUBLIC_URL or ADMIN_KEY not set — skipping outbound relay",
    });
    return { ok: false, error: "relay_not_configured" };
  }
  try {
    const resp = await fetch(`${workerUrl.replace(/\/$/, "")}/admin/messenger-outbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify(args),
    });
    const data = await resp.json().catch(() => null) as
      | { ok: boolean; external_msg_id?: string | null; error?: string }
      | null;
    if (!resp.ok || !data?.ok) {
      const error = data?.error ?? `relay_${resp.status}`;
      log.warn("messenger.relay", { message: "Worker relay failed", error, status: resp.status });
      return { ok: false, error };
    }
    return { ok: true, externalMsgId: data.external_msg_id ?? null };
  } catch (e) {
    log.error("messenger.relay", e instanceof Error ? e : new Error(String(e)));
    return { ok: false, error: "relay_network_error" };
  }
}

// ─── Router ────────────────────────────────────────────────────────

export const messengerRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════
  //  INBOX
  // ═══════════════════════════════════════════════════════════════
  listThreads: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        kind: THREAD_KIND.optional(),
        archived: z.boolean().default(false),
        cursor: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const webUserId = ctx.webUser!.id;
      const isAdmin = ctx.webUser!.webRole === "system_admin";

      const conditions = [
        eq(threads.tenantId, input.tenantId),
        eq(threads.archived, input.archived ? 1 : 0),
      ];
      if (input.kind) conditions.push(eq(threads.kind, input.kind));
      if (input.cursor !== undefined) {
        conditions.push(lt(threads.lastMessageAt, input.cursor));
      }

      // Non-admin members only see threads they belong to. We can't trivially
      // filter via a single SQL JOIN in Drizzle (the membership subquery would
      // be tenant-wide), so do two queries: thread ids the user is in, then
      // fetch threads. For God Mode + tenants that are mid-onboarding (no
      // threads yet), this is one extra round-trip — accepted trade-off.
      let memberThreadIds: string[] | null = null;
      if (!isAdmin) {
        const memberRows = await ctx.db
          .select({ threadId: threadMembers.threadId })
          .from(threadMembers)
          .where(
            and(
              eq(threadMembers.memberKind, "web_user"),
              eq(threadMembers.memberRef, webUserId),
            ),
          );
        memberThreadIds = memberRows.map((r) => r.threadId);
        if (memberThreadIds.length === 0) {
          return { items: [], nextCursor: undefined as number | undefined };
        }
        conditions.push(inArray(threads.id, memberThreadIds));
      }

      const rows = await ctx.db
        .select()
        .from(threads)
        .where(and(...conditions))
        .orderBy(desc(threads.lastMessageAt), desc(threads.createdAt))
        .limit(input.limit);

      // Unread badge: count `thread_messages` newer than the caller's
      // `last_read_message_id` for each thread (cap at 99 — UI doesn't care
      // about exact counts past that).
      const unreadByThread = new Map<string, number>();
      if (rows.length && !isAdmin) {
        const callerMembers = await ctx.db
          .select({
            threadId: threadMembers.threadId,
            lastRead: threadMembers.lastReadMessageId,
          })
          .from(threadMembers)
          .where(
            and(
              eq(threadMembers.memberKind, "web_user"),
              eq(threadMembers.memberRef, webUserId),
              inArray(
                threadMembers.threadId,
                rows.map((r) => r.id),
              ),
            ),
          );
        for (const m of callerMembers) {
          const cnt = await ctx.db
            .select({ n: sql<number>`count(*)` })
            .from(threadMessages)
            .where(
              and(
                eq(threadMessages.threadId, m.threadId),
                m.lastRead
                  ? sql`${threadMessages.id} > ${m.lastRead}`
                  : sql`1=1`,
                // Caller's own messages don't count as unread
                sql`NOT (${threadMessages.senderKind} = 'web_user' AND ${threadMessages.senderRef} = ${webUserId})`,
              ),
            );
          unreadByThread.set(m.threadId, Math.min(99, cnt[0]?.n ?? 0));
        }
      }

      const items = rows.map((r) => ({
        ...r,
        unreadCount: unreadByThread.get(r.id) ?? 0,
      }));

      const nextCursor =
        rows.length === input.limit
          ? rows[rows.length - 1]?.lastMessageAt ?? undefined
          : undefined;

      return { items, nextCursor };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  THREAD DETAIL + MESSAGES
  // ═══════════════════════════════════════════════════════════════
  getThread: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        cursor: z.string().optional(), // ULID — fetch messages with id < cursor
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { thread } = await assertThreadMember(ctx, input.tenantId, input.threadId);

      const conditions = [eq(threadMessages.threadId, input.threadId)];
      if (input.cursor) conditions.push(lt(threadMessages.id, input.cursor));

      const messages = await ctx.db
        .select()
        .from(threadMessages)
        .where(and(...conditions))
        .orderBy(desc(threadMessages.id))
        .limit(input.limit);

      const nextCursor =
        messages.length === input.limit ? messages[messages.length - 1]?.id : undefined;

      // Member list with display names — used by the UI to render avatars,
      // tooltips, and "X is typing" (Phase 4). Resolve web_user names via
      // `web_users` + `masters`.
      const members = await ctx.db
        .select()
        .from(threadMembers)
        .where(eq(threadMembers.threadId, input.threadId));

      const webUserIds = members
        .filter((m) => m.memberKind === "web_user")
        .map((m) => m.memberRef);
      const nameMap = new Map<string, string>();
      if (webUserIds.length) {
        const wu = await ctx.db
          .select({ id: webUsers.id, name: webUsers.name, email: webUsers.email })
          .from(webUsers)
          .where(inArray(webUsers.id, webUserIds));
        for (const u of wu) {
          nameMap.set(u.id, u.name ?? u.email ?? u.id);
        }
      }

      return {
        thread,
        messages: messages.reverse(), // chronological in render
        nextCursor,
        viewerWebUserId: ctx.webUser!.id,
        members: members.map((m) => ({
          ...m,
          displayName:
            m.memberKind === "web_user" ? nameMap.get(m.memberRef) ?? m.memberRef : m.memberRef,
        })),
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  SEND
  // ═══════════════════════════════════════════════════════════════
  sendMessage: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        body: z.string().min(1).max(MESSAGE_BODY_MAX),
        isInternalNote: z.boolean().default(false),
        replyToMessageId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { thread } = await assertThreadMember(ctx, input.tenantId, input.threadId);
      const webUserId = ctx.webUser!.id;

      // is_internal_note only makes sense on client_conv threads (it gates the
      // outbound relay). Silently coerce on other kinds.
      const isInternalNote =
        thread.kind === "client_conv" && input.isInternalNote ? 1 : 0;

      const body = sanitizeText(input.body).trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });
      }

      const id = ulid();
      const now = nowSec();

      await ctx.db.insert(threadMessages).values({
        id,
        threadId: input.threadId,
        tenantId: input.tenantId,
        senderKind: "web_user",
        senderRef: webUserId,
        body,
        attachmentsJson: null,
        isInternalNote,
        externalMsgId: null,
        replyToMessageId: input.replyToMessageId ?? null,
        createdAt: now,
        editedAt: null,
        deletedAt: null,
      });

      await ctx.db
        .update(threads)
        .set({ lastMessageAt: now, lastMessagePreview: preview(body) })
        .where(eq(threads.id, input.threadId));

      // Auto-mark caller's own message as read
      await ctx.db
        .update(threadMembers)
        .set({ lastReadMessageId: id, lastReadAt: now })
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, "web_user"),
            eq(threadMembers.memberRef, webUserId),
          ),
        );

      // Phase 2 — relay to Worker → channel adapter for client_conv threads.
      // Internal notes never relay (they're staff-only by design). Phase 3
      // will also publish to MESSENGER_HUB DO for WebSocket fan-out.
      let relay: { ok: true; externalMsgId: string | null } | { ok: false; error: string } | null = null;
      if (thread.kind === "client_conv" && !isInternalNote) {
        relay = await relayToWorker({
          tenantId: input.tenantId,
          threadId: input.threadId,
          body,
          replyToMessageId: input.replyToMessageId,
        });
        if (relay.ok && relay.externalMsgId) {
          // Stamp the channel-side message id onto our row so dedup +
          // delivery confirmation work later.
          await ctx.db
            .update(threadMessages)
            .set({ externalMsgId: relay.externalMsgId })
            .where(
              and(
                eq(threadMessages.id, id),
                eq(threadMessages.tenantId, input.tenantId),
              ),
            );
        }
      }

      return { id, createdAt: now, relay };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  READ STATE
  // ═══════════════════════════════════════════════════════════════
  markRead: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        lastSeenMessageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertThreadMember(ctx, input.tenantId, input.threadId);
      const webUserId = ctx.webUser!.id;

      await ctx.db
        .update(threadMembers)
        .set({ lastReadMessageId: input.lastSeenMessageId, lastReadAt: nowSec() })
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, "web_user"),
            eq(threadMembers.memberRef, webUserId),
          ),
        );
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  CREATE — staff DM
  // ═══════════════════════════════════════════════════════════════
  createStaffDm: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        otherWebUserId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const webUserId = ctx.webUser!.id;

      if (input.otherWebUserId === webUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot DM yourself" });
      }

      // Verify the other web_user actually has access to this tenant. Without
      // this check, a tenant_owner could open a DM with ANY user in the
      // platform, which would then appear in that user's inbox.
      const [other] = await ctx.db
        .select({ id: webUsers.id, tenantId: webUsers.tenantId, name: webUsers.name })
        .from(webUsers)
        .where(eq(webUsers.id, input.otherWebUserId))
        .limit(1);
      if (!other || other.tenantId !== input.tenantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Other user is not a member of this tenant",
        });
      }

      const dmKey = computeDmKey(webUserId, input.otherWebUserId);

      // Try to find an existing DM thread first (partial UNIQUE enforces
      // single-row, but SELECT first lets us avoid the conflict path most
      // of the time).
      const [existing] = await ctx.db
        .select()
        .from(threads)
        .where(
          and(
            eq(threads.tenantId, input.tenantId),
            eq(threads.kind, "staff_dm"),
            eq(threads.dmKey, dmKey),
          ),
        )
        .limit(1);
      if (existing) {
        return { threadId: existing.id, created: false };
      }

      const threadId = `th_${ulid()}`;
      const now = nowSec();

      try {
        await ctx.db.insert(threads).values({
          id: threadId,
          tenantId: input.tenantId,
          kind: "staff_dm",
          title: null,
          clientConversationId: null,
          dmKey,
          createdByWebUserId: webUserId,
          createdAt: now,
          lastMessageAt: now,
          lastMessagePreview: null,
          archived: 0,
        });

        await ctx.db.insert(threadMembers).values([
          {
            threadId,
            memberKind: "web_user",
            memberRef: webUserId,
            role: "member",
            joinedAt: now,
            mutedUntil: null,
            lastReadMessageId: null,
            lastReadAt: null,
          },
          {
            threadId,
            memberKind: "web_user",
            memberRef: input.otherWebUserId,
            role: "member",
            joinedAt: now,
            mutedUntil: null,
            lastReadMessageId: null,
            lastReadAt: null,
          },
        ]);
        return { threadId, created: true };
      } catch (e) {
        // Race with another tab — partial UNIQUE fired. Re-select and return.
        const [racedRow] = await ctx.db
          .select()
          .from(threads)
          .where(
            and(
              eq(threads.tenantId, input.tenantId),
              eq(threads.kind, "staff_dm"),
              eq(threads.dmKey, dmKey),
            ),
          )
          .limit(1);
        if (racedRow) {
          return { threadId: racedRow.id, created: false };
        }
        throw e;
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  //  CREATE — staff group
  // ═══════════════════════════════════════════════════════════════
  createStaffGroup: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        title: z.string().min(1).max(TITLE_MAX),
        memberWebUserIds: z.array(z.string().min(1)).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const webUserId = ctx.webUser!.id;

      // De-dup + always include creator
      const memberSet = new Set<string>([webUserId, ...input.memberWebUserIds]);

      // All members must belong to the tenant.
      const tenantUsers = await ctx.db
        .select({ id: webUsers.id })
        .from(webUsers)
        .where(
          and(
            inArray(webUsers.id, [...memberSet]),
            eq(webUsers.tenantId, input.tenantId),
          ),
        );
      if (tenantUsers.length !== memberSet.size) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "All members must belong to this tenant",
        });
      }

      const threadId = `th_${ulid()}`;
      const now = nowSec();
      const title = sanitizeText(input.title).trim();
      if (!title) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Title required" });
      }

      await ctx.db.insert(threads).values({
        id: threadId,
        tenantId: input.tenantId,
        kind: "staff_group",
        title,
        clientConversationId: null,
        dmKey: null,
        createdByWebUserId: webUserId,
        createdAt: now,
        lastMessageAt: now,
        lastMessagePreview: null,
        archived: 0,
      });

      await ctx.db.insert(threadMembers).values(
        [...memberSet].map((mid) => ({
          threadId,
          memberKind: "web_user" as const,
          memberRef: mid,
          role: mid === webUserId ? "owner" : "member",
          joinedAt: now,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        })),
      );

      return { threadId };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  ARCHIVE
  // ═══════════════════════════════════════════════════════════════
  archiveThread: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        archived: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertThreadMember(ctx, input.tenantId, input.threadId);
      await ctx.db
        .update(threads)
        .set({ archived: input.archived ? 1 : 0 })
        .where(eq(threads.id, input.threadId));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  REALTIME — issue a short-lived WS token (Phase 3)
  // ═══════════════════════════════════════════════════════════════
  issueWsToken: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const secret = env.WS_TOKEN_SECRET;
      if (!secret) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "WS_TOKEN_SECRET not configured — realtime disabled",
        });
      }
      const token = await mintWsToken(secret, {
        tenantId: input.tenantId,
        webUserId: ctx.webUser!.id,
      });
      return { token, ttlSec: 60 };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  STAFF DIRECTORY — for "+ New chat" picker
  // ═══════════════════════════════════════════════════════════════
  //  Returns:
  //   - candidates:        web_users in this tenant that the caller can DM
  //                        (self filtered out). These are the ONLY rows the
  //                        messenger can reach today — recipients with their
  //                        web_users.tenantId pointing at a different tenant
  //                        can't open the salon's messenger surface, so we
  //                        intentionally omit them to avoid sending DMs that
  //                        would never be read. They show up via the
  //                        notification bell once cross-tenant messenger view
  //                        ships in a follow-up.
  //   - pendingInviteCount Pending (not-yet-accepted, not-expired) email
  //                        invitations for this tenant — drives the
  //                        contextual empty-state hint in NewThreadModal.
  listStaff: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const webUserId = ctx.webUser!.id;

      const rows = await ctx.db
        .select({
          id: webUsers.id,
          name: webUsers.name,
          email: webUsers.email,
          role: webUsers.role,
        })
        .from(webUsers)
        .where(eq(webUsers.tenantId, input.tenantId));

      // Display-name fallback from the masters table (active rows only).
      const masterRows = await ctx.db
        .select({ webUserId: masters.webUserId, name: masters.name })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), isNull(masters.archivedAt)));
      const masterByWebUserId = new Map<string, string>();
      for (const m of masterRows) {
        if (m.webUserId && m.name) masterByWebUserId.set(m.webUserId, m.name);
      }

      // Pending email invitations — drives the empty-state hint copy in the
      // modal ("3 invited masters haven't joined yet").
      const nowSecLocal = nowSec();
      const pendingRows = await ctx.db
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(masterInvitations)
        .where(
          and(
            eq(masterInvitations.tenantId, input.tenantId),
            eq(masterInvitations.status, "pending"),
            gt(masterInvitations.tokenExpiresAt, nowSecLocal),
          ),
        );
      const pendingInviteCount = Number(pendingRows[0]?.count ?? 0);

      const candidates = rows
        .filter((r) => r.id !== webUserId) // hide self from the picker
        .map((r) => ({
          id: r.id,
          name: r.name ?? masterByWebUserId.get(r.id) ?? r.email ?? r.id,
          email: r.email,
          role: r.role,
        }));

      return { candidates, pendingInviteCount };
    }),
});
