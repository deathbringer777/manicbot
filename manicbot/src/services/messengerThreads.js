/**
 * @fileoverview Internal messenger — Worker-side helpers (migration 0067).
 *
 * Mirrors the admin-app's tRPC writes to threads / thread_members /
 * thread_messages from the Worker side. Called by `handleInbound` after
 * `upsertConversation` resolves, so every inbound client message lands in
 * the `/messages` UI as a `client_conv` thread.
 *
 * Idempotency:
 *  - Thread row is unique per (tenant_id, client_conversation_id) via partial
 *    UNIQUE index `idx_threads_client_conv_unique`. We SELECT-first + INSERT
 *    on miss; if a race fires the unique violation, we catch + re-SELECT.
 *  - thread_members rows have a composite primary key — duplicates are no-ops
 *    via `INSERT OR IGNORE`.
 *  - thread_messages keyed by ULID PRIMARY KEY — generated server-side.
 *
 * Failure posture: every helper logs and swallows. Inbound dispatch must
 * ACK Telegram / Meta within their retry budget; a messenger write hiccup
 * is not allowed to 500 the webhook.
 */

import { dbAll, dbGet, dbRunSafe } from '../utils/db.js';
import { ulid } from '../utils/ulid.js';
import { log } from '../utils/logger.js';

const PREVIEW_MAX = 200;

function previewBody(s) {
  if (!s) return '';
  const oneLine = String(s).replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_MAX ? oneLine.slice(0, PREVIEW_MAX) : oneLine;
}

/**
 * Compute the external_client member_ref string from channel info.
 * Mirrors the format used by `assertThreadMember` / member_ref column.
 * @param {string} channelType - 'telegram' | 'whatsapp' | 'instagram' | 'web'
 * @param {string|number} channelUserId
 */
export function externalClientRef(channelType, channelUserId) {
  return `${channelType}:${channelUserId}`;
}

/**
 * Find the canonical `conversations` row for this external user. Returns the
 * OLDEST row (lowest created_at) so multiple races still resolve to the same
 * id — the existing `upsertConversation` helper sometimes inserts duplicate
 * rows (it lacks a UNIQUE on the natural key), so we deterministically pick
 * the first one as the link target.
 *
 * @returns {Promise<string|null>} conversations.id
 */
async function resolveConversationId(ctx, tenantId, channelType, channelUserId) {
  if (!ctx?.db || !tenantId || !channelType || channelUserId == null) return null;
  const rows = await dbAll(
    ctx,
    `SELECT id FROM conversations
       WHERE tenant_id = ? AND channel_type = ? AND channel_user_id = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    tenantId, channelType, String(channelUserId),
  );
  return rows[0]?.id ?? null;
}

/**
 * Find existing client_conv thread for a conversation id, or null.
 */
async function findClientConvThread(ctx, tenantId, conversationId) {
  if (!ctx?.db || !tenantId || !conversationId) return null;
  const rows = await dbAll(
    ctx,
    `SELECT id, tenant_id, kind, client_conversation_id, last_message_at, last_message_preview
       FROM threads
       WHERE tenant_id = ? AND client_conversation_id = ? AND kind = 'client_conv'
       LIMIT 1`,
    tenantId, conversationId,
  );
  return rows[0] ?? null;
}

/**
 * Upsert the `client_conv` thread for an inbound channel message + write
 * a thread_messages row for the user's message. Idempotent.
 *
 * Steps:
 *  1. Resolve conversations.id (must exist — caller serializes after upsertConversation).
 *  2. Find or create the thread row.
 *  3. Ensure thread_members has an `external_client` member for the sender.
 *  4. Add ALL active web_users on the tenant as `web_user` members (INSERT OR IGNORE).
 *  5. Insert a `thread_messages` row with sender_kind='external_client'.
 *  6. Update threads.last_message_at + last_message_preview.
 *
 * @param {object} ctx - Tenant context (has `db`)
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.channelType - 'telegram' | 'whatsapp' | 'instagram' | 'web'
 * @param {string} params.channelUserId
 * @param {string=} params.displayName - sender display name (for member row)
 * @param {string=} params.body - message text (empty for media-only)
 * @param {string=} params.externalMsgId - upstream message id (for dedup)
 * @returns {Promise<{threadId: string, messageId: string|null}|null>}
 */
export async function upsertClientConvThreadForInbound(ctx, params) {
  if (!ctx?.db || !params?.tenantId || !params?.channelType || params?.channelUserId == null) {
    return null;
  }
  const { tenantId, channelType, channelUserId, displayName, body, externalMsgId } = params;
  const now = Math.floor(Date.now() / 1000);

  try {
    const conversationId = await resolveConversationId(ctx, tenantId, channelType, channelUserId);
    if (!conversationId) {
      // upsertConversation should have written one; if not, bail and let the
      // next inbound try again. Don't synthesize a fake id here — that would
      // diverge from the canonical conversations row.
      return null;
    }

    let thread = await findClientConvThread(ctx, tenantId, conversationId);
    let threadId;

    if (!thread) {
      threadId = `th_${ulid()}`;
      try {
        await dbRunSafe(ctx,
          `INSERT INTO threads
             (id, tenant_id, kind, title, client_conversation_id, dm_key,
              created_by_web_user_id, created_at, last_message_at,
              last_message_preview, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          threadId, tenantId, 'client_conv', null, conversationId, null, null,
          now, now, previewBody(body ?? ''), 0,
        );
      } catch (e) {
        // Race with another inbound — partial UNIQUE fired. Re-select.
        thread = await findClientConvThread(ctx, tenantId, conversationId);
        if (!thread) {
          log.error('messengerThreads.upsert', e instanceof Error ? e : new Error(String(e?.message)), {
            action: 'thread_insert_race',
            tenantId, conversationId,
          });
          return null;
        }
        threadId = thread.id;
      }
    } else {
      threadId = thread.id;
    }

    const extRef = externalClientRef(channelType, channelUserId);

    // External-client member (one row per channel user).
    await dbRunSafe(ctx,
      `INSERT INTO thread_members
         (thread_id, member_kind, member_ref, role, joined_at, muted_until,
          last_read_message_id, last_read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, member_kind, member_ref) DO NOTHING`,
      threadId, 'external_client', extRef, 'member', now, null, null, null,
    ).catch((e) => {
      log.warn('messengerThreads.upsert', { action: 'external_member_upsert', error: e?.message });
    });

    // Add all web_users on the tenant as members. INSERT OR IGNORE on the
    // composite primary key dedupes silently. This is the simplest visibility
    // model — Phase 4 will allow per-thread assignment.
    const staff = await dbAll(
      ctx,
      'SELECT id FROM web_users WHERE tenant_id = ?',
      tenantId,
    ).catch(() => []);
    for (const u of staff) {
      await dbRunSafe(ctx,
        `INSERT INTO thread_members
           (thread_id, member_kind, member_ref, role, joined_at, muted_until,
            last_read_message_id, last_read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, member_kind, member_ref) DO NOTHING`,
        threadId, 'web_user', u.id, 'member', now, null, null, null,
      ).catch((e) => {
        log.warn('messengerThreads.upsert', { action: 'staff_member_upsert', error: e?.message });
      });
    }

    // Insert the inbound thread_messages row. Skip if body is empty AND no
    // attachments (media-only messages are still recorded as a placeholder so
    // the timeline doesn't have holes).
    const messageBody = (body && String(body).trim()) ||
      (params.placeholder ? params.placeholder : '[медиа]');
    const messageId = ulid();
    await dbRunSafe(ctx,
      `INSERT INTO thread_messages
         (id, thread_id, tenant_id, sender_kind, sender_ref, body, attachments_json,
          is_internal_note, external_msg_id, reply_to_message_id, created_at,
          edited_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      messageId, threadId, tenantId, 'external_client', extRef, messageBody, null,
      0, externalMsgId ?? null, null, now, null, null,
    );

    // Touch the thread for inbox ordering.
    await dbRunSafe(ctx,
      `UPDATE threads
          SET last_message_at = ?, last_message_preview = ?, archived = 0
        WHERE id = ?`,
      now, previewBody(messageBody), threadId,
    );

    return { threadId, messageId };
  } catch (e) {
    log.error('messengerThreads.upsert',
      e instanceof Error ? e : new Error(String(e?.message)),
      { action: 'upsertClientConvThreadForInbound', tenantId: params.tenantId });
    return null;
  }
}

/**
 * Insert an outbound (staff → client) message into thread_messages without
 * triggering a re-send loop. Used by the outbound relay HTTP endpoint to
 * stamp `external_msg_id` after the channel adapter returns it.
 *
 * Caller is responsible for verifying the thread exists in the tenant.
 *
 * @param {object} ctx
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.threadId
 * @param {string} params.body
 * @param {string} params.externalMsgId
 * @param {string=} params.replyToMessageId
 * @returns {Promise<{messageId: string}|null>}
 */
export async function appendOutboundStaffMessage(ctx, params) {
  if (!ctx?.db || !params?.tenantId || !params?.threadId || !params?.body) return null;
  const now = Math.floor(Date.now() / 1000);
  const messageId = ulid();
  try {
    await dbRunSafe(ctx,
      `INSERT INTO thread_messages
         (id, thread_id, tenant_id, sender_kind, sender_ref, body, attachments_json,
          is_internal_note, external_msg_id, reply_to_message_id, created_at,
          edited_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      messageId, params.threadId, params.tenantId, 'system', 'channel-relay',
      params.body, null, 0, params.externalMsgId, params.replyToMessageId ?? null,
      now, null, null,
    );
    await dbRunSafe(ctx,
      `UPDATE threads
          SET last_message_at = ?, last_message_preview = ?
        WHERE id = ?`,
      now, previewBody(params.body), params.threadId,
    );
    return { messageId };
  } catch (e) {
    log.error('messengerThreads.append_outbound',
      e instanceof Error ? e : new Error(String(e?.message)),
      { action: 'appendOutboundStaffMessage', tenantId: params.tenantId });
    return null;
  }
}

/**
 * Stamp the external_msg_id on a thread_messages row after the channel
 * adapter returns one. Used by the outbound relay to close the loop.
 *
 * @param {object} ctx
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.threadId
 * @param {string} params.messageId - the thread_messages.id to stamp
 * @param {string} params.externalMsgId
 */
export async function stampExternalMsgId(ctx, params) {
  if (!ctx?.db || !params?.messageId || !params?.externalMsgId) return false;
  try {
    await dbRunSafe(ctx,
      `UPDATE thread_messages
          SET external_msg_id = ?
        WHERE id = ? AND tenant_id = ? AND thread_id = ?`,
      params.externalMsgId, params.messageId, params.tenantId, params.threadId,
    );
    return true;
  } catch (e) {
    log.warn('messengerThreads.stamp_external', { error: e?.message });
    return false;
  }
}

/**
 * Advance the persisted delivery_state of an OUTBOUND message, keyed by its
 * channel-side external_msg_id (WhatsApp wamid / Instagram mid). Called from
 * the Meta webhook handler on delivered/read/failed receipts.
 *
 * Terminal-guarded: only moves forward from 'pending'/'sent' (never downgrades
 * a 'delivered', never resurrects a 'failed' or an untracked/NULL row).
 * Idempotent — safe to call on Meta's webhook retries.
 *
 * @param {object} ctx - has `db`
 * @param {string} tenantId
 * @param {string} externalMsgId - wamid / IG mid
 * @param {'delivered'|'failed'} state
 * @param {string|null} [error] - channel error label when state='failed'
 * @returns {Promise<boolean>}
 */
export async function markOutboundDeliveryState(ctx, tenantId, externalMsgId, state, error = null) {
  if (!ctx?.db || !tenantId || !externalMsgId) return false;
  if (state !== 'delivered' && state !== 'failed') return false;
  // Single-line SQL + an OR'd two-state guard (rather than IN) — both keep the
  // statement parseable by the D1 test mock while remaining valid D1 SQL. The
  // guard only advances from pending/sent, so NULL/delivered/failed are inert.
  const guard = `(delivery_state = 'pending' OR delivery_state = 'sent')`;
  const res = state === 'failed'
    ? await dbRunSafe(ctx,
        `UPDATE thread_messages SET delivery_state = ?, delivery_error = ? WHERE tenant_id = ? AND external_msg_id = ? AND ${guard}`,
        'failed', error, tenantId, String(externalMsgId))
    : await dbRunSafe(ctx,
        `UPDATE thread_messages SET delivery_state = ? WHERE tenant_id = ? AND external_msg_id = ? AND ${guard}`,
        'delivered', tenantId, String(externalMsgId));
  return res?.ok !== false;
}

/**
 * Set the delivery outcome of a specific outbound row by its id. Used by the
 * outbound-retry queue consumer to resolve a 'pending' row to 'sent' (stamping
 * the channel-side id) or 'failed' after the retry budget is exhausted.
 *
 * @param {object} ctx
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.messageId - thread_messages.id (admin-app's row)
 * @param {'sent'|'failed'} params.state
 * @param {string|null} [params.externalMsgId]
 * @param {string|null} [params.error]
 * @returns {Promise<boolean>}
 */
export async function setOutboundDeliveryByMessageId(ctx, params) {
  if (!ctx?.db || !params?.tenantId || !params?.messageId) return false;
  if (params.state !== 'sent' && params.state !== 'failed') return false;
  // Single-line SQL + all `col = ?` SET clauses (mock parser compatible).
  const res = params.state === 'sent'
    ? await dbRunSafe(ctx,
        `UPDATE thread_messages SET delivery_state = ?, external_msg_id = ?, delivery_error = ? WHERE id = ? AND tenant_id = ?`,
        'sent', params.externalMsgId ?? null, null, params.messageId, params.tenantId)
    : await dbRunSafe(ctx,
        `UPDATE thread_messages SET delivery_state = ?, delivery_error = ? WHERE id = ? AND tenant_id = ?`,
        'failed', params.error ?? null, params.messageId, params.tenantId);
  return res?.ok !== false;
}

/**
 * Look up a client_conv thread by id; returns the channel_type +
 * channel_user_id so the outbound relay can pick the right adapter +
 * target. Returns null if the thread doesn't exist OR isn't a client_conv.
 *
 * @param {object} ctx
 * @param {string} tenantId
 * @param {string} threadId
 * @returns {Promise<{conversationId: string, channelType: string, channelUserId: string}|null>}
 */
export async function lookupClientConvTarget(ctx, tenantId, threadId) {
  if (!ctx?.db || !tenantId || !threadId) return null;
  const thread = await dbGet(
    ctx,
    `SELECT id, kind, client_conversation_id FROM threads
       WHERE id = ? AND tenant_id = ? AND kind = 'client_conv' LIMIT 1`,
    threadId, tenantId,
  ).catch(() => null);
  if (!thread?.client_conversation_id) return null;
  const conv = await dbGet(
    ctx,
    `SELECT id, channel_type, channel_user_id FROM conversations
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
    thread.client_conversation_id, tenantId,
  ).catch(() => null);
  if (!conv) return null;
  return {
    conversationId: conv.id,
    channelType: conv.channel_type,
    channelUserId: conv.channel_user_id,
  };
}
