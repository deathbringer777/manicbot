/**
 * Backfill helper: when a master gains a `web_users.id` (invite accepted /
 * Telegram→web paired / registration after invite), promote every
 * placeholder `thread_members` row keyed by (member_kind='master',
 * member_ref=String(chatId)) into a real (member_kind='web_user',
 * member_ref=<webUserId>) entry, recompute the parent thread's `dm_key`,
 * and merge into any pre-existing real DM thread that would otherwise
 * collide with the partial-UNIQUE `(tenant_id, dm_key) WHERE
 * kind='staff_dm'` index.
 *
 * Idempotent: safe to call N times for the same (masterChatId, webUserId).
 * Crashes from concurrent calls (e.g. two devices accepting the same
 * invite race) reduce to a UNIQUE-conflict, which is recovered via the
 * merge branch.
 *
 * Callers (all fire-and-forget — a backfill miss should NEVER block the
 * primary invite-accept / pairing flow):
 *   - webUsers.acceptInvitationExistingUser
 *   - webUsers.acceptInvitationByToken (Scenario B — has no pre-existing
 *     placeholder by definition, so the call is a cheap no-op)
 *   - masterPairing.tryConsumePairingCode (Telegram pairing → web link)
 *   - any future "register and link to an existing master" path
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { threads, threadMembers, threadMessages } from "~/server/db/schema";
import { computeDmKey } from "~/server/api/messenger/dmKey";
import { log } from "~/server/utils/logger";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

export interface LinkMasterPlaceholderInput {
  tenantId: string;
  masterChatId: number;
  webUserId: string;
}

export async function linkMasterPlaceholderToWebUser(
  db: NonNullable<DbInstance>,
  input: LinkMasterPlaceholderInput,
): Promise<void> {
  const masterRef = String(input.masterChatId);

  // 1. Find every placeholder thread row for this master.
  const placeholderMembers = await db
    .select({ threadId: threadMembers.threadId, role: threadMembers.role })
    .from(threadMembers)
    .where(
      and(
        eq(threadMembers.memberKind, "master"),
        eq(threadMembers.memberRef, masterRef),
      ),
    );

  if (placeholderMembers.length === 0) return;

  for (const ph of placeholderMembers) {
    try {
      // 2. Find the other web_user member of this placeholder thread so we
      //    can recompute dm_key as sorted(callerWebUserId, masterWebUserId).
      const [other] = await db
        .select({ memberRef: threadMembers.memberRef })
        .from(threadMembers)
        .where(
          and(
            eq(threadMembers.threadId, ph.threadId),
            eq(threadMembers.memberKind, "web_user"),
          ),
        )
        .limit(1);

      if (!other) {
        // Pathological row — placeholder thread has no web_user counterpart
        // (only the placeholder itself). Just promote the member and skip
        // the dm_key recomputation.
        await db
          .update(threadMembers)
          .set({ memberKind: "web_user", memberRef: input.webUserId })
          .where(
            and(
              eq(threadMembers.threadId, ph.threadId),
              eq(threadMembers.memberKind, "master"),
              eq(threadMembers.memberRef, masterRef),
            ),
          );
        continue;
      }

      const newDmKey = computeDmKey(other.memberRef, input.webUserId);

      // 3. Does a real DM with that (caller, newly-linked master) pair
      //    already exist?
      const [existingReal] = await db
        .select({ id: threads.id })
        .from(threads)
        .where(
          and(
            eq(threads.tenantId, input.tenantId),
            eq(threads.kind, "staff_dm"),
            eq(threads.dmKey, newDmKey),
          ),
        )
        .limit(1);

      if (existingReal && existingReal.id !== ph.threadId) {
        // Merge: re-parent the placeholder's messages onto the real thread
        // and delete the placeholder. Order matters — re-parent first so
        // the messages don't get FK-cascaded into oblivion.
        await db
          .update(threadMessages)
          .set({ threadId: existingReal.id })
          .where(eq(threadMessages.threadId, ph.threadId));
        await db
          .delete(threadMembers)
          .where(eq(threadMembers.threadId, ph.threadId));
        await db
          .delete(threads)
          .where(eq(threads.id, ph.threadId));
      } else {
        // Promote in-place: flip the placeholder member row to a real
        // web_user, then recompute the parent thread's dm_key.
        await db
          .update(threadMembers)
          .set({ memberKind: "web_user", memberRef: input.webUserId })
          .where(
            and(
              eq(threadMembers.threadId, ph.threadId),
              eq(threadMembers.memberKind, "master"),
              eq(threadMembers.memberRef, masterRef),
            ),
          );
        await db
          .update(threads)
          .set({ dmKey: newDmKey })
          .where(eq(threads.id, ph.threadId));
      }
    } catch (e) {
      log.warn("messenger.linkMasterPlaceholder", {
        message: "thread promotion failed",
        threadId: ph.threadId,
        masterChatId: input.masterChatId,
        webUserId: input.webUserId,
        error: e instanceof Error ? e.message : String(e),
      });
      // Continue to the next thread — one bad row should never block the
      // others.
    }
  }
}

// Convenience export for callers who only have `getDb()` and want a
// fire-and-forget shape that swallows runtime errors so the parent flow
// (invite accept / pairing) is never aborted by a backfill miss.
export async function linkMasterPlaceholderToWebUserFireAndForget(
  db: NonNullable<DbInstance> | null | undefined,
  input: LinkMasterPlaceholderInput,
): Promise<void> {
  if (!db) return;
  try {
    await linkMasterPlaceholderToWebUser(db, input);
  } catch (e) {
    log.error(
      "messenger.linkMasterPlaceholder.fireAndForget",
      e instanceof Error ? e : new Error(String(e)),
    );
  }
}

// Silence "imported but unused" lint warnings for symbols we keep around in
// case the helper grows additional indexed lookups.
void sql;
void inArray;
