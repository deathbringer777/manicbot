/**
 * Inbound IG/FB comment ingestion for the @manicbot_com social automation.
 *
 * Meta delivers comment events under entry[].changes[] (NOT entry[].messaging[]):
 *   - Instagram: change.field === 'comments'
 *   - Facebook Page: change.field === 'feed' with value.item === 'comment'
 *
 * This module parses those payloads into a normalized shape and writes 'new'
 * rows to the comment-inbox table. The ThinkPad `comment-responder` cron then
 * pulls them, classifies + drafts a reply via `claude -p`, and pushes the reply
 * back; the Worker posts it. Posting tokens never leave the Worker.
 */

import { claimMetaMessage } from '../utils/dedup.js';
import { log } from '../utils/logger.js';

/**
 * Normalize an IG `comments` or FB `feed` webhook change into a common shape.
 * Returns null for anything that is not a brand-new comment.
 *
 * @param {'instagram'|'facebook'} channelType
 * @param {{ field?: string, value?: any }} change
 * @returns {{ commentId: string, mediaId: string|null, parentId: string|null,
 *   fromUserId: string|null, fromUsername: string|null, text: string } | null}
 */
export function parseCommentChange(channelType, change) {
  if (!change || typeof change !== 'object') return null;
  const v = change.value || {};

  if (channelType === 'instagram') {
    if (change.field !== 'comments' || !v.id) return null;
    return {
      commentId: String(v.id),
      mediaId: v.media?.id ? String(v.media.id) : null,
      parentId: v.parent_id ? String(v.parent_id) : null,
      fromUserId: v.from?.id ? String(v.from.id) : null,
      fromUsername: v.from?.username ?? null,
      text: typeof v.text === 'string' ? v.text : '',
    };
  }

  if (channelType === 'facebook') {
    // The 'feed' field fires for posts, likes, comments, edits, removals.
    // Only act on a freshly-added comment.
    if (change.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add' || !v.comment_id) return null;
    return {
      commentId: String(v.comment_id),
      mediaId: v.post_id ? String(v.post_id) : null,
      parentId: v.parent_id ? String(v.parent_id) : null,
      fromUserId: v.from?.id ? String(v.from.id) : null,
      fromUsername: v.from?.name ?? null,
      text: typeof v.message === 'string' ? v.message : '',
    };
  }

  return null;
}

/**
 * Parse → dedup → persist one inbound comment.
 *
 * @param {object} env - Worker env (needs DB; MANICBOT for the dedup backend)
 * @param {object} args
 * @param {string|null} [args.tenantId] - NULL for the @manicbot_com platform account
 * @param {'instagram'|'facebook'} args.channelType
 * @param {string} args.pageId - IG account id / FB page id (dedup namespace)
 * @param {string|null} [args.ownerId] - our own IG/FB id, to skip our own comments
 * @param {{ field?: string, value?: any }} args.change
 * @param {number} [args.nowMs]
 * @returns {Promise<{ ingested: boolean, reason?: string, commentId?: string }>}
 */
export async function ingestComment(env, { tenantId = null, channelType, pageId, ownerId = null, change, nowMs = Date.now() }) {
  const c = parseCommentChange(channelType, change);
  if (!c) return { ingested: false, reason: 'unparseable' };

  // Never react to our own comments/replies.
  if (ownerId && c.fromUserId && String(c.fromUserId) === String(ownerId)) {
    return { ingested: false, reason: 'own_comment' };
  }

  // Dedup — Meta retries webhooks for up to 24h; comment_id is globally unique.
  const fresh = await claimMetaMessage(
    { MANICBOT: env.MANICBOT, DB: env.DB }, String(pageId), `comment:${c.commentId}`,
  );
  if (!fresh) return { ingested: false, reason: 'duplicate' };

  const nowSec = Math.floor(nowMs / 1000);
  try {
    await env.DB.prepare(
      // tenant-scan-ignore: signature-verified webhook write; stamps the row's own tenant_id from page resolution (platform @manicbot_com → NULL). No cross-tenant read.
      `INSERT OR IGNORE INTO social_comment_inbox
       (id, tenant_id, channel_type, media_id, comment_id, parent_id, from_user_id, from_username, text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    )
      .bind(
        `sci_${c.commentId}`, tenantId, channelType, c.mediaId, c.commentId, c.parentId,
        c.fromUserId, c.fromUsername, c.text, nowSec, nowSec,
      )
      .run();
  } catch (e) {
    log.error('channels.commentIngest', e instanceof Error ? e : new Error(String(e?.message || e)), {
      stage: 'insert', commentId: c.commentId, channelType,
    });
    return { ingested: false, reason: 'insert_error' };
  }

  log.info('channels.commentIngest', { stage: 'ingested', channelType, commentId: c.commentId });
  return { ingested: true, commentId: c.commentId };
}
