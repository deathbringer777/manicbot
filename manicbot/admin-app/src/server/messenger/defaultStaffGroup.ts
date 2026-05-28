/**
 * Default staff group ("Команда") — auto-seeded per tenant (migration 0093).
 *
 * Why this exists:
 *   Until now the only path to a salon-wide team chat was a manual modal
 *   that hid every master without a web account. New salons started with
 *   zero default chat surface, and new masters joined without anyone
 *   noticing.
 *
 * Surface:
 *   - `ensureDefaultStaffGroup(db, tenantId)` — find-or-create the one
 *     `staff_group` thread with `is_default_group=1` for the tenant.
 *     Idempotent. On first creation the tenant_owner is seeded as
 *     `role='owner'`. Returns `{ threadId, created }`.
 *   - `addMasterToDefaultGroup(db, tenantId, masterChatId)` — fire-and-
 *     forget add of a master to the default group. Picks `web_user` kind
 *     when the master already has a web_users row, otherwise `master`
 *     kind (mirrors `messenger.createStaffDm`'s placeholder branch).
 *     Idempotent via the composite PK on thread_members. Swallows
 *     errors so the parent master-creation mutation is never aborted by
 *     a backfill miss.
 *
 * Race semantics:
 *   `ensureDefaultStaffGroup` may run concurrently from two master-add
 *   mutations for the same tenant. Both will see "no group yet", both
 *   will INSERT — the second one trips the partial UNIQUE
 *   `(tenant_id) WHERE is_default_group=1` index, the catch branch
 *   re-SELECTs and returns the winner's threadId.
 */
import { and, eq } from "drizzle-orm";
import {
  threads,
  threadMembers,
  webUsers,
  masters,
} from "~/server/db/schema";
import { ulid } from "~/lib/ulid";
import { log } from "~/server/utils/logger";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;
type Db = NonNullable<DbInstance>;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export interface EnsureDefaultStaffGroupResult {
  threadId: string;
  created: boolean;
}

/**
 * Find-or-create the default "Команда" staff group for a tenant.
 *
 * Idempotent under concurrency: if two callers race the INSERT, the
 * partial UNIQUE index `(tenant_id) WHERE is_default_group=1` causes
 * the loser to fail and recover via re-SELECT.
 */
export async function ensureDefaultStaffGroup(
  db: Db,
  tenantId: string,
): Promise<EnsureDefaultStaffGroupResult> {
  const existing = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.tenantId, tenantId), eq(threads.isDefaultGroup, 1)))
    .limit(1);
  if (existing.length && existing[0]?.id) {
    return { threadId: existing[0].id, created: false };
  }

  const ownerRows = await db
    .select({ id: webUsers.id })
    .from(webUsers)
    .where(and(eq(webUsers.tenantId, tenantId), eq(webUsers.role, "tenant_owner")))
    .limit(1);
  const ownerWebUserId = ownerRows[0]?.id ?? null;

  const threadId = `th_${ulid()}`;
  const now = nowSec();

  try {
    await db.insert(threads).values({
      id: threadId,
      tenantId,
      kind: "staff_group",
      title: "Команда",
      clientConversationId: null,
      dmKey: null,
      createdByWebUserId: ownerWebUserId,
      createdAt: now,
      lastMessageAt: now,
      lastMessagePreview: null,
      archived: 0,
      isDefaultGroup: 1,
    });
  } catch (e) {
    // Race with another caller — recover by re-SELECT.
    const racedRows = await db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.tenantId, tenantId), eq(threads.isDefaultGroup, 1)))
      .limit(1);
    if (racedRows.length && racedRows[0]?.id) {
      return { threadId: racedRows[0].id, created: false };
    }
    throw e;
  }

  if (ownerWebUserId) {
    try {
      await db.insert(threadMembers).values({
        threadId,
        memberKind: "web_user",
        memberRef: ownerWebUserId,
        role: "owner",
        joinedAt: now,
        mutedUntil: null,
        lastReadMessageId: null,
        lastReadAt: null,
      });
    } catch (e) {
      // PK conflict means the owner row already exists — accept and move on.
      log.warn("defaultStaffGroup.ensureOwnerSeed", {
        message: "owner member insert failed (likely PK conflict)",
        tenantId,
        threadId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { threadId, created: true };
}

/**
 * Add a master to the tenant's default staff group. Fire-and-forget:
 * any failure is logged, NEVER thrown, so the calling master-creation
 * mutation always succeeds even when messenger seeding misbehaves.
 *
 * Picks the member kind by looking at the masters row:
 *   - has web_users.id → member_kind='web_user', member_ref=webUserId
 *   - telegram-only    → member_kind='master',   member_ref=String(chatId)
 *
 * The two-kind split mirrors `messenger.createStaffDm`'s placeholder
 * branch — `linkMasterPlaceholderToWebUser` will promote the master-kind
 * row to web_user once the master gains a web account.
 */
export async function addMasterToDefaultGroup(
  db: Db,
  tenantId: string,
  masterChatId: number,
): Promise<void> {
  try {
    const { threadId } = await ensureDefaultStaffGroup(db, tenantId);

    const masterRows = await db
      .select({ chatId: masters.chatId, webUserId: masters.webUserId })
      .from(masters)
      .where(and(eq(masters.tenantId, tenantId), eq(masters.chatId, masterChatId)))
      .limit(1);
    const masterRow = masterRows[0];
    if (!masterRow) {
      // No master row — nothing to add. Caller may be racing the insert;
      // a later retry (or `removeStaffMember`/refresh) will reconcile.
      return;
    }

    const memberKind: "web_user" | "master" = masterRow.webUserId ? "web_user" : "master";
    const memberRef: string = masterRow.webUserId
      ? masterRow.webUserId
      : String(masterRow.chatId);
    const now = nowSec();

    try {
      await db.insert(threadMembers).values({
        threadId,
        memberKind,
        memberRef,
        role: "member",
        joinedAt: now,
        mutedUntil: null,
        lastReadMessageId: null,
        lastReadAt: null,
      });
    } catch (e) {
      // Composite PK conflict (already a member) — idempotent no-op.
      log.warn("defaultStaffGroup.addMaster.memberInsert", {
        message: "thread_members insert failed (likely PK conflict)",
        tenantId,
        threadId,
        masterChatId,
        memberKind,
        memberRef,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (e) {
    log.error(
      "defaultStaffGroup.addMaster.fireAndForget",
      e instanceof Error ? e : new Error(String(e)),
      { tenantId, masterChatId },
    );
  }
}
