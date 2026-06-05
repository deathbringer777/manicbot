/**
 * @manicbot_com IG autopilot — cron-driven post generation + publishing.
 *
 * Runs ONCE per cron tick (every 15 min) as a global phase (NOT
 * per-tenant), since the only "tenant" here is the platform itself.
 * Wired into src/worker.js scheduled() as a parallel waitUntil.
 *
 * State machine per slot (marketing_content_plan.status):
 *
 *   pending      ──── caption + image gen ────►  ready
 *   ready        ──── createMediaContainer ────►  publishing
 *   publishing   ──── status FINISHED + publish ──►  posted
 *
 * Plus terminal states: failed (after 5 errors) and paused (manual).
 *
 * Lead time: caption + image generation starts 15 min BEFORE
 * scheduled_at so the slot is "ready" by the publish moment. The
 * Meta container processing takes another 5-30 s, so the publish
 * step usually completes on the next tick after creation.
 *
 * Credentials: MARKETING_IG_PAGE_ID + MARKETING_IG_ACCESS_TOKEN
 * Worker secrets. Stored at Worker level (not in channel_configs)
 * because @manicbot_com isn't a tenant. Once we have a system
 * tenant row, this will move into channel_configs with tenant_id=NULL.
 */

import { log } from '../utils/logger.js';
import { logEvent } from '../utils/events.js';
import { generateCaption } from './captionGen.js';
import { generateImage } from './imageGen.js';
import { BRAND_VOICE, buildImagePrompt } from './brandVoice.js';
import {
  createMediaContainer,
  getContainerStatus,
  publishMediaContainer,
  getMediaPermalink,
} from '../channels/instagram-publish.js';

const MAX_SLOTS_PER_TICK = 3;        // bound work per tick
const MAX_ERRORS_PER_SLOT = 5;       // after this, status='failed'
const LEAD_TIME_SEC = 15 * 60;       // start gen 15 min before scheduled_at
const CAPTION_HASHTAG_SEPARATOR = '\n\n';

/**
 * Cron entry point. Reads ready slots, advances each through the
 * state machine, swallows per-slot errors so one bad slot doesn't
 * stall the whole tick.
 *
 * @param {object} env - Worker env
 * @param {number} [nowMs] - injectable now for tests
 */
export async function phaseInstagramAutopilot(env, nowMs = Date.now()) {
  if (!env?.DB) {
    log.warn('marketing.autopilot', { skipped: 'no DB binding' });
    return { processed: 0, skipped: 'no_db' };
  }

  const nowSec = Math.floor(nowMs / 1000);

  let slots;
  try {
    slots = await env.DB.prepare(
      `SELECT id, scheduled_at, theme, topic, key_message,
              headline_pl, caption_pl, hashtags_json, image_url, image_prompt,
              status, error_count
       FROM marketing_content_plan
       WHERE tenant_id IS NULL
         AND status IN ('pending', 'ready', 'publishing')
         AND error_count < ?
         AND scheduled_at <= ?
       ORDER BY scheduled_at ASC
       LIMIT ?`,
    )
      .bind(MAX_ERRORS_PER_SLOT, nowSec + LEAD_TIME_SEC, MAX_SLOTS_PER_TICK)
      .all();
  } catch (e) {
    log.error('marketing.autopilot', e instanceof Error ? e : new Error(String(e)), {
      stage: 'select_slots',
    });
    return { processed: 0, error: e?.message };
  }

  const rows = slots?.results ?? [];
  if (rows.length === 0) {
    return { processed: 0 };
  }

  let processed = 0;
  for (const slot of rows) {
    try {
      await processSlot(env, slot, nowSec);
      processed++;
    } catch (e) {
      log.error('marketing.autopilot', e instanceof Error ? e : new Error(String(e)), {
        stage: 'processSlot',
        slotId: slot.id,
        slotStatus: slot.status,
      });
      void logEvent(
        { db: env.DB, tenantId: null },
        'marketing.autopilot.slot_error',
        {
          level: 'error',
          message: `slot ${slot.id} failed: ${e?.message ?? 'unknown'}`,
          slotId: slot.id,
          status: slot.status,
          error: String(e?.message ?? 'unknown').slice(0, 200),
        },
      ).catch(() => {});
      await markSlotError(env, slot.id, e?.message ?? 'unknown', nowSec);
    }
  }

  log.info('marketing.autopilot', { stage: 'tick.done', processed, examined: rows.length });
  return { processed, examined: rows.length };
}

/**
 * Drive one slot through one state transition. Each call advances
 * at most one step — the next cron tick handles the next step.
 * This keeps each tick's runtime bounded.
 */
export async function processSlot(env, slot, nowSec) {
  switch (slot.status) {
    case 'pending':
      return processPending(env, slot, nowSec);
    case 'ready':
      return processReady(env, slot, nowSec);
    case 'publishing':
      return processPublishing(env, slot, nowSec);
    default:
      log.warn('marketing.autopilot', { skipped: 'unexpected_status', slotId: slot.id, status: slot.status });
      return;
  }
}

async function processPending(env, slot, nowSec) {
  if (slot.scheduled_at > nowSec + LEAD_TIME_SEC) return; // not yet in lead time

  // 1) Caption (if not already generated)
  let captionData = null;
  if (!slot.caption_pl) {
    captionData = await generateCaption(env, {
      brandVoice: BRAND_VOICE,
      slot: { theme: slot.theme, topic: slot.topic, key_message: slot.key_message ?? undefined },
    });
    await env.DB.prepare(
      `UPDATE marketing_content_plan
       SET headline_pl = ?, caption_pl = ?, hashtags_json = ?, image_prompt = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
      .bind(
        captionData.headline_pl,
        captionData.caption_pl,
        JSON.stringify(captionData.hashtags),
        captionData.image_prompt_visual,
        nowSec,
        slot.id,
      )
      .run();
  } else {
    captionData = {
      headline_pl: slot.headline_pl,
      caption_pl: slot.caption_pl,
      hashtags: safeParseJsonArray(slot.hashtags_json),
      image_prompt_visual: slot.image_prompt ?? '',
    };
  }

  // 2) Image
  const imagePrompt = buildImagePrompt(captionData.headline_pl, captionData.image_prompt_visual);
  const img = await generateImage(env, { prompt: imagePrompt, key: `posts/${slot.id}.png` });

  // 3) Advance to ready
  await env.DB.prepare(
    `UPDATE marketing_content_plan
     SET image_url = ?, status = 'ready', updated_at = ?
     WHERE id = ?`,
  )
    .bind(img.url, nowSec, slot.id)
    .run();

  log.info('marketing.autopilot', { stage: 'pending->ready', slotId: slot.id, imageUrl: img.url });
}

async function processReady(env, slot, nowSec) {
  if (slot.scheduled_at > nowSec) return; // not time to publish yet

  const creds = await getIgCredentials(env);
  if (!creds) {
    log.warn('marketing.autopilot', { skipped: 'no_ig_credentials', slotId: slot.id });
    return;
  }

  const hashtags = safeParseJsonArray(slot.hashtags_json);
  const fullCaption = slot.caption_pl + CAPTION_HASHTAG_SEPARATOR + hashtags.join(' ');

  const res = await createMediaContainer({
    pageId: creds.pageId,
    imageUrl: slot.image_url,
    caption: fullCaption,
    token: creds.token,
  });

  if (!res.ok) {
    throw new Error(`createMediaContainer: ${res.error}${res.tokenDead ? ' (token dead)' : ''}`);
  }

  const queueId = `pq_${slot.id}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO marketing_publish_queue
     (id, content_plan_id, page_id, meta_container_id, status, attempts, last_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'container_created', 1, ?, ?, ?)`,
  )
    .bind(queueId, slot.id, creds.pageId, res.containerId, nowSec, nowSec, nowSec)
    .run();

  await env.DB.prepare(
    `UPDATE marketing_content_plan SET status = 'publishing', updated_at = ? WHERE id = ?`,
  )
    .bind(nowSec, slot.id)
    .run();

  log.info('marketing.autopilot', { stage: 'ready->publishing', slotId: slot.id, containerId: res.containerId });
}

async function processPublishing(env, slot, nowSec) {
  const creds = await getIgCredentials(env);
  if (!creds) return;

  const queue = await env.DB.prepare(
    `SELECT meta_container_id, attempts FROM marketing_publish_queue WHERE content_plan_id = ? LIMIT 1`,
  )
    .bind(slot.id)
    .first();
  if (!queue?.meta_container_id) {
    throw new Error('publish queue row missing');
  }

  const statusRes = await getContainerStatus({ containerId: queue.meta_container_id, token: creds.token });
  if (!statusRes.ok) {
    throw new Error(`getContainerStatus: ${statusRes.error}`);
  }
  if (statusRes.status === 'IN_PROGRESS') {
    log.info('marketing.autopilot', { stage: 'publishing.wait', slotId: slot.id, containerStatus: 'IN_PROGRESS' });
    await env.DB.prepare(
      `UPDATE marketing_publish_queue SET attempts = attempts + 1, last_attempt_at = ?, updated_at = ? WHERE content_plan_id = ?`,
    )
      .bind(nowSec, nowSec, slot.id)
      .run();
    return; // try again next tick
  }
  if (statusRes.status === 'ERROR' || statusRes.status === 'EXPIRED') {
    throw new Error(`container status ${statusRes.status}`);
  }
  if (statusRes.status !== 'FINISHED' && statusRes.status !== 'PUBLISHED') {
    log.warn('marketing.autopilot', { unexpectedStatus: statusRes.status, slotId: slot.id });
    return;
  }

  const pubRes = await publishMediaContainer({
    pageId: creds.pageId,
    containerId: queue.meta_container_id,
    token: creds.token,
  });
  if (!pubRes.ok) {
    throw new Error(`publishMediaContainer: ${pubRes.error}`);
  }

  let permalink = null;
  const permRes = await getMediaPermalink({ igPostId: pubRes.igPostId, token: creds.token }).catch(() => null);
  if (permRes?.ok) permalink = permRes.permalink;

  await env.DB.prepare(
    `UPDATE marketing_content_plan
     SET status = 'posted', meta_post_id = ?, permalink = ?, published_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(pubRes.igPostId, permalink, nowSec, nowSec, slot.id)
    .run();

  await env.DB.prepare(
    `UPDATE marketing_publish_queue
     SET status = 'published', meta_post_id = ?, updated_at = ?
     WHERE content_plan_id = ?`,
  )
    .bind(pubRes.igPostId, nowSec, slot.id)
    .run();

  log.info('marketing.autopilot', { stage: 'publishing->posted', slotId: slot.id, igPostId: pubRes.igPostId });
}

/**
 * Resolve IG publishing credentials for the platform account (@manicbot_com).
 *
 * Priority:
 *   1. Worker secrets MARKETING_IG_PAGE_ID + MARKETING_IG_ACCESS_TOKEN (manual override).
 *   2. The marketing channel stored in channel_configs under MARKETING_IG_TENANT_ID,
 *      connected via the product's Instagram-login OAuth: long-lived, auto-refreshed
 *      (cron token-manager) and encrypted at rest. The token is decrypted only here,
 *      inside the Worker, via the shared resolver — it never leaves the Worker.
 *
 * `pageId` is the IG account id the Graph publish endpoints target
 * (`/{ig-user-id}/media`). graphPost/graphGet auto-route IGAA tokens to
 * graph.instagram.com, so no host wiring is needed at the call site.
 *
 * @param {object} env - Worker env bindings
 * @returns {Promise<{ pageId: string, token: string } | null>}
 */
export async function getIgCredentials(env) {
  if (env?.MARKETING_IG_PAGE_ID && env?.MARKETING_IG_ACCESS_TOKEN) {
    return { pageId: env.MARKETING_IG_PAGE_ID, token: env.MARKETING_IG_ACCESS_TOKEN };
  }
  const tenantId = env?.MARKETING_IG_TENANT_ID;
  if (!tenantId || !env?.DB || !env?.BOT_ENCRYPTION_KEY) return null;
  const { getChannelConfig } = await import('../channels/resolver.js');
  const cfg = await getChannelConfig(
    { db: env.DB },
    tenantId,
    'instagram',
    env.BOT_ENCRYPTION_KEY,
    env.BOT_ENCRYPTION_KEY_OLD ?? null,
  );
  if (!cfg?.token) return null;
  const pageId = cfg.ig_business_id || cfg.config?.ig_user_id || cfg.config?.ig_account_id || cfg.page_id;
  if (!pageId) return null;
  return { pageId, token: cfg.token };
}

async function markSlotError(env, slotId, msg, nowSec) {
  try {
    await env.DB.prepare(
      `UPDATE marketing_content_plan
       SET error_msg = ?,
           error_count = error_count + 1,
           status = CASE WHEN error_count + 1 >= ? THEN 'failed' ELSE status END,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(String(msg).slice(0, 500), MAX_ERRORS_PER_SLOT, nowSec, slotId)
      .run();
  } catch (e) {
    log.error('marketing.autopilot', e instanceof Error ? e : new Error(String(e)), {
      stage: 'markSlotError',
      slotId,
    });
  }
}

function safeParseJsonArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
