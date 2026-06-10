'use strict';
/**
 * runCron(name, fn, opts) — shared harness for one-shot PM2 cron jobs.
 *
 * Guarantees for every cron:
 *   - lock file: a second concurrent start exits without running (stale locks
 *     older than lockTtlMs are ignored — crashed runs must not block forever);
 *   - structured start/done log lines with duration;
 *   - Telegram alert + process.exitCode = 1 when fn throws (no silent failures);
 *   - the lock is removed even on crash.
 */
const fs = require('fs');
const path = require('path');
const { createLogger, BASE_DIR } = require('./log');
const { createTg } = require('./tg');

const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const ALERT_TEXT_LIMIT = 600;

async function runCron(name, fn, {
  baseDir = BASE_DIR,
  lockTtlMs = DEFAULT_LOCK_TTL_MS,
  logger = createLogger(name),
  alert,
} = {}) {
  const sendAlert = alert || (async (text) => { await createTg().sendMessage(text, { parseMode: null }); });

  const lockDir = path.join(baseDir, 'locks');
  const lockFile = path.join(lockDir, `${name}.lock`);
  fs.mkdirSync(lockDir, { recursive: true });

  if (fs.existsSync(lockFile)) {
    const age = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (age < lockTtlMs) {
      logger.log(`[${name}] lock is fresh (${Math.round(age / 1000)}s) — another run in progress, skipping`);
      return { ok: false, skipped: true };
    }
    logger.log(`[${name}] stale lock (${Math.round(age / 1000)}s) — removing and continuing`);
  }
  fs.writeFileSync(lockFile, String(process.pid));
  const releaseLock = () => { try { fs.unlinkSync(lockFile); } catch { /* already gone */ } };
  process.once('SIGTERM', () => { releaseLock(); process.exit(0); });

  const startedAt = Date.now();
  logger.log(`=== ${name} start ===`);
  try {
    const result = await fn(logger);
    logger.log(`=== ${name} done (${Date.now() - startedAt}ms) ===`);
    return { ok: true, result };
  } catch (err) {
    const message = err?.message || String(err);
    logger.log(`=== ${name} FAILED (${Date.now() - startedAt}ms): ${message} ===`);
    if (err?.stack) logger.log(err.stack.split('\n').slice(0, 6).join('\n'));
    try {
      await sendAlert(`❌ Крон ${name} упал: ${message}`.slice(0, ALERT_TEXT_LIMIT));
    } catch (alertErr) {
      logger.log(`[${name}] alert delivery failed: ${alertErr.message}`);
    }
    process.exitCode = 1;
    return { ok: false, error: message };
  } finally {
    releaseLock();
  }
}

module.exports = { runCron };
