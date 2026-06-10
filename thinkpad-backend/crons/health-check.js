#!/usr/bin/env node
'use strict';
/**
 * Hourly liveness check: local system stats + Worker /api/health probe.
 * FAILs are pushed to Telegram (before this rewrite a dead Worker was only
 * visible in a log file nobody reads at 4 AM).
 */
const path = require('path');
const os = require('os');
const { BASE_DIR } = require('../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../lib/runner');
const { createTg } = require('../lib/tg');
const { httpJson } = require('../lib/http');

/** The Worker liveness route is /api/health (a bare /health falls through to the landing proxy). */
function endpointUrl(base) {
  return `${String(base).replace(/\/+$/, '')}/api/health`;
}

function systemStats() {
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  return {
    uptimeH: Math.round(os.uptime() / 3600),
    loadAvg: os.loadavg()[0].toFixed(2),
    usedMem: totalMem - freeMem,
    totalMem,
  };
}

async function main(logger) {
  const s = systemStats();
  logger.log(`System | uptime=${s.uptimeH}h | load=${s.loadAvg} | mem=${s.usedMem}/${s.totalMem}MB`);

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    logger.log('WORKER_URL not set — endpoint check skipped');
    return;
  }

  const url = endpointUrl(workerUrl);
  let ok = false;
  let detail = '';
  try {
    const res = await httpJson(url, { timeoutMs: 10000 });
    ok = res.status === 200 && res.data?.status === 'ok';
    detail = `HTTP ${res.status}`;
  } catch (err) {
    detail = err.message;
  }
  logger.log(`Worker ${url} → ${ok ? 'OK' : 'FAIL'} (${detail})`);

  if (!ok) {
    await createTg().sendMessage(`🚨 Worker health FAIL: ${url} → ${detail}`, { parseMode: null });
  }
}

if (require.main === module) runCron('health-check', main);

module.exports = { endpointUrl, main };
