/**
 * Messenger access guards. Composed on top of `assertTenantMember` from
 * `~/server/api/tenantAccess` so the tenant-scope logic stays in one place.
 *
 * Two layers:
 *   1. assertMessengerTenantAccess(ctx, tenantId)
 *        — any role with active membership in tenantId (owner / manager /
 *          master on personal tenant / system_admin) can OPEN the messenger
 *          for that tenant.
 *   2. assertThreadMember(ctx, tenantId, threadId)
 *        — additionally checks the caller's `web_user.id` is a row in
 *          `thread_members` for the thread. Required for read/write of
 *          individual thread bodies. system_admin bypasses (support escalation).
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { threadMembers, threads } from "~/server/db/schema";
import { assertTenantMember, type TenantAccessCtx } from "~/server/api/tenantAccess";

/**
 * Loaded thread row + the caller's member row. Returned by `assertThreadMember`
 * so callers don't re-query.
 */
export interface ResolvedThreadAccess {
  thread: {
    id: string;
    tenantId: string;
    kind: string;
    title: string | null;
    clientConversationId: string | null;
    dmKey: string | null;
    createdByWebUserId: string | null;
    createdAt: number;
    lastMessageAt: number | null;
    lastMessagePreview: string | null;
    archived: number;
  };
  member: {
    threadId: string;
    memberKind: string;
    memberRef: string;
    role: string;
    joinedAt: number;
    mutedUntil: number | null;
    lastReadMessageId: string | null;
    lastReadAt: number | null;
  } | null;
}

/**
 * Caller can open the messenger inbox for `tenantId`. Thin wrapper around
 * `assertTenantMember` — exists so we can extend with messenger-specific
 * checks later (e.g. tenant_manager permission key for messenger access).
 */
export async function assertMessengerTenantAccess(
  ctx: TenantAccessCtx,
  tenantId: string,
): Promise<void> {
  await assertTenantMember(ctx, tenantId);
}

/**
 * Caller can read/write a specific thread. Returns the thread row + the
 * caller's member row (or null when system_admin bypasses).
 *
 * - Verifies thread exists in `tenantId`.
 * - Verifies caller has a `thread_members` row.
 * - system_admin bypasses the membership check (support escalation) but the
 *   thread MUST still belong to `tenantId` so a cross-tenant id can't slip in.
 */
export async function assertThreadMember(
  ctx: TenantAccessCtx,
  tenantId: string,
  threadId: string,
): Promise<ResolvedThreadAccess> {
  if (!ctx.webUser) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!tenantId || !threadId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "tenantId and threadId required" });
  }

  // Always tenant-scope first so a wrong tenant id can't escalate.
  await assertMessengerTenantAccess(ctx, tenantId);

  const [thread] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.tenantId, tenantId)))
    .limit(1);

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }

  // system_admin bypass — they may not be a thread member, but they tenant-passed.
  if (ctx.webUser.webRole === "system_admin") {
    return { thread, member: null };
  }

  const [member] = await ctx.db
    .select()
    .from(threadMembers)
    .where(
      and(
        eq(threadMembers.threadId, threadId),
        eq(threadMembers.memberKind, "web_user"),
        eq(threadMembers.memberRef, ctx.webUser.id),
      ),
    )
    .limit(1);

  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this thread" });
  }
  return { thread, member };
}
