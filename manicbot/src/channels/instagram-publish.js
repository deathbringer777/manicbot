/**
 * Outbound Instagram Feed publishing via Meta Graph API.
 *
 * Two-step Meta flow:
 *   1) POST /{page_id}/media         → media container id (queued)
 *   2) POST /{page_id}/media_publish → live ig_post_id
 *
 * Between the two, Meta processes the image (5-30s). The cron-based
 * pipeline persists `container_id` in the `marketing_publish_queue`
 * table (see migration 0059), then polls `status_code` in subsequent
 * ticks until FINISHED before calling step 2.
 *
 * This module exposes 3 thin wrappers; orchestration lives in
 * src/handlers/cron.js → phaseInstagramAutopilot.
 *
 * NOTE: requires Meta App approved for permission `instagram_content_publish`.
 * Existing tokens in `channel_configs` (created for inbound DM) likely
 * DO NOT have this scope. New Page Access Token + App review needed.
 */

import { graphPost, graphGet } from './graph-api.js';
import { log } from '../utils/logger.js';

const LABEL = 'instagram_publish';

/**
 * Step 1: create a media container for an image URL + caption.
 * Returns containerId on success. Container is NOT live yet.
 *
 * @param {{ pageId: string, imageUrl: string, caption: string, token: string }} input
 * @returns {Promise<{ ok: true, containerId: string } | { ok: false, error: string, tokenDead?: boolean, status?: number }>}
 */
export async function createMediaContainer({ pageId, imageUrl, caption, token }) {
  if (!pageId || !imageUrl || !token) {
    return { ok: false, error: 'createMediaContainer: pageId, imageUrl, token required' };
  }
  if (caption && caption.length > 2200) {
    // IG caption limit is 2200 chars; truncate hard to avoid Meta 400.
    return { ok: false, error: 'createMediaContainer: caption too long (>2200 chars)' };
  }

  const body = {
    image_url: imageUrl,
    caption: caption ?? '',
  };

  const res = await graphPost(`/${encodeURIComponent(pageId)}/media`, token, body, { label: LABEL });

  if (!res.ok) {
    log.error('marketing.instagramPublish', new Error(`createMediaContainer failed`), {
      stage: 'create',
      status: res.status,
      errorCode: res.errorCode,
      errorType: res.errorType,
      tokenDead: res.tokenDead,
    });
    return {
      ok: false,
      error: res.error ?? 'unknown',
      tokenDead: res.tokenDead,
      status: res.status,
    };
  }

  const containerId = res.data?.id;
  if (!containerId) {
    log.error('marketing.instagramPublish', new Error('no container id in response'), {
      stage: 'create',
      dataKeys: Object.keys(res.data ?? {}),
    });
    return { ok: false, error: 'createMediaContainer: no id in Meta response' };
  }

  log.info('marketing.instagramPublish', { stage: 'create.ok', containerId });
  return { ok: true, containerId };
}

/**
 * Step 1b (between create and publish): check container processing status.
 * Meta values: IN_PROGRESS, FINISHED, ERROR, PUBLISHED, EXPIRED.
 * We only call publish when status === FINISHED.
 *
 * @param {{ containerId: string, token: string }} input
 * @returns {Promise<{ ok: true, status: string, error?: string } | { ok: false, error: string, tokenDead?: boolean }>}
 */
export async function getContainerStatus({ containerId, token }) {
  if (!containerId || !token) {
    return { ok: false, error: 'getContainerStatus: containerId and token required' };
  }

  const res = await graphGet(
    `/${encodeURIComponent(containerId)}?fields=status_code,status`,
    token,
    { label: LABEL },
  );

  if (!res.ok) {
    return {
      ok: false,
      error: res.error ?? 'unknown',
      tokenDead: res.tokenDead,
      status: res.status,
    };
  }

  const statusCode = res.data?.status_code ?? null;
  const statusMsg = res.data?.status ?? null;
  log.info('marketing.instagramPublish', { stage: 'status', containerId, statusCode });
  return { ok: true, status: statusCode, error: statusMsg };
}

/**
 * Step 2: publish a container that has reached FINISHED status.
 * Returns the live IG post id on success.
 *
 * @param {{ pageId: string, containerId: string, token: string }} input
 * @returns {Promise<{ ok: true, igPostId: string } | { ok: false, error: string, tokenDead?: boolean, status?: number }>}
 */
export async function publishMediaContainer({ pageId, containerId, token }) {
  if (!pageId || !containerId || !token) {
    return { ok: false, error: 'publishMediaContainer: pageId, containerId, token required' };
  }

  const res = await graphPost(
    `/${encodeURIComponent(pageId)}/media_publish`,
    token,
    { creation_id: containerId },
    { label: LABEL },
  );

  if (!res.ok) {
    log.error('marketing.instagramPublish', new Error('publishMediaContainer failed'), {
      stage: 'publish',
      status: res.status,
      errorCode: res.errorCode,
      tokenDead: res.tokenDead,
    });
    return {
      ok: false,
      error: res.error ?? 'unknown',
      tokenDead: res.tokenDead,
      status: res.status,
    };
  }

  const igPostId = res.data?.id;
  if (!igPostId) {
    return { ok: false, error: 'publishMediaContainer: no id in Meta response' };
  }

  log.info('marketing.instagramPublish', { stage: 'publish.ok', containerId, igPostId });
  return { ok: true, igPostId };
}

/**
 * Optional permalink lookup (after publish, returns the IG URL).
 * Used to fill marketing_content_plan.permalink.
 *
 * @param {{ igPostId: string, token: string }} input
 * @returns {Promise<{ ok: true, permalink: string } | { ok: false, error: string }>}
 */
export async function getMediaPermalink({ igPostId, token }) {
  if (!igPostId || !token) {
    return { ok: false, error: 'getMediaPermalink: igPostId and token required' };
  }
  const res = await graphGet(
    `/${encodeURIComponent(igPostId)}?fields=permalink`,
    token,
    { label: LABEL },
  );
  if (!res.ok) {
    return { ok: false, error: res.error ?? 'unknown' };
  }
  const permalink = res.data?.permalink;
  if (!permalink) return { ok: false, error: 'no permalink in response' };
  return { ok: true, permalink };
}
