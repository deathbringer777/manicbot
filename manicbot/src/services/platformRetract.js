/**
 * platformRetract — God-Mode retract of a platform announcement / DM copy.
 *
 * `platform_thread_messages` has two writers: the admin-app `broadcast` mutation
 * (stamps a `bc_…` broadcast_id + a `platform_broadcasts` audit row) and the
 * Worker `deliverCenter` cron (stamps `${campaign.id}:${occurrenceKey}`). A bad
 * or test announcement leaves a copy in EVERY recipient's thread and a stale
 * `last_message_*` header on `platform_threads`. This module hard-deletes the
 * copies and RECOMPUTES each affected thread's denormalized header from the
 * newest remaining message (or nulls it when the thread is now empty).
 *
 * Scope: platform_* tables are PLATFORM-scoped (no `tenant_id`, migration 0076);
 * this is a system_admin / MESSAGING_TOKEN operation, so every cross-thread query
 * is annotated `// tenant-scan-ignore`. There is no FTS to maintain
 * (migration 0099 indexes `thread_messages`, not `platform_thread_messages`) and
 * no soft-delete column — a hard DELETE is complete.
 *
 * Non-goal: does NOT unclaim `platform_campaign_deliveries` ledger rows. The
 * admin-app broadcast path writes none; retracting a campaign fan-out leaves its
 * ledger claims intact (out of scope, and harmless — the messages are gone).
 */

import { dbGet, dbAll, dbRunSafe } from '../utils/db.js';
import { makePreview } from './platformCampaigns.js';

/**
 * Recompute one thread's `last_message_*` header from its newest remaining
 * message, or null all three when no message remains.
 *
 * Every SET value is bound as `?` on purpose: the test D1 mock's UPDATE parser
 * only honors the `col = ?` form and silently drops literal SET values (e.g.
 * `last_sender_kind = 'platform'`). Real D1 is indifferent to this.
 */
async function recomputeThreadHeader(ctx, threadId) {
  const newest = await dbGet(
    ctx,
    // tenant-scan-ignore: platform_thread_messages is PLATFORM-scoped (no tenant_id, migration 0076) — God-Mode retract recompute.
    'SELECT body, sender_kind, created_at FROM platform_thread_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    threadId,
  );
  await dbRunSafe(
    ctx,
    // tenant-scan-ignore: platform_threads is PLATFORM-scoped (recipient_tenant_id only, migration 0076) — God-Mode retract recompute.
    'UPDATE platform_threads SET last_message_at = ?, last_message_preview = ?, last_sender_kind = ? WHERE id = ?',
    newest ? newest.created_at : null,
    newest ? makePreview(newest.body) : null,
    newest ? newest.sender_kind : null,
    threadId,
  );
}

/**
 * Retract a broadcast fan-out (`broadcastId`) or a single message copy
 * (`messageId`), then recompute every affected thread's header. Idempotent:
 * a second call finds nothing and returns `{ removed: 0, threadsTouched: 0 }`.
 * Unknown ids are a no-op, never a throw.
 *
 * @param {object} ctx D1-bearing context (ctx.db)
 * @param {{ broadcastId?: string|null, messageId?: string|null }} target
 * @returns {Promise<{ removed: number, threadsTouched: number }>}
 */
export async function retractBroadcast(ctx, { broadcastId = null, messageId = null } = {}) {
  // 1. Collect the target copies (and the threads they live in) BEFORE deleting,
  //    so we know exactly which thread headers to recompute. Dedupe thread ids in
  //    JS — the test mock has no DISTINCT.
  let copies = [];
  if (messageId) {
    const row = await dbGet(
      ctx,
      // tenant-scan-ignore: platform_thread_messages is PLATFORM-scoped (no tenant_id, migration 0076) — God-Mode retract.
      'SELECT id, thread_id FROM platform_thread_messages WHERE id = ? LIMIT 1',
      messageId,
    );
    if (row) copies = [row];
  } else if (broadcastId) {
    copies = await dbAll(
      ctx,
      // tenant-scan-ignore: platform_thread_messages is PLATFORM-scoped (no tenant_id, migration 0076) — God-Mode retract.
      'SELECT id, thread_id FROM platform_thread_messages WHERE broadcast_id = ?',
      broadcastId,
    );
  }

  const threadIds = [...new Set(copies.map((c) => c.thread_id).filter(Boolean))];
  const removed = copies.length;

  // 2. Hard-delete the copies (and the audit row, for admin-app broadcasts).
  if (messageId) {
    if (removed > 0) {
      await dbRunSafe(
        ctx,
        // tenant-scan-ignore: God-Mode retract of a single platform message copy (no tenant_id, migration 0076).
        'DELETE FROM platform_thread_messages WHERE id = ?',
        messageId,
      );
    }
  } else if (broadcastId) {
    await dbRunSafe(
      ctx,
      // tenant-scan-ignore: God-Mode retract of an entire broadcast fan-out (no tenant_id, migration 0076).
      'DELETE FROM platform_thread_messages WHERE broadcast_id = ?',
      broadcastId,
    );
    // The audit row only exists for admin-app broadcasts; for campaign-style ids
    // (e.g. 'sys_welcome:once') this matches zero rows — a safe no-op.
    await dbRunSafe(
      ctx,
      // tenant-scan-ignore: platform_broadcasts is PLATFORM-scoped (no tenant_id, migration 0076) — God-Mode retract.
      'DELETE FROM platform_broadcasts WHERE id = ?',
      broadcastId,
    );
  }

  // 3. Recompute the denormalized header of every thread we touched.
  for (const threadId of threadIds) {
    await recomputeThreadHeader(ctx, threadId);
  }

  return { removed, threadsTouched: threadIds.length };
}
