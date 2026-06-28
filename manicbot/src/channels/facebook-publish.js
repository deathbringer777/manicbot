/**
 * Outbound Facebook Page publishing via Meta Graph API.
 *
 * Unlike Instagram (two-step container → publish), a Facebook Page photo post
 * is a single call:
 *   POST /{page-id}/photos  (url + caption + published=true) → { id, post_id }
 * `post_id` is the feed-story id we record; `id` is the underlying photo id
 * (used as a fallback when `post_id` is absent).
 *
 * Reuses the shared graph-api client (retry/backoff + token-dead detection).
 * The Page Access Token is an EAA token, so graphPost auto-routes to
 * graph.facebook.com — no host wiring needed at the call site.
 *
 * NOTE: requires a Meta App approved for `pages_manage_posts`, and a Facebook
 * Page Access Token (EAA) — distinct from the IGAA token used for Instagram.
 * The @manicbot_com channel today is `api: "instagram_direct"` (IG-only); a
 * separate Facebook-OAuth connection must be made before this can publish.
 */

import { graphPost, graphGet } from './graph-api.js';
import { log } from '../utils/logger.js';

const LABEL = 'facebook_publish';
// FB post text limit is ~63k; cap defensively well below to avoid Meta 400s
// while never rejecting normal marketing captions.
const FB_CAPTION_MAX = 5000;

/**
 * Publish a photo post to a Facebook Page.
 *
 * @param {{ pageId: string, imageUrl: string, caption: string, token: string }} input
 * @returns {Promise<{ ok: true, postId: string } | { ok: false, error: string, tokenDead?: boolean, status?: number }>}
 */
export async function createPhotoPost({ pageId, imageUrl, caption, token }) {
  if (!pageId || !imageUrl || !token) {
    return { ok: false, error: 'createPhotoPost: pageId, imageUrl, token required' };
  }
  if (caption && caption.length > FB_CAPTION_MAX) {
    return { ok: false, error: `createPhotoPost: caption too long (>${FB_CAPTION_MAX} chars)` };
  }

  const res = await graphPost(
    `/${encodeURIComponent(pageId)}/photos`,
    token,
    { url: imageUrl, caption: caption ?? '', published: true },
    { label: LABEL },
  );

  if (!res.ok) {
    log.error('marketing.facebookPublish', new Error('createPhotoPost failed'), {
      stage: 'create',
      status: res.status,
      errorCode: res.errorCode,
      errorType: res.errorType,
      tokenDead: res.tokenDead,
    });
    return { ok: false, error: res.error ?? 'unknown', tokenDead: res.tokenDead, status: res.status };
  }

  // Prefer the feed-story id (post_id); fall back to the photo id.
  const postId = res.data?.post_id || res.data?.id;
  if (!postId) {
    log.error('marketing.facebookPublish', new Error('no id in response'), {
      stage: 'create',
      dataKeys: Object.keys(res.data ?? {}),
    });
    return { ok: false, error: 'createPhotoPost: no id in Meta response' };
  }

  log.info('marketing.facebookPublish', { stage: 'create.ok', postId });
  return { ok: true, postId };
}

/**
 * Optional permalink lookup (after publish, returns the FB URL).
 * Used to fill marketing_content_plan.fb_permalink.
 *
 * @param {{ postId: string, token: string }} input
 * @returns {Promise<{ ok: true, permalink: string } | { ok: false, error: string }>}
 */
export async function getFbPostPermalink({ postId, token }) {
  if (!postId || !token) {
    return { ok: false, error: 'getFbPostPermalink: postId and token required' };
  }
  const res = await graphGet(`/${encodeURIComponent(postId)}?fields=permalink_url`, token, { label: LABEL });
  if (!res.ok) {
    return { ok: false, error: res.error ?? 'unknown' };
  }
  const permalink = res.data?.permalink_url;
  if (!permalink) return { ok: false, error: 'no permalink_url in response' };
  return { ok: true, permalink };
}
