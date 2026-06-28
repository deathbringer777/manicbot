'use strict';
/**
 * ThinkPad job-runner — persistent PM2 service (autorestart: true, NOT a
 * one-shot cron_restart). Drains the D1 `jobs` queue the Worker fills
 * (manicbot/src/services/jobs.js on `main`, migration 0128).
 *
 *   - poll loop: every JOB_POLL_INTERVAL_MS, claim + run pending jobs;
 *   - POST /kick (127.0.0.1 only, behind the Access-gated tunnel): trigger an
 *     immediate drain instead of waiting for the next tick.
 *
 * Outbound-only by design: D1 over the CF REST API (lib/d1) — no inbound port is
 * opened (cloudflared dials out). The kick is gated by a Cloudflare Access JWT
 * (lib/access-jwt) when CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are configured.
 *
 * Env: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID (lib/d1),
 *   TELEGRAM_TOKEN + CHAT_ID (alerts), JOB_RUNNER_PORT (default 8791),
 *   JOB_POLL_INTERVAL_MS (default 30000), JOB_BATCH_LIMIT (default 5),
 *   CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD (kick JWT verification).
 */
require('dotenv').config();
const { createD1 } = require('../lib/d1');
const { createTg } = require('../lib/tg');
const { createLogger } = require('../lib/log');
const { askClaude } = require('../lib/claude');
const { makeAccessVerifier } = require('../lib/access-jwt');
const { processPending } = require('./job-core');
const { HANDLERS } = require('./handlers');
const { createServer } = require('./job-server');

const PORT = Number(process.env.JOB_RUNNER_PORT) || 8791;
const POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS) || 30_000;
const BATCH_LIMIT = Number(process.env.JOB_BATCH_LIMIT) || 5;
const ALERT_LIMIT = 600;

function buildVerifier(logger) {
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = process.env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) {
    logger.log('[job-runner] WARNING: CF_ACCESS_TEAM_DOMAIN/AUD unset — /kick will be REFUSED (503, fail-closed); the poll loop still drains the queue');
    return null;
  }
  return makeAccessVerifier({ teamDomain, aud });
}

/** Single-flight drain: never run two passes at once; coalesce a kick during a run. */
function makeDrain(deps, { logger, tg }) {
  let draining = false;
  let rerun = false;
  return async function drain(trigger) {
    if (draining) { rerun = true; return; }
    draining = true;
    try {
      do {
        rerun = false;
        const out = await processPending(deps, { limit: BATCH_LIMIT });
        if (out.claimed) {
          logger.log(`[job-runner] drain(${trigger}) claimed=${out.claimed} done=${out.done} failed=${out.failed}`);
        }
      } while (rerun);
    } catch (e) {
      logger.log(`[job-runner] drain error: ${e.message}`);
      try { await tg.sendMessage(`❌ job-runner drain упал: ${e.message}`.slice(0, ALERT_LIMIT), { parseMode: null }); } catch { /* alert best-effort */ }
    } finally {
      draining = false;
    }
  };
}

function main() {
  const logger = createLogger('job-runner');
  const d1 = createD1();
  const tg = createTg();
  if (!d1.isConfigured) {
    logger.log('[job-runner] FATAL: D1 not configured (CLOUDFLARE_* env missing) — exiting');
    process.exit(1);
  }
  const deps = { d1, handlers: HANDLERS, askClaude, tg, logger };
  const drain = makeDrain(deps, { logger, tg });
  const verifyAccess = buildVerifier(logger);

  const server = createServer({ drain, verifyAccess, logger });
  server.listen(PORT, '127.0.0.1', () =>
    logger.log(`[job-runner] listening on 127.0.0.1:${PORT}, poll=${POLL_INTERVAL_MS}ms, batch=${BATCH_LIMIT}`));

  const timer = setInterval(() => drain('poll'), POLL_INTERVAL_MS);
  drain('boot');

  process.once('SIGTERM', () => { clearInterval(timer); server.close(() => process.exit(0)); });
}

if (require.main === module) main();

module.exports = { makeDrain, main };
