'use strict';
/**
 * Job-runner core: race-safe claim, dispatch, result write-back.
 *
 * Pure over an injected D1 (lib/d1 createD1 → { query, exec }). The HTTP server
 * and poll loop live in services/job-runner.js; the handler registry in
 * services/handlers.js. Timestamps are epoch SECONDS (matches the `jobs`
 * migration 0127 and nowSec() on the Worker).
 */

const nowSecDefault = () => Math.floor(Date.now() / 1000);

const MAX_ATTEMPTS = 3;            // SEC-005: a job is claimed at most this many times
const LEASE_MS = 10 * 60 * 1000;   // SEC-005: a `running` row older than this is stuck

// `?N` positional placeholders — the CF D1 REST API binding style (lib/d1).
const SELECT_PENDING =
  `SELECT id, type, payload FROM jobs WHERE status='pending' AND attempts < ?1 ORDER BY created_at LIMIT ?2`;
const CLAIM =
  `UPDATE jobs SET status='running', claimed_at=?1, attempts=attempts+1 WHERE id=?2 AND status='pending' AND attempts < ?3`;
const FINISH =
  `UPDATE jobs SET status=?1, result=?2, error=?3, finished_at=?4 WHERE id=?5`;
// SEC-005: terminal-state poison + stuck rows so they cannot loop or strand.
const REAP_STUCK =
  `UPDATE jobs SET status='error', error='stuck (reaped)', finished_at=?1 WHERE status='running' AND claimed_at < ?2`;
const REAP_DEAD =
  `UPDATE jobs SET status='dead', finished_at=?1 WHERE status='pending' AND attempts >= ?2`;

const RESULT_LIMIT = 100_000; // cap an oversized result blob before write-back
const ERROR_LIMIT = 500;

/**
 * Atomically claim a pending job. Returns true iff THIS worker won the row.
 * Race-safety is the conditional `WHERE status='pending'`: SQLite serialises the
 * single UPDATE statement, so two concurrent claimers can never both see
 * changes===1 for the same row.
 */
async function claimJob({ d1 }, id, { now = nowSecDefault, maxAttempts = MAX_ATTEMPTS } = {}) {
  const meta = await d1.exec(CLAIM, [now(), id, maxAttempts]);
  return (meta.changes ?? 0) === 1;
}

async function finishJob({ d1 }, id, { status, result = null, error = null, now = nowSecDefault } = {}) {
  await d1.exec(FINISH, [status, result, error, now(), id]);
}

/**
 * Run a single claimed job through its handler and write the outcome back.
 * Unknown type or handler throw → status='error' (never silently dropped).
 */
async function runJob(deps, job, { now = nowSecDefault } = {}) {
  const { handlers, logger } = deps;
  const handler = handlers?.[job.type];
  if (!handler) {
    await finishJob(deps, job.id, { status: 'error', error: `unknown job type: ${job.type}`, now });
    logger?.log(`[job ${job.id}] unknown type ${job.type}`);
    return { ok: false, error: 'unknown_type' };
  }
  let payload = {};
  try { payload = JSON.parse(job.payload || '{}'); } catch { payload = {}; }
  try {
    const result = await handler(payload, deps);
    let serialized = JSON.stringify(result ?? null);
    if (serialized.length > RESULT_LIMIT) {
      // SEC-008: slicing serialized JSON corrupts it — store a valid marker instead.
      serialized = JSON.stringify({ truncated: true, bytes: serialized.length });
    }
    await finishJob(deps, job.id, { status: 'done', result: serialized, now });
    return { ok: true, result };
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, ERROR_LIMIT);
    await finishJob(deps, job.id, { status: 'error', error: msg, now });
    logger?.log(`[job ${job.id}] ${job.type} failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * SEC-005: terminal-state stuck `running` rows (process killed mid-job) and
 * over-attempt `pending` rows (poison toggled back to pending) so neither loops
 * nor strands forever. Returns counts.
 */
async function reapStuck(deps, { now = nowSecDefault, leaseMs = LEASE_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
  const { d1 } = deps;
  const cutoff = now() - Math.floor(leaseMs / 1000);
  const stuck = await d1.exec(REAP_STUCK, [now(), cutoff]);
  const dead = await d1.exec(REAP_DEAD, [now(), maxAttempts]);
  return { stuck: stuck.changes ?? 0, dead: dead.changes ?? 0 };
}

/**
 * Drain a batch: reap stuck/poison → select pending → claim each (skip lost
 * races + over-attempt) → run. Returns counts for logging/observability.
 */
async function processPending(deps, { limit = 5, now = nowSecDefault, maxAttempts = MAX_ATTEMPTS } = {}) {
  const { d1 } = deps;
  await reapStuck(deps, { now, maxAttempts });
  const candidates = await d1.query(SELECT_PENDING, [maxAttempts, limit]);
  let claimed = 0;
  let done = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!(await claimJob(deps, c.id, { now, maxAttempts }))) continue; // lost the race / over attempts
    claimed += 1;
    const r = await runJob(deps, c, { now });
    if (r.ok) done += 1; else failed += 1;
  }
  return { candidates: candidates.length, claimed, done, failed };
}

module.exports = {
  claimJob, finishJob, runJob, reapStuck, processPending,
  nowSec: nowSecDefault, MAX_ATTEMPTS, LEASE_MS,
  SELECT_PENDING, CLAIM, FINISH, REAP_STUCK, REAP_DEAD,
};
