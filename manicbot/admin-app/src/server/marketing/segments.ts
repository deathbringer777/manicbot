/**
 * Shared manual-list (marketing_segment) membership ops.
 *
 * Both surfaces that mutate a Brevo-style `kind='manual'` list call through
 * here so the dedup + denormalized-count logic lives in exactly one place:
 *
 *   * Marketing module — `marketingTenant.segmentAddContacts/RemoveContacts`
 *   * Salon Clients tab — `clients.addToList/removeFromList` (resolves each
 *     client's `marketing_contact_id` first, then delegates here)
 *
 * Tenant model: the CALLER is responsible for verifying that `segmentId`
 * belongs to `tenantId` (it SELECTs the segment row and compares tenantId,
 * raising FORBIDDEN). This helper enforces the *contact*-side guard —
 * contact ids that don't belong to `tenantId` are silently dropped so a
 * crafted id from another tenant can't be folded into an audience.
 *
 * `marketing_segment_members` has no `tenant_id` column by design (members
 * are reachable only through the tenant-scoped segment / contact), which is
 * why this file lives outside `routers/` and is exempt from the router
 * tenant-isolation scanner — same pattern as `clients/marketingSync.ts`.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  marketingContacts,
  marketingSegmentMembers,
  marketingSegments,
  users,
} from "~/server/db/schema";

// Drizzle DB type intentionally widened to `any` — see the rationale in
// `clients/marketingSync.ts`. We only use .select/.insert/.update/.delete.
type Db = any;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Recompute the denormalized `contactCount` on a segment from its live
 * member rows so list cards render the true size without an extra query.
 */
async function recountSegment(db: Db, segmentId: string, t: number): Promise<number> {
  const cnt = await db
    .select({ count: sql<number>`count(*)` })
    .from(marketingSegmentMembers)
    .where(eq(marketingSegmentMembers.segmentId, segmentId));
  const count = Number(cnt[0]?.count ?? 0);
  await db
    .update(marketingSegments)
    .set({ contactCount: count, updatedAt: t })
    .where(eq(marketingSegments.id, segmentId));
  return count;
}

/**
 * Add contacts to a manual segment. Foreign-tenant contact ids are dropped;
 * already-member contacts are no-ops (the (segment_id, contact_id) PK makes
 * a duplicate insert an error, so we pre-check). Recomputes `contactCount`.
 *
 * @returns `{ added, skipped }` where `skipped = contactIds.length - added`
 *   (covers both foreign ids and existing members).
 */
export async function addContactsToSegment(
  db: Db,
  tenantId: string,
  segmentId: string,
  contactIds: number[],
  nowS: number = nowSec(),
): Promise<{ added: number; skipped: number }> {
  if (contactIds.length === 0) return { added: 0, skipped: 0 };

  // Restrict to contact ids that genuinely belong to this tenant.
  const allowed = await db
    .select({ id: marketingContacts.id })
    .from(marketingContacts)
    .where(and(
      eq(marketingContacts.tenantId, tenantId),
      inArray(marketingContacts.id, contactIds),
    ));
  const allowedIds = new Set<number>(allowed.map((r: { id: number }) => r.id));
  const ok = contactIds.filter((id) => allowedIds.has(id));

  let added = 0;
  for (const id of ok) {
    // D1 + Drizzle don't expose INSERT OR IGNORE uniformly, so pre-check.
    const exists = await db
      .select({ s: marketingSegmentMembers.segmentId })
      .from(marketingSegmentMembers)
      .where(and(
        eq(marketingSegmentMembers.segmentId, segmentId),
        eq(marketingSegmentMembers.contactId, id),
      ))
      .limit(1);
    if (exists[0]) continue;
    await db.insert(marketingSegmentMembers).values({
      segmentId,
      contactId: id,
      addedAt: nowS,
    });
    added++;
  }

  await recountSegment(db, segmentId, nowS);
  return { added, skipped: contactIds.length - added };
}

/**
 * Remove contacts from a manual segment by (segment_id, contact_id) and
 * recompute `contactCount`. No-op for empty input.
 */
export async function removeContactsFromSegment(
  db: Db,
  tenantId: string,
  segmentId: string,
  contactIds: number[],
  nowS: number = nowSec(),
): Promise<{ ok: true }> {
  // tenantId is part of the signature for call-site symmetry / future
  // hardening; the segment's tenant ownership is verified by the caller and
  // members are keyed by the opaque segmentId, so deletes are already scoped.
  void tenantId;
  if (contactIds.length === 0) return { ok: true };

  for (const id of contactIds) {
    await db
      .delete(marketingSegmentMembers)
      .where(and(
        eq(marketingSegmentMembers.segmentId, segmentId),
        eq(marketingSegmentMembers.contactId, id),
      ));
  }

  await recountSegment(db, segmentId, nowS);
  return { ok: true };
}

/**
 * Hard-delete a set of marketing contacts and everything that points at them.
 *
 * The CLIENT record in `users` is intentionally PRESERVED — this only removes
 * the marketing footprint (the salon's client history/metrics/logs are the
 * canonical record and stay intact). The `users.marketing_contact_id`
 * back-reference is nulled so a live client never dangles at a deleted row.
 *
 * Tenant model: the CALLER (router) has already run `assertTenantOwner`. This
 * helper enforces the contact-side guard — it re-SELECTs which of `contactIds`
 * actually belong to `tenantId` and operates ONLY on those, so a crafted
 * foreign id is silently dropped and cross-tenant deletion is impossible even
 * though `marketing_segment_members` has no `tenant_id` column. Lives outside
 * `routers/` (like the rest of this file) and is exempt from the router
 * tenant-isolation scanner.
 *
 * Cascade order (no FKs in SQLite here, so explicit):
 *   1. resolve the tenant-owned subset of ids
 *   2. delete segment_members for those ids + recount each affected segment
 *   3. null the `users.marketing_contact_id` back-reference (tenant-scoped)
 *   4. hard-delete the `marketing_contacts` rows (tenant-scoped WHERE)
 *
 * NOTE: a still-active linked client may re-sync a fresh contact later via
 * `marketingSync` — that is expected behaviour. For durable do-not-contact use
 * the unsubscribe flag (`marketingTenant.contactsSetSubscribed`), not delete.
 *
 * @returns `{ deleted }` — count of contacts actually removed (allowed subset).
 */
export async function deleteContacts(
  db: Db,
  tenantId: string,
  contactIds: number[],
  nowS: number = nowSec(),
): Promise<{ deleted: number }> {
  if (contactIds.length === 0) return { deleted: 0 };

  // 1. Restrict to ids that genuinely belong to this tenant.
  const allowed = await db
    .select({ id: marketingContacts.id })
    .from(marketingContacts)
    .where(and(
      eq(marketingContacts.tenantId, tenantId),
      inArray(marketingContacts.id, contactIds),
    ));
  const ok: number[] = allowed.map((r: { id: number }) => r.id);
  if (ok.length === 0) return { deleted: 0 };

  // 2. Which manual lists lose members? Capture them first so we can recount,
  //    then drop the membership rows for the deleted contacts.
  const memberRows = await db
    .select({ segmentId: marketingSegmentMembers.segmentId })
    .from(marketingSegmentMembers)
    .where(inArray(marketingSegmentMembers.contactId, ok));
  const affectedSegments = new Set<string>(
    memberRows.map((r: { segmentId: string }) => r.segmentId),
  );

  await db
    .delete(marketingSegmentMembers)
    .where(inArray(marketingSegmentMembers.contactId, ok));
  for (const segId of affectedSegments) {
    await recountSegment(db, segId, nowS);
  }

  // 3. Null the salon-client back-reference (tenant-scoped) so the still-living
  //    client row doesn't point at a contact we're about to delete.
  await db
    .update(users)
    .set({ marketingContactId: null, updatedAt: nowS })
    .where(and(
      eq(users.tenantId, tenantId),
      inArray(users.marketingContactId, ok),
    ));

  // 4. Hard-delete the contacts — never trust `ok` alone, re-scope by tenantId.
  await db
    .delete(marketingContacts)
    .where(and(
      eq(marketingContacts.tenantId, tenantId),
      inArray(marketingContacts.id, ok),
    ));

  return { deleted: ok.length };
}
