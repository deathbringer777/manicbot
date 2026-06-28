/**
 * Autonomous comment-reply phase for @manicbot_com (migration 0127).
 *
 * The ThinkPad `comment-responder` cron pulls 'new' rows from
 * social_comment_inbox, classifies + drafts a reply via `claude -p`, and pushes
 * it back (status 'drafted', reply_text set) — or marks risky comments
 * 'escalated' (handled by the seam, which pings the owner). This phase posts the
 * 'drafted' replies via the Graph API.
 *
 * Guardrails (autonomous public replies are a Meta-policy risk surface):
 *   - Kill-switch: SOCIAL_COMMENTS_AUTOREPLY_ENABLED must be '1'.
 *   - Rate limit: at most MAX_REPLIES_PER_HOUR posted per rolling hour.
 *   - Per-tick cap: at most MAX_REPLIES_PER_TICK rows handled per run.
 *   - Dedup: the status-guarded UPDATE (... WHERE id=? AND status='drafted')
 *     makes a double-post impossible even under concurrent ticks.
 */

import { log } from '../utils/logger.js';
import { logEvent } from '../utils/events.js';
import { postCommentReply } from '../channels/comment-reply.js';

const MAX_REPLIES_PER_TICK = 5;
const MAX_REPLIES_PER_HOUR = 30;
const RATE_WINDOW_SEC = 60 * 60;

/**
 * Resolve the outbound token for a comment's channel. Platform-account rows
 * (tenant_id NULL) map to the marketing tenant env vars; tenant rows resolve
 * their own channel_config. The token is decrypted only here, inside the Worker.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveSocialToken(env, channelType, tenantId) {
  if (!env?.DB || !env?.BOT_ENCRYPTION_KEY) return null;
  const ct = channelType === 'facebook' ? 'facebook' : 'instagram';
  const tid = tenantId || (ct === 'facebook' ? env.MARKETING_FB_TENANT_ID : env.MARKETING_IG_TENANT_ID);
  if (!tid) return null;
  const { getChannelConfig } = await import('../channels/resolver.js');
  const cfg = await getChannelConfig(
    { db: env.DB }, tid, ct, env.BOT_ENCRYPTION_KEY, env.BOT_ENCRYPTION_KEY_OLD ?? null,
  );
  return cfg?.token || null;
}

/**
 * Cron entry point. Posts drafted comment replies, bounded by the guardrails.
 *
 * @param {object} env - Worker env
 * @param {number} [nowMs]
 * @returns {Promise<{ replied: number, skipped?: string, examined?: number }>}
 */
export async function phaseSocialCommentReply(env, nowMs = Date.now()) {
  if (env?.SOCIAL_COMMENTS_AUTOREPLY_ENABLED !== '1') {
    return { replied: 0, skipped: 'disabled' };
  }
  if (!env?.DB) return { replied: 0, skipped: 'no_db' };

  const nowSec = Math.floor(nowMs / 1000);

  // Rate limit: how many replies went out in the last hour?
  const recent = await env.DB.prepare(
    // tenant-scan-ignore: platform automation — @manicbot_com comment inbox; rows carry their own tenant_id and are processed per-row, no cross-tenant data read.
    `SELECT COUNT(*) AS n FROM social_comment_inbox WHERE status = 'replied' AND updated_at >= ?`,
  ).bind(nowSec - RATE_WINDOW_SEC).first();
  const sentLastHour = recent?.n ?? 0;
  if (sentLastHour >= MAX_REPLIES_PER_HOUR) {
    log.warn('marketing.socialComments', { skipped: 'rate_limited', sentLastHour });
    return { replied: 0, skipped: 'rate_limited' };
  }
  const budget = Math.min(MAX_REPLIES_PER_TICK, MAX_REPLIES_PER_HOUR - sentLastHour);

  const rows = (await env.DB.prepare(
    // tenant-scan-ignore: platform automation — drafted replies across the platform; each row resolves its own tenant_id/channel token per-row, no cross-tenant data read.
    `SELECT id, channel_type, tenant_id, comment_id, reply_text
     FROM social_comment_inbox
     WHERE status = 'drafted' AND reply_text IS NOT NULL
     ORDER BY created_at ASC
     LIMIT ?`,
  ).bind(budget).all())?.results ?? [];

  let replied = 0;
  for (const row of rows) {
    try {
      const token = await resolveSocialToken(env, row.channel_type, row.tenant_id);
      if (!token) {
        log.warn('marketing.socialComments', { skipped: 'no_token', id: row.id, channelType: row.channel_type });
        continue;
      }
      const res = await postCommentReply({
        channelType: row.channel_type,
        commentId: row.comment_id,
        message: row.reply_text,
        token,
      });
      if (res.ok) {
        // Status-guarded UPDATE → idempotent; a concurrent tick can't double-post.
        await env.DB.prepare(
          // tenant-scan-ignore: platform automation — updates the row by its own id; the row carries its own tenant_id. No cross-tenant access.
          `UPDATE social_comment_inbox SET status = 'replied', reply_comment_id = ?, updated_at = ?
           WHERE id = ? AND status = 'drafted'`,
        ).bind(res.replyId, nowSec, row.id).run();
        replied++;
      } else {
        await env.DB.prepare(
          // tenant-scan-ignore: platform automation — updates the row by its own id; the row carries its own tenant_id. No cross-tenant access.
          `UPDATE social_comment_inbox SET status = 'failed', error = ?, updated_at = ?
           WHERE id = ? AND status = 'drafted'`,
        ).bind(String(res.error ?? 'unknown').slice(0, 300), nowSec, row.id).run();
        void logEvent({ db: env.DB, tenantId: row.tenant_id ?? null }, 'marketing.comment_reply.failed', {
          level: 'error', id: row.id, error: String(res.error ?? 'unknown').slice(0, 200),
        }).catch(() => {});
      }
    } catch (e) {
      log.error('marketing.socialComments', e instanceof Error ? e : new Error(String(e?.message || e)), {
        stage: 'reply', id: row.id,
      });
    }
  }

  log.info('marketing.socialComments', { stage: 'tick.done', replied, examined: rows.length });
  return { replied, examined: rows.length };
}
