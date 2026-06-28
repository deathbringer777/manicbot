'use strict';
/**
 * lib/claude.js — headless Claude Code CLI adapter.
 * The adapter must spawn `claude -p` WITHOUT a shell (no injection surface),
 * strip ANTHROPIC_API_KEY from the child env (subscription billing only),
 * and parse the --output-format json envelope.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const claude = require('../lib/claude');

function fakeExec(result) {
  const calls = [];
  const fn = (cmd, args, options, cb) => {
    calls.push({ cmd, args, options });
    if (result.error) {
      const err = new Error(result.error);
      err.code = result.code ?? 1;
      cb(err, result.stdout || '', result.stderr || '');
    } else {
      cb(null, result.stdout || '', result.stderr || '');
    }
  };
  fn.calls = calls;
  return fn;
}

function envelope(overrides = {}) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'hello',
    session_id: 'sess-123',
    ...overrides,
  });
}

test('buildArgs: defaults to sonnet + medium effort + json output', () => {
  const args = claude.buildArgs('What time is it?', {});
  assert.equal(args[0], '-p');
  assert.equal(args[1], 'What time is it?');
  assert.ok(args.includes('--model') && args[args.indexOf('--model') + 1] === 'sonnet');
  assert.ok(args.includes('--effort') && args[args.indexOf('--effort') + 1] === 'medium');
  assert.ok(args.includes('--output-format') && args[args.indexOf('--output-format') + 1] === 'json');
});

test('buildArgs: resume, system prompt and tools are passed through', () => {
  const args = claude.buildArgs('hi', {
    resume: 'sess-9', system: 'You are an ops bot.', tools: '',
  });
  assert.equal(args[args.indexOf('--resume') + 1], 'sess-9');
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'You are an ops bot.');
  assert.equal(args[args.indexOf('--tools') + 1], '');
});

test('buildArgs: emits --permission-mode only when requested (SEC-001)', () => {
  assert.ok(!claude.buildArgs('hi', {}).includes('--permission-mode'), 'absent by default (trusted crons)');
  const args = claude.buildArgs('hi', { permissionMode: 'default' });
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
});

test('cleanEnv: strips secrets from the child env, keeps benign vars (SEC-001)', () => {
  const child = claude.cleanEnv({
    PATH: '/usr/bin', HOME: '/home/kirill', LANG: 'en_US.UTF-8',
    ANTHROPIC_API_KEY: 'sk-ant', CLOUDFLARE_API_TOKEN: 'cf', D1_DATABASE_ID: 'd1',
    TELEGRAM_TOKEN: 'tg', CHAT_ID: '123', SOME_SECRET: 's', FOO_PASSWORD: 'p',
  });
  // benign vars survive (claude needs HOME for ~/.claude creds, PATH for the binary)
  assert.equal(child.PATH, '/usr/bin');
  assert.equal(child.HOME, '/home/kirill');
  assert.equal(child.LANG, 'en_US.UTF-8');
  // secrets are gone — explicit list + pattern (*_SECRET, *_PASSWORD, *_TOKEN, etc.)
  for (const k of ['ANTHROPIC_API_KEY', 'CLOUDFLARE_API_TOKEN', 'D1_DATABASE_ID', 'TELEGRAM_TOKEN', 'CHAT_ID', 'SOME_SECRET', 'FOO_PASSWORD']) {
    assert.ok(!(k in child), `${k} must be stripped`);
  }
});

test('askClaude: returns text + sessionId from the CLI envelope', async () => {
  const exec = fakeExec({ stdout: envelope() });
  const out = await claude.askClaude('hi', { exec });
  assert.equal(out.text, 'hello');
  assert.equal(out.sessionId, 'sess-123');
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].cmd, 'claude');
});

test('askClaude: child env never contains ANTHROPIC_API_KEY', async () => {
  const exec = fakeExec({ stdout: envelope() });
  process.env.ANTHROPIC_API_KEY = 'sk-test-should-not-leak';
  try {
    await claude.askClaude('hi', { exec });
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
  const childEnv = exec.calls[0].options.env;
  assert.ok(childEnv, 'env must be set explicitly');
  assert.ok(!('ANTHROPIC_API_KEY' in childEnv), 'API key must be stripped');
});

test('askClaude: json mode parses fenced JSON from result text', async () => {
  const exec = fakeExec({
    stdout: envelope({ result: 'Sure!\n```json\n{"a": 1}\n```' }),
  });
  const out = await claude.askClaude('give json', { exec, json: true });
  assert.deepEqual(out.json, { a: 1 });
});

test('askClaude: throws on is_error envelope', async () => {
  const exec = fakeExec({ stdout: envelope({ is_error: true, result: 'limit reached' }) });
  await assert.rejects(() => claude.askClaude('hi', { exec }), /limit reached/);
});

test('askClaude: throws with stderr tail on non-zero exit', async () => {
  const exec = fakeExec({ error: 'spawn failed', code: 1, stderr: 'OAuth token expired' });
  await assert.rejects(() => claude.askClaude('hi', { exec }), /OAuth token expired/);
});

test('extractJson: direct, fenced and embedded objects', () => {
  assert.deepEqual(claude.extractJson('{"x":2}'), { x: 2 });
  assert.deepEqual(claude.extractJson('```json\n{"x":3}\n```'), { x: 3 });
  assert.deepEqual(claude.extractJson('preamble {"x":4,"y":{"z":5}} trailer'), { x: 4, y: { z: 5 } });
  assert.throws(() => claude.extractJson('no json here'), /JSON/);
});
