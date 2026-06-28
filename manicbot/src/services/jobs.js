/**
 * Durable job queue: the Worker enqueues background work into the D1 `jobs`
 * table; the ThinkPad sidecar (free always-on compute backend) claims and runs
 * it. Heavy / long-running / Claude-on-Max marketing jobs cannot run inside the
 * Worker's CPU+wall-clock budget, so they are offloaded here.
 *
 * Two-layer dispatch (durability + low latency):
 *   1. INSERT a `pending` row — durable; survives even if the sidecar is down.
 *   2. Best-effort "kick" POST to the sidecar tunnel so it picks the job up
 *      immediately instead of waiting for its next poll tick. The kick is
 *      optional: if it fails (or no Access creds are configured) the sidecar's
 *      poller drains the queue on its next tick.
 *
 * The kick traverses Cloudflare Access (Zero Trust) with a service token, so the
 * call is machine-to-machine and identity-gated end to end (no inbound port is
 * opened on the sidecar — cloudflared dials out).
 *
 * @see thinkpad-backend/services/job-runner.js (claim loop + handlers, `thinkpad` branch)
 */

import { log } from '../utils/logger.js';
import { nowSec } from '../utils/time.js';

const KICK_TIMEOUT_MS = 5000;
const DEFAULT_JOBS_BASE_URL = 'https://jobs.manicbot.com';
const MAX_PAYLOAD_BYTES = 32 * 1024; // SEC-008: cap a job's persisted payload size

/**
 * Enqueue a background job for the ThinkPad sidecar to run.
 *
 * Resolves once the row is durably written; the kick is fire-and-forget and
 * never affects the result (durability lives in the D1 row, not the request).
 *
 * @param {object} env - Worker env. Requires the `DB` D1 binding; optionally
 *   `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (Access service token) and
 *   `JOBS_KICK_URL` (override the sidecar base URL, e.g. in tests).
 * @param {string} type - Job type, e.g. 'campaign.generate' (handler key on the sidecar).
 * @param {object} payload - JSON-serialisable job input.
 * @param {{ tenantId?: string|null }} [opts]
 * @returns {Promise<{ id: string }>} the new job id.
 */
export async function enqueueJob(env, type, payload, { tenantId = null } = {}) {
  const id = crypto.randomUUID();
  const createdAt = nowSec();
  const serialized = JSON.stringify(payload ?? {});
  // SEC-008: cap the payload so a caller cannot persist an oversized D1 row.
  if (serialized.length > MAX_PAYLOAD_BYTES) throw new Error('enqueueJob: payload too large');
  // tenant-scan-ignore: `jobs` is a platform-wide work queue, not tenant-isolated
  // data. tenant_id records which salon a marketing job is for (a payload
  // attribute), it is NOT an access boundary — the sidecar claims rows by status,
  // platform-wide, under systemAdmin trust.
  await env.DB
    .prepare(
      `INSERT INTO jobs (id, type, payload, status, tenant_id, attempts, created_at)
       VALUES (?, ?, ?, 'pending', ?, 0, ?)`,
    )
    .bind(id, type, serialized, tenantId, createdAt)
    .run();

  await kickSidecar(env, { id, type });
  return { id };
}

/**
 * Best-effort nudge to the sidecar to process the queue now. Never throws — if
 * the sidecar is unreachable, the `pending` row is drained by its poller.
 */
async function kickSidecar(env, { id, type }) {
  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) return; // no creds → rely on poller
  const base = env.JOBS_KICK_URL || DEFAULT_JOBS_BASE_URL;
  try {
    const res = await fetch(`${base}/kick`, {
      method: 'POST',
      headers: {
        'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, type }),
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    if (!res.ok) log.error('jobs.kick', new Error(`kick endpoint ${res.status}`), { status: res.status, type });
  } catch (e) {
    log.error('jobs.kick', e instanceof Error ? e : new Error(String(e?.message)), { type });
  }
}
