#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const LOG_FILE = path.join(os.homedir(), 'manicbot-backend', 'logs', 'health.log');

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${timestamp()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function getSystemStats() {
  const uptime = os.uptime();
  const loadAvg = os.loadavg()[0].toFixed(2);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  return { uptime, loadAvg, freeMem, totalMem, usedMem: totalMem - freeMem };
}

function checkEndpoint(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      resolve({ ok: res.statusCode < 400, status: res.statusCode });
    });
    req.on('error', (err) => resolve({ ok: false, status: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
  });
}

async function run() {
  log('=== Health check started ===');

  const stats = getSystemStats();
  log(`System | uptime=${Math.round(stats.uptime / 3600)}h | load=${stats.loadAvg} | mem=${stats.usedMem}/${stats.totalMem}MB`);

  const workerUrl = process.env.WORKER_URL;
  if (workerUrl) {
    const result = await checkEndpoint(`${workerUrl}/health`);
    log(`Worker ${workerUrl}/health → ${result.ok ? 'OK' : 'FAIL'} (${result.status})`);
  }

  log('=== Health check done ===\n');
}

run().catch((err) => {
  log(`ERROR: ${err.message}`);
  process.exit(1);
});
