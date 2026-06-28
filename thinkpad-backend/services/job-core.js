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

// `?N` positional placeholders — the CF D1 REST API binding style (lib/d1).
const SELECT_PENDING =
  `SELECT id, type, payload FROM jobs WHERE status='pending' ORDER BY created_at LIMIT ?1`;
const CLAIM =
  `UPDATE jobs SET status='running', claimed_at=?1, attempts=attempts+1 WHERE id=?2 AND status='pending'`;
const FINISH =
  `UPDATE jobs SET status=?1, result=?2, error=?3, finished_at=?4 WHERE id=?5`;

const RESULT_LIMIT = 100_000; // cap an oversized result blob before write-back
const ERROR_LIMIT = 500;

/**
 * Atomically claim a pending job. Returns true iff THIS worker won the row.
 * Race-safety is the conditional `WHERE status='pending'`: SQLite serialises the
 * single UPDATE statement, so two concurrent claimers can never both see
 * changes===1 for the same row.
 */
async function claimJob({ d1 }, id, { now = nowSecDefault } = {}) {
  const meta = await d1.exec(CLAIM, [now(), id]);
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
    const serialized = JSON.stringify(result ?? null).slice(0, RESULT_LIMIT);
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
 * Drain a batch: select pending → claim each (skip lost races) → run.
 * Returns counts for logging/observability.
 */
async function processPending(deps, { limit = 5, now = nowSecDefault } = {}) {
  const { d1 } = deps;
  const candidates = await d1.query(SELECT_PENDING, [limit]);
  let claimed = 0;
  let done = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!(await claimJob(deps, c.id, { now }))) continue; // lost the race to another worker
    claimed += 1;
    const r = await runJob(deps, c, { now });
    if (r.ok) done += 1; else failed += 1;
  }
  return { candidates: candidates.length, claimed, done, failed };
}

module.exports = {
  claimJob, finishJob, runJob, processPending,
  nowSec: nowSecDefault, SELECT_PENDING, CLAIM, FINISH,
};
