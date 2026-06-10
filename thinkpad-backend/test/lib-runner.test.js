'use strict';
/**
 * lib/runner.js — shared cron harness: lock file, structured logs,
 * Telegram alert on failure, non-zero exit code on error.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCron } = require('../lib/runner');

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
}

function silentLogger() {
  const lines = [];
  return { log: (m) => lines.push(m), lines };
}

test('runCron runs the fn and reports ok', async () => {
  const baseDir = tmpBase();
  const logger = silentLogger();
  let ran = false;
  const res = await runCron('demo', async () => { ran = true; return 'result'; }, { baseDir, logger, alert: async () => {} });
  assert.equal(ran, true);
  assert.equal(res.ok, true);
  assert.ok(logger.lines.some(l => l.includes('start')));
  assert.ok(logger.lines.some(l => l.includes('done')));
  assert.ok(!fs.existsSync(path.join(baseDir, 'locks', 'demo.lock')), 'lock removed after run');
});

test('runCron skips when a fresh lock exists', async () => {
  const baseDir = tmpBase();
  const lockDir = path.join(baseDir, 'locks');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'demo.lock'), '12345');
  let ran = false;
  const res = await runCron('demo', async () => { ran = true; }, { baseDir, logger: silentLogger(), alert: async () => {} });
  assert.equal(ran, false);
  assert.equal(res.skipped, true);
});

test('runCron ignores a stale lock and runs', async () => {
  const baseDir = tmpBase();
  const lockDir = path.join(baseDir, 'locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, 'demo.lock');
  fs.writeFileSync(lockFile, '12345');
  const old = Date.now() - 60 * 60 * 1000;
  fs.utimesSync(lockFile, old / 1000, old / 1000);
  let ran = false;
  const res = await runCron('demo', async () => { ran = true; }, { baseDir, logger: silentLogger(), alert: async () => {}, lockTtlMs: 10 * 60 * 1000 });
  assert.equal(ran, true);
  assert.equal(res.ok, true);
});

test('runCron alerts and sets exitCode=1 when the fn throws', async () => {
  const baseDir = tmpBase();
  const alerts = [];
  const prevExitCode = process.exitCode;
  const res = await runCron('boom', async () => { throw new Error('kaput'); }, {
    baseDir, logger: silentLogger(), alert: async (text) => alerts.push(text),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /kaput/);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /boom/);
  assert.match(alerts[0], /kaput/);
  assert.equal(process.exitCode, 1);
  process.exitCode = prevExitCode; // don't fail the test run itself
  assert.ok(!fs.existsSync(path.join(baseDir, 'locks', 'boom.lock')), 'lock removed after crash');
});

test('runCron alert failures never mask the original error', async () => {
  const baseDir = tmpBase();
  const prevExitCode = process.exitCode;
  const res = await runCron('boom2', async () => { throw new Error('original'); }, {
    baseDir, logger: silentLogger(), alert: async () => { throw new Error('tg down'); },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /original/);
  process.exitCode = prevExitCode;
});
