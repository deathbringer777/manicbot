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
import { and, or, eq, desc, lt, sql, inArray, gt, isNull, isNotNull, ne, like } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  tenantOwnerProcedure,
  systemAdminProcedure,
} from "~/server/api/trpc";
import {
  threads,
  threadMembers,
  threadMessages,
  webUsers,
  masters,
  masterInvitations,
  tenants,
  appointments,
} from "~/server/db/schema";
import { ulid } from "~/lib/ulid";
import { sanitizeText } from "~/server/security/sanitize";
import { computeDmKey } from "~/server/api/messenger/dmKey";
import { isChatAttachmentCdnUrl, chatAttachmentUrlTenant } from "~/server/lib/url";
import {
  assertMessengerTenantAccess,
  assertThreadMember,
} from "~/server/api/messenger/access";
import { assertTenantBillingActive, assertEmailVerified } from "~/server/api/tenantAccess";
import { checkRateLimit } from "~/server/auth/rateLimit";
import { filterActiveRecipients, MUTE_FOREVER } from "~/server/api/messenger/mute";
import { sanitizeFtsQuery, buildMessageSearchSql } from "~/server/api/messenger/ftsQuery";
import { mintWsToken } from "~/lib/wsToken";
import { signUploadToken } from "~/server/lib/uploadToken";
import { env } from "~/env";
import { log } from "~/server/utils/logger";
import { notifyManyWebUsers } from "~/server/services/notifyWebUser";

// ─── Attachment limits ─────────────────────────────────────────────

const MAX_ATTACHMENTS_PER_MESSAGE = 4;
const MAX_ATTACHMENT_URL_LEN = 2000;

// ─── Rate limits (IU-6, audit 2026-06-12) ──────────────────────────
// Per-user (web_users.id) D1-backed limits. Message spam bloats D1 and
// fans out a bell notification per recipient; token mints are bounded
// by single-use jti but still free DB writes.

/** sendMessage: 30 messages per minute per user. */
const RL_SEND_MAX = 30;
const RL_SEND_WINDOW_MS = 60_000;
/** mintAttachmentUploadToken: 30 mints per 10 minutes per user. */
const RL_MINT_MAX = 30;
const RL_MINT_WINDOW_MS = 10 * 60_000;

// ─── Validation ────────────────────────────────────────────────────

const THREAD_KIND = z.enum(["staff_dm", "staff_group", "client_conv", "system", "requests"]);

const MESSAGE_BODY_MAX = 4000;
const PREVIEW_MAX = 200;
const TITLE_MAX = 120;
/** Window during which a sender may edit/withdraw their own message (24h). */
const EDIT_WINDOW_SEC = 86400;

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
  messageId?: string;
}): Promise<
  | { ok: true; externalMsgId: string | null }
  | { ok: false; error: string; queued?: boolean }
> {
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
      | { ok: boolean; external_msg_id?: string | null; error?: string; queued?: boolean }
      | null;
    if (!resp.ok || !data?.ok) {
      const queued = data?.queued === true;
      const error = data?.error ?? `relay_${resp.status}`;
      // queued (HTTP 202) = the Worker took ownership of a background auto-retry
      // (definitive 429/5xx). Not a hard failure — the row stays 'pending'.
      if (!queued) {
        log.warn("messenger.relay", { message: "Worker relay failed", error, status: resp.status });
      }
      return { ok: false, error, queued };
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
      if (input.kind) {
        conditions.push(eq(threads.kind, input.kind));
      } else {
        // Default "Все" view hides raw client_conv. Note: client_conv is a
        // God-Mode (system_admin) cross-tenant surface — the worker only adds the
        // external_client as a member, so a tenant owner is never a member and
        // the membership filter below already excludes them. Per-salon client
        // inbound reaches the owner as booking-request cards (kind='requests')
        // + the Telegram mirror to masters; surfacing raw client_conv per-owner
        // would require adding staff as thread members (separate change).
        conditions.push(ne(threads.kind, "client_conv"));
      }
      // Hide staff DMs that have no messages yet — a DM appears in the list only
      // once a real conversation exists (Telegram-style). This buries abandoned/
      // placeholder DM threads (e.g. opened from "New chat" but never written in).
      // Other kinds are unaffected.
      conditions.push(or(ne(threads.kind, "staff_dm"), isNotNull(threads.lastMessageAt))!);
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
      //
      // Old: one COUNT per thread in a for-loop — N+1 under load.
      // Fix: fetch caller's last_read for all threads in one query (SELECT),
      // then issue a SINGLE grouped COUNT query across all threads (fix #3 P1).
      // The grouped query uses a CASE to only count messages after each thread's
      // cursor; since D1/SQLite doesn't support lateral joins, we encode the
      // per-thread cursor as a JSON-encoded lookup in a scalar subquery using
      // the json_extract() function available in D1.
      //
      // Implementation: encode the lastRead map as a JSON object, then use
      // CASE WHEN id > json_extract(map, '$.' || thread_id) to filter each row.
      // This keeps the total query count constant at 2 (callerMembers + batch COUNT).
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

        if (callerMembers.length) {
          // Build the lastRead map: threadId → lastReadMessageId (or null = unread all)
          const lastReadMap = new Map<string, string | null>();
          for (const m of callerMembers) {
            lastReadMap.set(m.threadId, m.lastRead);
          }

          // Encode lastRead cursor as a JSON object so a single SQL query can
          // look it up per-row without a lateral join.
          // e.g. {"th_1":"msg_10","th_2":null,"th_3":"msg_5"}
          const lastReadJson = JSON.stringify(
            Object.fromEntries(lastReadMap.entries()),
          );

          // Single batched COUNT across all threads.
          // Counts non-own messages where id > lastRead (or all if lastRead is null).
          const batchResult = await ctx.db
            .select({
              threadId: sql<string>`${threadMessages.threadId}`,
              unreadCount: sql<number>`
                COUNT(
                  CASE WHEN
                    NOT (${threadMessages.senderKind} = 'web_user'
                         AND ${threadMessages.senderRef} = ${webUserId})
                    AND (
                      json_extract(${lastReadJson}, '$.' || ${threadMessages.threadId}) IS NULL
                      OR ${threadMessages.id} > json_extract(${lastReadJson}, '$.' || ${threadMessages.threadId})
                    )
                  THEN 1 ELSE NULL END
                )
              `.as("unreadCount"),
            })
            .from(threadMessages)
            .where(
              inArray(
                threadMessages.threadId,
                callerMembers.map((m) => m.threadId),
              ),
            )
            .groupBy(threadMessages.threadId);

          for (const r of batchResult) {
            unreadByThread.set(r.threadId, Math.min(99, r.unreadCount ?? 0));
          }
        }
      }

      // Resolve staff_dm display titles to the COUNTERPART's name (Telegram-style)
      // for DMs without an explicit title. This is per-viewer and cannot be stored
      // on the thread, because each participant must see the OTHER person's name.
      // Constant extra queries (1 membership + ≤2 name lookups), never per-thread.
      const dmTitleByThread = new Map<string, string>();
      const dmThreadIds = rows.filter((r) => r.kind === "staff_dm" && !r.title).map((r) => r.id);
      if (dmThreadIds.length) {
        const dmMembers = await ctx.db
          .select({
            threadId: threadMembers.threadId,
            memberKind: threadMembers.memberKind,
            memberRef: threadMembers.memberRef,
          })
          .from(threadMembers)
          .where(and(inArray(threadMembers.threadId, dmThreadIds), ne(threadMembers.memberRef, webUserId)));

        const dmWebUserIds = [...new Set(dmMembers.filter((m) => m.memberKind === "web_user").map((m) => m.memberRef))];
        const dmMasterRefs = [...new Set(dmMembers.filter((m) => m.memberKind === "master").map((m) => m.memberRef))];

        const nameByWebUser = new Map<string, string>();
        if (dmWebUserIds.length) {
          const wu = await ctx.db
            .select({ id: webUsers.id, name: webUsers.name, email: webUsers.email })
            .from(webUsers)
            .where(inArray(webUsers.id, dmWebUserIds));
          for (const u of wu) nameByWebUser.set(u.id, u.name ?? u.email ?? u.id);
        }
        const nameByMaster = new Map<string, string>();
        if (dmMasterRefs.length) {
          // master memberRef is String(chatId); masters.chatId is INTEGER, tenant-scoped.
          const chatIds = dmMasterRefs.map((r) => Number(r)).filter((n) => Number.isFinite(n));
          if (chatIds.length) {
            const ms = await ctx.db
              .select({ chatId: masters.chatId, name: masters.name })
              .from(masters)
              .where(and(eq(masters.tenantId, input.tenantId), inArray(masters.chatId, chatIds)));
            for (const m of ms) nameByMaster.set(String(m.chatId), m.name ?? String(m.chatId));
          }
        }
        for (const m of dmMembers) {
          if (dmTitleByThread.has(m.threadId)) continue; // first counterpart wins
          const name = m.memberKind === "web_user" ? nameByWebUser.get(m.memberRef) : nameByMaster.get(m.memberRef);
          if (name) dmTitleByThread.set(m.threadId, name);
        }
      }

      const items = rows.map((r) => ({
        ...r,
        title: r.kind === "staff_dm" && !r.title ? dmTitleByThread.get(r.id) ?? r.title : r.title,
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

      // For booking-request cards, overlay the LIVE appointment status so the
      // card buttons reflect reality (a request claimed/confirmed elsewhere
      // shows as done, not still-claimable). The extra query only runs when the
      // page actually contains request cards — tenant-scoped.
      const requestAptIds = messages
        .filter((m) => m.refKind === "booking_request" && m.refId)
        .map((m) => m.refId as string);
      const liveStatusById = new Map<
        string,
        { status: string; masterId: number | null; cancelled: number }
      >();
      if (requestAptIds.length > 0) {
        const aptRows = await ctx.db
          .select({
            id: appointments.id,
            status: appointments.status,
            masterId: appointments.masterId,
            cancelled: appointments.cancelled,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              inArray(appointments.id, requestAptIds),
            ),
          );
        for (const r of aptRows) {
          liveStatusById.set(r.id, {
            status: r.status,
            masterId: r.masterId ?? null,
            cancelled: r.cancelled ?? 0,
          });
        }
      }
      const messagesWithLive = messages.map((m) => ({
        ...m,
        liveAppointment: m.refId ? liveStatusById.get(m.refId) ?? null : null,
      }));

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

      // Telegram-only master members carry their chat_id as memberRef — resolve
      // it to the master's name so the member list (and master-authored messages)
      // show "Анна", not the raw chat id. Tenant-scoped.
      const masterRefs = members
        .filter((m) => m.memberKind === "master")
        .map((m) => m.memberRef);
      const masterNameMap = new Map<string, string>();
      if (masterRefs.length) {
        const chatIds = masterRefs.map((r) => Number(r)).filter((n) => Number.isFinite(n));
        if (chatIds.length) {
          const ms = await ctx.db
            .select({ chatId: masters.chatId, name: masters.name })
            .from(masters)
            .where(and(eq(masters.tenantId, input.tenantId), inArray(masters.chatId, chatIds)));
          for (const m of ms) masterNameMap.set(String(m.chatId), m.name ?? String(m.chatId));
        }
      }

      return {
        thread,
        // Soft-deleted rows keep their place (tombstone) but never leak content.
        // Use the LIVE-enriched array so booking-request cards carry the current
        // appointment status (`liveAppointment`), not just the post-time snapshot
        // (finding C5). Both `messagesWithLive` and this tombstone map spread
        // `...m`, so the overlay survives to the response.
        messages: messagesWithLive
          .map((m) => (m.deletedAt ? { ...m, body: "", attachmentsJson: null } : m))
          .reverse(), // chronological in render
        nextCursor,
        viewerWebUserId: ctx.webUser!.id,
        members: members.map((m) => ({
          ...m,
          displayName:
            m.memberKind === "web_user"
              ? nameMap.get(m.memberRef) ?? m.memberRef
              : m.memberKind === "master"
                ? masterNameMap.get(m.memberRef) ?? m.memberRef
                : m.memberRef,
        })),
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  SEARCH — full-text over message bodies (FTS5, migration 0099)
  // ═══════════════════════════════════════════════════════════════
  //  Tenant-scoped AND constrained to the caller's thread membership — a naive
  //  FTS match would leak messages from threads the caller isn't in.
  //  system_admin searches tenant-wide (support escalation, like getThread's
  //  bypass). Soft-deleted messages never surface (their FTS row is dropped).
  searchMessages: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        query: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const match = sanitizeFtsQuery(input.query);
      if (!match) return { items: [] };

      const isAdmin = ctx.webUser!.webRole === "system_admin";
      let threadIds: string[] | null = null;
      if (!isAdmin) {
        const memberRows = await ctx.db
          .select({ threadId: threadMembers.threadId })
          .from(threadMembers)
          .where(
            and(
              eq(threadMembers.memberKind, "web_user"),
              eq(threadMembers.memberRef, ctx.webUser!.id),
            ),
          );
        threadIds = memberRows.map((r) => r.threadId);
        // No threads → no results. Critically, this prevents running an
        // unconstrained FTS query that would leak other threads' messages.
        if (threadIds.length === 0) return { items: [] };
      }

      const { sql: searchSql, binds } = buildMessageSearchSql({
        tenantId: input.tenantId,
        threadIds,
        match,
        limit: input.limit,
      });
      // Raw parameterized exec — same proven shape as platformCustomers'
      // subscriber query: db.run(sql.raw(text), binds) → { results }.
      const rawDb = ctx.db as unknown as {
        run: (q: unknown, b: unknown[]) => Promise<{ results?: unknown[]; rows?: unknown[] }>;
      };
      const res = await rawDb.run(sql.raw(searchSql), binds);
      const rows = (res?.results ?? res?.rows ?? []) as Array<{
        id: string;
        threadId: string;
        senderKind: string;
        senderRef: string;
        body: string;
        createdAt: number;
        isInternalNote: number;
      }>;
      return { items: rows };
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
        // Up to N image attachments. IU-1 (audit 2026-06-12): URLs are
        // pinned to the exact CDN shape minted via mintAttachmentUploadToken
        // (`/cdn/t/<tid>/chat_attachment-<sha>.<ext>`) — the read path is a
        // browser `<img src>` at the counterparty, so an arbitrary https
        // host was a tracking-pixel / phishing surface. The tenant segment
        // is additionally matched against input.tenantId in the handler.
        attachments: z
          .array(z.object({
            url: z.string().url().max(MAX_ATTACHMENT_URL_LEN).refine(isChatAttachmentCdnUrl, { message: "url_must_be_cdn_attachment" }),
            kind: z.literal("image").default("image"),
          }))
          .max(MAX_ATTACHMENTS_PER_MESSAGE)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // IU-6: per-user limiter before any work.
      const rl = await checkRateLimit(ctx.db, ctx.webUser!.id, "messenger_send", RL_SEND_MAX, RL_SEND_WINDOW_MS);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many messages. Try again later." });
      }

      const { thread } = await assertThreadMember(ctx, input.tenantId, input.threadId);
      // CS-1 (audit 2026-06-12): outbound messaging is a high-value product
      // action — locked server-side for an expired-trial / churned tenant.
      // Placed AFTER the membership assert so billing state is never an
      // oracle for tenants the caller doesn't belong to.
      await assertTenantBillingActive(ctx, input.tenantId);
      // CS-2: outbound messaging also requires a verified email.
      await assertEmailVerified(ctx);

      // IU-1: the CDN tenant segment must belong to THIS message's tenant —
      // the zod refine only pins the path shape.
      for (const a of input.attachments ?? []) {
        if (chatAttachmentUrlTenant(a.url) !== input.tenantId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "attachment_url_tenant_mismatch" });
        }
      }
      const webUserId = ctx.webUser!.id;

      // is_internal_note only makes sense on client_conv threads (it gates the
      // outbound relay). Silently coerce on other kinds.
      const isInternalNote =
        thread.kind === "client_conv" && input.isInternalNote ? 1 : 0;

      // Only staff→client (non-note) messages have a delivery lifecycle. Start
      // 'pending'; the relay result below advances it to 'sent' or 'failed'.
      const isClientConvOutbound = thread.kind === "client_conv" && !isInternalNote;

      const body = sanitizeText(input.body).trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });
      }

      const id = ulid();
      const now = nowSec();

      // Attachments are stored as JSON: { attachments: [{ url, kind }, …] }.
      // Wrapped in an object (not a raw array) so we can extend the schema
      // with metadata fields later without breaking older readers.
      const attachmentsJson =
        input.attachments && input.attachments.length > 0
          ? JSON.stringify({ attachments: input.attachments })
          : null;

      await ctx.db.insert(threadMessages).values({
        id,
        threadId: input.threadId,
        tenantId: input.tenantId,
        senderKind: "web_user",
        senderRef: webUserId,
        body,
        attachmentsJson,
        isInternalNote,
        externalMsgId: null,
        replyToMessageId: input.replyToMessageId ?? null,
        createdAt: now,
        editedAt: null,
        deletedAt: null,
        deliveryState: isClientConvOutbound ? "pending" : null,
        deliveryError: null,
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

      // PR-B (Notification Center 2.0): in-app bell fan-out. Every other
      // web_user member of this thread gets one bell row per message. Uses
      // `messageId` in the sourceId so each post is a distinct row (PR-C
      // smart grouping will collapse them visually). Internal notes are
      // staff-only — they STILL trigger the bell because staff members
      // need to see the note land. Skip silently when the only other
      // member is the sender themselves.
      try {
        const otherWebUserMembers = await ctx.db
          .select({
            memberRef: threadMembers.memberRef,
            mutedUntil: threadMembers.mutedUntil,
          })
          .from(threadMembers)
          .where(
            and(
              eq(threadMembers.threadId, input.threadId),
              eq(threadMembers.memberKind, "web_user"),
              ne(threadMembers.memberRef, webUserId),
            ),
          );
        // Mute is notification-only: drop members whose mute is still active so
        // they don't get a bell row (they still see the message + unread badge).
        const recipientIds = filterActiveRecipients(otherWebUserMembers, now);
        if (recipientIds.length > 0) {
          const senderRow = await ctx.db
            .select({ email: webUsers.email })
            .from(webUsers)
            .where(eq(webUsers.id, webUserId))
            .limit(1);
          const senderLabel = senderRow[0]?.email?.split("@")[0] ?? "Сотрудник";
          const title =
            thread.kind === "client_conv"
              ? `Клиент: ${senderLabel}`
              : thread.kind === "staff_group"
                ? `Сообщение в группе`
                : `Новое сообщение от ${senderLabel}`;
          // PR-B: was `void` — fire-and-forget loses the D1 binding on
          // Cloudflare Pages once the response returns, so the bell
          // fan-out silently dropped every message. Await it; the
          // outer try/catch still keeps the primary sendMessage flow
          // safe if the fan-out blows up.
          await notifyManyWebUsers(ctx.db, recipientIds, {
            kind: "messenger.message",
            title,
            body: preview(body),
            link: `/messages?thread=${encodeURIComponent(input.threadId)}`,
            tenantId: input.tenantId,
            sourceSlug: "thread",
            // Distinct sourceId per message → each post is its own bell
            // row. PR-C grouping will collapse multi-message-from-same-thread
            // into "Анна · 3 новых сообщения" client-side.
            sourceId: `${input.threadId}:${id}`,
          }).catch((e) =>
            log.warn(
              "messenger.sendMessage.bell_fanout_failed",
              e instanceof Error ? { message: e.message } : { raw: String(e) },
            ),
          );
        }
      } catch (e) {
        // Bell fan-out is sidecar — a D1 hiccup here must not abort the
        // primary sendMessage flow (the message is already persisted).
        log.warn(
          "messenger.sendMessage.bell_fanout_lookup_failed",
          e instanceof Error ? { message: e.message } : { raw: String(e) },
        );
      }

      // Phase 2 — relay to Worker → channel adapter for client_conv threads.
      // Internal notes never relay (they're staff-only by design). Phase 3
      // will also publish to MESSENGER_HUB DO for WebSocket fan-out.
      let relay:
        | { ok: true; externalMsgId: string | null }
        | { ok: false; error: string; queued?: boolean }
        | null = null;
      if (isClientConvOutbound) {
        relay = await relayToWorker({
          tenantId: input.tenantId,
          threadId: input.threadId,
          body,
          replyToMessageId: input.replyToMessageId,
          messageId: id,
        });
        // Persist the delivery outcome so it survives reload + drives the status
        // icon. 'queued' = the Worker is auto-retrying a transient 429/5xx → keep
        // 'pending' (the retry queue resolves it to sent/failed).
        if (relay.ok) {
          // Terminal-guard the advance to 'sent': only a still-'pending' row may
          // move forward. A concurrent Meta 'delivered' webhook receipt is
          // terminal and must NOT be clobbered back to 'sent' by this relay ack.
          await ctx.db
            .update(threadMessages)
            .set({
              deliveryState: "sent",
              ...(relay.externalMsgId ? { externalMsgId: relay.externalMsgId } : {}),
            })
            .where(
              and(
                eq(threadMessages.id, id),
                eq(threadMessages.tenantId, input.tenantId),
                eq(threadMessages.deliveryState, "pending"),
              ),
            );
        } else if (!relay.queued) {
          await ctx.db
            .update(threadMessages)
            .set({ deliveryState: "failed", deliveryError: relay.error })
            .where(and(eq(threadMessages.id, id), eq(threadMessages.tenantId, input.tenantId)));
        }
        // queued → leave the row 'pending'.
      }

      // Don't surface a scary error chip for a queued auto-retry — the 'pending'
      // clock is the truthful signal.
      const clientRelay = relay && relay.ok === false && relay.queued ? null : relay;
      return { id, createdAt: now, relay: clientRelay };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  RETRY — re-relay a failed client_conv message
  // ═══════════════════════════════════════════════════════════════
  retryMessage: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        messageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { thread } = await assertThreadMember(ctx, input.tenantId, input.threadId);
      if (thread.kind !== "client_conv") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only client conversations relay" });
      }
      const [msg] = await ctx.db
        .select()
        .from(threadMessages)
        .where(
          and(
            eq(threadMessages.id, input.messageId),
            eq(threadMessages.tenantId, input.tenantId),
            eq(threadMessages.threadId, input.threadId),
          ),
        )
        .limit(1);
      if (!msg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      }
      if (msg.deliveryState !== "failed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed messages can be retried" });
      }

      // Flip to pending so the UI shows the in-flight state, then re-relay.
      await ctx.db
        .update(threadMessages)
        .set({ deliveryState: "pending", deliveryError: null })
        .where(and(eq(threadMessages.id, input.messageId), eq(threadMessages.tenantId, input.tenantId)));

      const relay = await relayToWorker({
        tenantId: input.tenantId,
        threadId: input.threadId,
        body: msg.body,
        replyToMessageId: msg.replyToMessageId ?? undefined,
        messageId: input.messageId,
      });
      if (relay.ok) {
        await ctx.db
          .update(threadMessages)
          .set({
            deliveryState: "sent",
            ...(relay.externalMsgId ? { externalMsgId: relay.externalMsgId } : {}),
          })
          .where(and(eq(threadMessages.id, input.messageId), eq(threadMessages.tenantId, input.tenantId)));
      } else if (!relay.queued) {
        await ctx.db
          .update(threadMessages)
          .set({ deliveryState: "failed", deliveryError: relay.error })
          .where(and(eq(threadMessages.id, input.messageId), eq(threadMessages.tenantId, input.tenantId)));
      }
      // queued → row stays 'pending' (already flipped above); the queue resolves it.
      return { ok: true, relay };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  EDIT / DELETE — author-only, soft delete
  // ═══════════════════════════════════════════════════════════════
  //  Only the web_user author may edit/delete their own message. Edit is
  //  blocked for already-relayed messages (TG/WA/IG can't reliably edit and
  //  the client already has the original) and past a 24h window. Delete is a
  //  soft delete (deleted_at) — getThread masks the body but keeps a tombstone
  //  so the timeline has no holes.
  editMessage: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        messageId: z.string().min(1),
        body: z.string().min(1).max(MESSAGE_BODY_MAX),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertThreadMember(ctx, input.tenantId, input.threadId);
      const webUserId = ctx.webUser!.id;
      const [msg] = await ctx.db
        .select()
        .from(threadMessages)
        .where(
          and(
            eq(threadMessages.id, input.messageId),
            eq(threadMessages.tenantId, input.tenantId),
            eq(threadMessages.threadId, input.threadId),
          ),
        )
        .limit(1);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (msg.senderKind !== "web_user" || msg.senderRef !== webUserId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit" });
      }
      if (msg.deletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Message is deleted" });
      }
      if (msg.externalMsgId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot_edit_relayed" });
      }
      const now = nowSec();
      if (now - msg.createdAt > EDIT_WINDOW_SEC) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "edit_window_expired" });
      }
      const body = sanitizeText(input.body).trim();
      if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });

      await ctx.db
        .update(threadMessages)
        .set({ body, editedAt: now })
        .where(
          and(eq(threadMessages.id, input.messageId), eq(threadMessages.tenantId, input.tenantId)),
        );
      // Refresh the inbox preview if this was the thread's last message.
      await ctx.db
        .update(threads)
        .set({ lastMessagePreview: preview(body) })
        .where(and(eq(threads.id, input.threadId), eq(threads.lastMessageAt, msg.createdAt)));
      return { ok: true, editedAt: now };
    }),

  deleteMessage: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        messageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertThreadMember(ctx, input.tenantId, input.threadId);
      const webUserId = ctx.webUser!.id;
      const [msg] = await ctx.db
        .select()
        .from(threadMessages)
        .where(
          and(
            eq(threadMessages.id, input.messageId),
            eq(threadMessages.tenantId, input.tenantId),
            eq(threadMessages.threadId, input.threadId),
          ),
        )
        .limit(1);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (msg.senderKind !== "web_user" || msg.senderRef !== webUserId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete" });
      }
      if (msg.deletedAt) return { ok: true, alreadyDeleted: true };

      await ctx.db
        .update(threadMessages)
        .set({ deletedAt: nowSec() })
        .where(
          and(eq(threadMessages.id, input.messageId), eq(threadMessages.tenantId, input.tenantId)),
        );
      // Relayed messages: the external channel already delivered the original,
      // so we only hide our mirror — surface a warning for the UI caption.
      return { ok: true, relayedWarning: !!msg.externalMsgId };
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

      // Monotonic guard: the read pointer may only move FORWARD. Opening an old
      // paginated view must not drag `last_read_message_id` backwards (that would
      // resurrect already-cleared unread badges). ULIDs sort lexicographically by
      // creation time, so a plain `<` compare is a valid "older than" test.
      await ctx.db
        .update(threadMembers)
        .set({ lastReadMessageId: input.lastSeenMessageId, lastReadAt: nowSec() })
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, "web_user"),
            eq(threadMembers.memberRef, webUserId),
            or(
              isNull(threadMembers.lastReadMessageId),
              lt(threadMembers.lastReadMessageId, input.lastSeenMessageId),
            ),
          ),
        );
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  MUTE — per-member, notification-only
  // ═══════════════════════════════════════════════════════════════
  //  Muting sets `thread_members.muted_until` on the CALLER's own row. A
  //  muted member still sees unread badges + new messages; they just don't
  //  get a notification-bell row (see the fan-out filter in sendMessage).
  //  Mute never gates read receipts or message delivery.
  muteThread: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        // Unix seconds. Omitted → mute indefinitely (MUTE_FOREVER sentinel).
        until: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertThreadMember(ctx, input.tenantId, input.threadId);
      const mutedUntil = input.until ?? MUTE_FOREVER;
      await ctx.db
        .update(threadMembers)
        .set({ mutedUntil })
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, "web_user"),
            eq(threadMembers.memberRef, ctx.webUser!.id),
          ),
        );
      return { ok: true, mutedUntil };
    }),

  unmuteThread: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), threadId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertThreadMember(ctx, input.tenantId, input.threadId);
      await ctx.db
        .update(threadMembers)
        .set({ mutedUntil: null })
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, "web_user"),
            eq(threadMembers.memberRef, ctx.webUser!.id),
          ),
        );
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  CREATE — staff DM
  // ═══════════════════════════════════════════════════════════════
  //
  //  Two input branches, exactly one required:
  //    - { otherWebUserId }         → real DM with another web_user.
  //    - { otherMasterChatId }      → placeholder DM with a master who has
  //                                   no web account yet. Backfilled to a
  //                                   real DM by `linkMasterPlaceholder...`
  //                                   the moment the master creates / links
  //                                   a web account.
  //
  //  Tenant guard:
  //    Same-tenant web_users are accepted directly.
  //    Cross-tenant web_users are accepted iff they're linked to an active
  //    `masters` row in THIS salon — covers the canonical
  //    `acceptInvitationExistingUser` path where `web_users.tenant_id`
  //    keeps pointing at the master's personal tenant.
  createStaffDm: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        otherWebUserId: z.string().min(1).optional(),
        otherMasterChatId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const callerWebUserId = ctx.webUser!.id;

      const hasWebTarget = !!input.otherWebUserId;
      const hasMasterTarget = !!input.otherMasterChatId;
      if (hasWebTarget === hasMasterTarget) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Provide exactly one of otherWebUserId or otherMasterChatId",
        });
      }

      let effectiveOtherWebUserId: string | null = null;
      let effectiveOtherMasterChatId: string | null = null;

      if (hasMasterTarget) {
        // — Master placeholder branch ─────────────────────────────────
        const chatIdNum = Number(input.otherMasterChatId);
        if (!Number.isFinite(chatIdNum)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid master chatId" });
        }
        const [m] = await ctx.db
          .select({
            chatId: masters.chatId,
            webUserId: masters.webUserId,
          })
          .from(masters)
          .where(
            and(
              eq(masters.tenantId, input.tenantId),
              eq(masters.chatId, chatIdNum),
              isNull(masters.archivedAt),
            ),
          )
          .limit(1);
        if (!m) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Master is not in this tenant or has been archived",
          });
        }
        if (m.webUserId) {
          // Promote to a real web-user DM so we never create an orphan
          // placeholder when the master already has a web account.
          if (m.webUserId === callerWebUserId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot DM yourself" });
          }
          effectiveOtherWebUserId = m.webUserId;
        } else {
          effectiveOtherMasterChatId = String(m.chatId);
        }
      } else {
        // — Web-user branch ───────────────────────────────────────────
        if (input.otherWebUserId === callerWebUserId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot DM yourself" });
        }
        const [other] = await ctx.db
          .select({ id: webUsers.id, tenantId: webUsers.tenantId })
          .from(webUsers)
          .where(eq(webUsers.id, input.otherWebUserId!))
          .limit(1);
        if (!other) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Other user is not a member of this tenant",
          });
        }
        if (other.tenantId !== input.tenantId) {
          // web_users.tenant_id may point at the master's personal tenant
          // even when they're a fully-active staff member here. Accept the
          // DM iff there's an active masters row linking them to this
          // salon.
          const [linked] = await ctx.db
            .select({ chatId: masters.chatId })
            .from(masters)
            .where(
              and(
                eq(masters.tenantId, input.tenantId),
                eq(masters.webUserId, input.otherWebUserId!),
                isNull(masters.archivedAt),
              ),
            )
            .limit(1);
          if (!linked) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Other user is not a member of this tenant",
            });
          }
        }
        effectiveOtherWebUserId = input.otherWebUserId!;
      }

      // ── dm_key + dedup lookup ───────────────────────────────────────
      const otherRef = effectiveOtherWebUserId ?? `m:${effectiveOtherMasterChatId!}`;
      const dmKey = computeDmKey(callerWebUserId, otherRef);

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
          createdByWebUserId: callerWebUserId,
          createdAt: now,
          lastMessageAt: now,
          lastMessagePreview: null,
          archived: 0,
        });

        const otherMember = effectiveOtherWebUserId
          ? {
              threadId,
              memberKind: "web_user" as const,
              memberRef: effectiveOtherWebUserId,
              role: "member",
              joinedAt: now,
              mutedUntil: null,
              lastReadMessageId: null,
              lastReadAt: null,
            }
          : {
              threadId,
              memberKind: "master" as const,
              memberRef: effectiveOtherMasterChatId!,
              role: "member",
              joinedAt: now,
              mutedUntil: null,
              lastReadMessageId: null,
              lastReadAt: null,
            };

        await ctx.db.insert(threadMembers).values([
          {
            threadId,
            memberKind: "web_user",
            memberRef: callerWebUserId,
            role: "member",
            joinedAt: now,
            mutedUntil: null,
            lastReadMessageId: null,
            lastReadAt: null,
          },
          otherMember,
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
  //  STAFF GROUP — list members + owner-only remove
  // ═══════════════════════════════════════════════════════════════
  //  Powers the "Участники" panel of the default "Команда" group (and any
  //  manually-created staff_group). `listStaffGroupMembers` resolves each
  //  thread_members row against web_users + masters so the UI gets a single
  //  shape with display name and avatar hints. `removeStaffMember` is the
  //  owner-only mutation behind the ✕ button: it drops the row and posts a
  //  system message in the thread so the change is auditable in-band.
  //
  //  Refuses to remove a member with role='owner' so the owner can't lock
  //  themselves out of the team chat.
  listStaffGroupMembers: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { thread } = await assertThreadMember(ctx, input.tenantId, input.threadId);
      if (thread.kind !== "staff_group") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Members panel is only available for staff_group threads",
        });
      }

      const members = await ctx.db
        .select()
        .from(threadMembers)
        .where(eq(threadMembers.threadId, input.threadId));

      const webUserIds = members
        .filter((m) => m.memberKind === "web_user")
        .map((m) => m.memberRef);
      const masterRefs = members
        .filter((m) => m.memberKind === "master")
        .map((m) => Number(m.memberRef))
        .filter((n) => Number.isFinite(n));

      const webRows = webUserIds.length
        ? await ctx.db
            .select({
              id: webUsers.id,
              name: webUsers.name,
              email: webUsers.email,
              role: webUsers.role,
            })
            .from(webUsers)
            .where(inArray(webUsers.id, webUserIds))
        : [];
      const webById = new Map(webRows.map((r) => [r.id, r]));

      const masterRows = masterRefs.length
        ? await ctx.db
            .select({
              chatId: masters.chatId,
              name: masters.name,
              webUserId: masters.webUserId,
            })
            .from(masters)
            .where(
              and(
                eq(masters.tenantId, input.tenantId),
                inArray(masters.chatId, masterRefs),
              ),
            )
        : [];
      const masterByChat = new Map(masterRows.map((r) => [String(r.chatId), r]));

      return members.map((m) => {
        if (m.memberKind === "web_user") {
          const wu = webById.get(m.memberRef);
          return {
            threadId: m.threadId,
            memberKind: m.memberKind,
            memberRef: m.memberRef,
            role: m.role,
            name: wu?.name ?? wu?.email ?? m.memberRef,
            webRole: wu?.role ?? null,
            connectStatus: "connected" as const,
          };
        }
        if (m.memberKind === "master") {
          const mr = masterByChat.get(m.memberRef);
          return {
            threadId: m.threadId,
            memberKind: m.memberKind,
            memberRef: m.memberRef,
            role: m.role,
            name: mr?.name ?? m.memberRef,
            webRole: null,
            connectStatus: "telegram_only" as const,
          };
        }
        // external_client — unlikely in a staff_group but keep the shape uniform.
        return {
          threadId: m.threadId,
          memberKind: m.memberKind,
          memberRef: m.memberRef,
          role: m.role,
          name: m.memberRef,
          webRole: null,
          connectStatus: "external" as const,
        };
      });
    }),

  removeStaffMember: tenantOwnerProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        threadId: z.string().min(1),
        memberKind: z.enum(["web_user", "master"]),
        memberRef: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);

      // Confirm the thread exists in THIS tenant. Defensive even though
      // tenantOwnerProcedure pinned the role — the role gate doesn't bind
      // the caller to a specific tenant.
      const [thread] = await ctx.db
        .select({ id: threads.id, tenantId: threads.tenantId, kind: threads.kind })
        .from(threads)
        .where(and(eq(threads.id, input.threadId), eq(threads.tenantId, input.tenantId)))
        .limit(1);
      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }
      if (thread.kind !== "staff_group") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only staff_group threads support member removal",
        });
      }

      // Refuse removing the owner — would lock the salon owner out of the
      // team chat. UI should also hide the ✕ for owner rows; this is the
      // backend guard.
      const [target] = await ctx.db
        .select({ role: threadMembers.role })
        .from(threadMembers)
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, input.memberKind),
            eq(threadMembers.memberRef, input.memberRef),
          ),
        )
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found in thread" });
      }
      if (target.role === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the owner from the team chat",
        });
      }

      // Look up display name for the system-message body. Best-effort —
      // falls back to the ref so the message is never blank.
      let displayName: string | null = null;
      if (input.memberKind === "web_user") {
        const [wu] = await ctx.db
          .select({ name: webUsers.name, email: webUsers.email })
          .from(webUsers)
          .where(eq(webUsers.id, input.memberRef))
          .limit(1);
        displayName = wu?.name ?? wu?.email ?? null;
      } else {
        const chatIdNum = Number(input.memberRef);
        if (Number.isFinite(chatIdNum)) {
          const [mr] = await ctx.db
            .select({ name: masters.name })
            .from(masters)
            .where(
              and(
                eq(masters.tenantId, input.tenantId),
                eq(masters.chatId, chatIdNum),
              ),
            )
            .limit(1);
          displayName = mr?.name ?? null;
        }
      }

      await ctx.db
        .delete(threadMembers)
        .where(
          and(
            eq(threadMembers.threadId, input.threadId),
            eq(threadMembers.memberKind, input.memberKind),
            eq(threadMembers.memberRef, input.memberRef),
          ),
        );

      const now = nowSec();
      const body = `${displayName ?? input.memberRef} был исключён из команды владельцем`;
      const messageId = ulid();
      await ctx.db.insert(threadMessages).values({
        id: messageId,
        threadId: input.threadId,
        tenantId: input.tenantId,
        senderKind: "system",
        senderRef: ctx.webUser!.id,
        body,
        attachmentsJson: null,
        isInternalNote: 0,
        externalMsgId: null,
        replyToMessageId: null,
        createdAt: now,
        editedAt: null,
        deletedAt: null,
      });

      await ctx.db
        .update(threads)
        .set({ lastMessageAt: now, lastMessagePreview: preview(body) })
        .where(eq(threads.id, input.threadId));

      return { ok: true, messageId };
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
  //  GOD MODE — cross-tenant client inbox (consolidated /conversations)
  // ═══════════════════════════════════════════════════════════════
  //  Replaces the retired user-facing `/conversations` surface. Lists
  //  `client_conv` threads ACROSS all tenants for support/ops. system_admin
  //  only. The detail read still goes through `getThread`, which pins
  //  `threads.tenant_id` to the supplied tenantId — so the cross-tenant id
  //  returned here can't be used to escalate into a different tenant's thread.
  listClientConvAdmin: systemAdminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        archived: z.boolean().default(false),
        search: z.string().optional(),
        cursor: z.number().int().optional(), // last_message_at cursor
        limit: z.number().int().min(1).max(100).default(40),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(threads.kind, "client_conv"),
        eq(threads.archived, input.archived ? 1 : 0),
      ];
      if (input.tenantId) conditions.push(eq(threads.tenantId, input.tenantId));
      if (input.cursor !== undefined) {
        conditions.push(lt(threads.lastMessageAt, input.cursor));
      }
      if (input.search?.trim()) {
        const pat = `%${input.search.trim().replace(/[%_]/g, "\\$&")}%`;
        conditions.push(like(threads.lastMessagePreview, pat));
      }

      const rows = await ctx.db
        .select({
          id: threads.id,
          tenantId: threads.tenantId,
          title: threads.title,
          lastMessageAt: threads.lastMessageAt,
          lastMessagePreview: threads.lastMessagePreview,
          archived: threads.archived,
          tenantName: tenants.name,
        })
        .from(threads)
        .leftJoin(tenants, eq(threads.tenantId, tenants.id))
        .where(and(...conditions))
        .orderBy(desc(threads.lastMessageAt))
        .limit(input.limit);

      return {
        items: rows,
        nextCursor:
          rows.length === input.limit
            ? rows[rows.length - 1]?.lastMessageAt ?? undefined
            : undefined,
      };
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

  /**
   * Mint a short-lived HMAC-signed upload token for the Worker's
   * `/upload/asset` endpoint, scoped to `chat_attachment` + the caller's
   * tenant + thread membership. Returns `{ token, uploadUrl }`.
   *
   * The client POSTs the image file (PNG/JPEG/WEBP ≤2 MB) directly to the
   * Worker, gets back a CDN URL, then includes that URL in the next
   * `sendMessage` call via the `attachments` array.
   *
   * Authorization: `assertThreadMember` — the caller must already be a member
   * of the thread (system_admin bypass still requires tenant match per
   * `assertMessengerTenantAccess` inside `assertThreadMember`).
   */
  mintAttachmentUploadToken: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      threadId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // IU-6: per-user limiter before any work.
      const rl = await checkRateLimit(ctx.db, ctx.webUser!.id, "messenger_mint_upload", RL_MINT_MAX, RL_MINT_WINDOW_MS);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many upload requests. Try again later." });
      }

      await assertThreadMember(ctx, input.tenantId, input.threadId);

      if (!env.UPLOAD_TOKEN_SECRET) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "UPLOAD_TOKEN_SECRET not configured on admin-app",
        });
      }
      if (!env.WORKER_PUBLIC_URL) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "WORKER_PUBLIC_URL not configured on admin-app",
        });
      }

      const token = await signUploadToken({
        tid: input.tenantId,
        kind: "chat_attachment",
        secret: env.UPLOAD_TOKEN_SECRET,
        uid: ctx.webUser?.id,
      });
      const base = env.WORKER_PUBLIC_URL.replace(/\/$/, "");
      return {
        token,
        uploadUrl: `${base}/upload/asset?t=${encodeURIComponent(token)}&kind=chat_attachment`,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  STAFF DIRECTORY — for "+ New chat" picker
  // ═══════════════════════════════════════════════════════════════
  //  Returns the FULL salon staff so the picker reflects reality:
  //
  //   - Every active `masters` row (origin/web-link agnostic). Includes:
  //       * web-linked masters → rendered as DM-able (canDm=true).
  //       * Telegram-paired masters with no web account → rendered as
  //         disabled-DM "placeholder" candidates (canDm=false). Clicking
  //         them in the UI opens a placeholder thread that the master
  //         joins once they create a web account (see `createStaffDm
  //         { otherMasterChatId }` for the placeholder branch).
  //   - The `tenant_owner` web_user, even when they don't have a
  //     corresponding `masters` row (most owners don't).
  //   - Caller is filtered out via `id !== webUserId` so they can't DM
  //     themselves.
  //
  //  Source of truth = `masters` + `web_users WHERE role='tenant_owner'`,
  //  NOT `web_users.tenant_id = salon`. The previous implementation only
  //  joined on `web_users.tenant_id`, which silently dropped every master
  //  whose `web_users.tenant_id` resolves to a personal tenant (a master
  //  who self-registered before being invited to a salon — the most common
  //  path for the `invited_email`/Scenario A accept flow).
  //
  //  pendingInviteCount = pending (not expired) email invites where the
  //  invitee hasn't yet accepted → drives the "N invitations not accepted"
  //  hint copy.
  //
  //  Returned candidate shape:
  //    {
  //      id, refKind, masterChatId?, name, email, role, canDm, connectStatus
  //    }
  //  where:
  //    refKind        = 'web_user' | 'master' — distinguishes a real
  //                     web-DM target from a placeholder.
  //    masterChatId   = (only when refKind='master') masters.chat_id as
  //                     string; the UI passes it back to
  //                     `createStaffDm({ otherMasterChatId })`.
  //    canDm          = true iff a web_user exists.
  //    connectStatus  = 'connected' | 'telegram_only' | 'pending_invite'
  //
  //  Query order (locked by `messenger-list-staff.test.ts`):
  //    1. masters             — active rows in tenant
  //    2. web_users           — by IN (master.webUserId), or sentinel-false
  //                              when no webUserIds (kept for deterministic
  //                              SELECT count so mocks don't drift)
  //    3. tenant_owner row    — web_users WHERE tenant_id AND role
  //    4. master_invitations  — count(pending, not expired)
  listStaff: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertMessengerTenantAccess(ctx, input.tenantId);
      const callerWebUserId = ctx.webUser!.id;

      // 1 — active masters in this tenant.
      const masterRows = await ctx.db
        .select({
          chatId: masters.chatId,
          name: masters.name,
          webUserId: masters.webUserId,
          isSynthetic: masters.isSynthetic,
          origin: masters.origin,
          telegramChatId: masters.telegramChatId,
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), isNull(masters.archivedAt)));

      // 2 — web_users for masters that have a web account.
      //
      // We always issue the SELECT (with a `1=0` sentinel when there are no
      // webUserIds) so the SELECT count is deterministic. That keeps the test
      // mocks simple: every code path issues exactly four SELECTs in the same
      // order regardless of whether intermediate sets are empty.
      const webUserIds = masterRows
        .map((m) => m.webUserId)
        .filter((id): id is string => id != null);
      const webUserRows = await ctx.db
        .select({
          id: webUsers.id,
          name: webUsers.name,
          email: webUsers.email,
          tenantId: webUsers.tenantId,
          role: webUsers.role,
        })
        .from(webUsers)
        .where(webUserIds.length ? inArray(webUsers.id, webUserIds) : sql`1=0`);
      const webUserById = new Map(webUserRows.map((u) => [u.id, u]));

      // 3 — tenant_owner web_user (so owners without a `masters` row are
      // still visible to masters as a DM target).
      const ownerRows = await ctx.db
        .select({
          id: webUsers.id,
          name: webUsers.name,
          email: webUsers.email,
          tenantId: webUsers.tenantId,
          role: webUsers.role,
        })
        .from(webUsers)
        .where(and(eq(webUsers.tenantId, input.tenantId), eq(webUsers.role, "tenant_owner")));

      // 4 — pending invitations count.
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

      // ── Build candidate list ─────────────────────────────────────────

      type Candidate = {
        id: string;
        refKind: "web_user" | "master";
        masterChatId?: string;
        name: string;
        email: string | null;
        role: string;
        canDm: boolean;
        connectStatus: "connected" | "telegram_only" | "pending_invite";
      };

      const seenWebUserIds = new Set<string>();
      const candidates: Candidate[] = [];

      for (const m of masterRows) {
        if (m.webUserId) {
          const u = webUserById.get(m.webUserId);
          // web account exists — DM-able (canDm=true).
          const displayName =
            u?.name ?? m.name ?? u?.email ?? String(m.chatId);
          candidates.push({
            id: m.webUserId,
            refKind: "web_user",
            name: displayName,
            email: u?.email ?? null,
            role: u?.role ?? "master",
            canDm: true,
            connectStatus: "connected",
          });
          seenWebUserIds.add(m.webUserId);
        } else {
          // No web account — placeholder. The UI shows them with a
          // "Только Telegram" chip; clicking opens a placeholder thread
          // (see createStaffDm `{ otherMasterChatId }`).
          candidates.push({
            id: String(m.chatId),
            refKind: "master",
            masterChatId: String(m.chatId),
            name: m.name ?? String(m.chatId),
            email: null,
            role: "master",
            canDm: false,
            connectStatus: "telegram_only",
          });
        }
      }

      // Owner row (deduped against masters → web_user already pushed).
      for (const o of ownerRows) {
        if (seenWebUserIds.has(o.id)) continue;
        candidates.push({
          id: o.id,
          refKind: "web_user",
          name: o.name ?? o.email ?? o.id,
          email: o.email,
          role: o.role,
          canDm: true,
          connectStatus: "connected",
        });
        seenWebUserIds.add(o.id);
      }

      // Self-filter + stable sort: DM-able first, placeholders after.
      const visible = candidates.filter((c) => c.id !== callerWebUserId);
      visible.sort((a, b) => Number(b.canDm) - Number(a.canDm));

      return { candidates: visible, pendingInviteCount };
    }),
});
