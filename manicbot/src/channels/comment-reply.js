/**
 * Outbound replies to IG/FB comments via Meta Graph API.
 *
 *   - Instagram: POST /{ig-comment-id}/replies  { message }
 *   - Facebook:  POST /{fb-comment-id}/comments { message }
 *
 * Reuses the shared graph-api client (retry/backoff + token-dead detection).
 * The token prefix routes the host automatically (IGAA → graph.instagram.com,
 * EAA → graph.facebook.com), so no host wiring is needed at the call site.
 *
 * Used by the autonomous comment-reply phase, which posts replies the ThinkPad
 * `comment-responder` drafted (status 'drafted' → 'replied').
 */

import { graphPost } from './graph-api.js';
import { log } from '../utils/logger.js';

const LABEL = 'comment_reply';

/**
 * Reply to an Instagram comment.
 * @param {{ commentId: string, message: string, token: string }} input
 * @returns {Promise<{ ok: true, replyId: string } | { ok: false, error: string, tokenDead?: boolean, status?: number }>}
 */
export async function replyToIgComment({ commentId, message, token }) {
  return postReply(`/${encodeURIComponent(commentId)}/replies`, { commentId, message, token });
}

/**
 * Reply to a Facebook Page comment.
 * @param {{ commentId: string, message: string, token: string }} input
 * @returns {Promise<{ ok: true, replyId: string } | { ok: false, error: string, tokenDead?: boolean, status?: number }>}
 */
export async function replyToFbComment({ commentId, message, token }) {
  return postReply(`/${encodeURIComponent(commentId)}/comments`, { commentId, message, token });
}

/**
 * Dispatch a reply by channel type.
 * @param {{ channelType: 'instagram'|'facebook', commentId: string, message: string, token: string }} input
 */
export async function postCommentReply({ channelType, commentId, message, token }) {
  if (channelType === 'instagram') return replyToIgComment({ commentId, message, token });
  if (channelType === 'facebook') return replyToFbComment({ commentId, message, token });
  return { ok: false, error: `postCommentReply: unknown channelType ${channelType}` };
}

async function postReply(path, { commentId, message, token }) {
  if (!commentId || !message || !token) {
    return { ok: false, error: 'postReply: commentId, message, token required' };
  }
  const res = await graphPost(path, token, { message }, { label: LABEL });
  if (!res.ok) {
    log.error('channels.commentReply', new Error('reply failed'), {
      stage: 'post', path, status: res.status, errorCode: res.errorCode, tokenDead: res.tokenDead,
    });
    return { ok: false, error: res.error ?? 'unknown', tokenDead: res.tokenDead, status: res.status };
  }
  const replyId = res.data?.id;
  if (!replyId) return { ok: false, error: 'postReply: no id in Meta response' };
  log.info('channels.commentReply', { stage: 'post.ok', path, replyId });
  return { ok: true, replyId };
}
