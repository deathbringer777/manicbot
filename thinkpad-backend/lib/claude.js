'use strict';
/**
 * Headless Claude Code CLI adapter.
 *
 * All text-LLM work on this machine goes through `claude -p` so it bills the
 * Max subscription (OAuth in ~/.claude/.credentials.json), never the metered
 * API. Therefore ANTHROPIC_API_KEY is actively stripped from the child env.
 *
 * Security: the prompt travels as a single argv element via execFile —
 * no shell, no injection surface regardless of prompt content.
 */
const { execFile } = require('child_process');

const DEFAULT_MODEL = 'sonnet';
const DEFAULT_EFFORT = 'medium';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 32 * 1024 * 1024;
const STDERR_TAIL = 400;

function buildArgs(prompt, {
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  resume = null,
  system = null,
  tools = undefined,
} = {}) {
  const args = [
    '-p', prompt,
    '--model', model,
    '--effort', effort,
    '--output-format', 'json',
  ];
  if (resume) args.push('--resume', resume);
  if (system) args.push('--append-system-prompt', system);
  if (tools !== undefined && tools !== null) args.push('--tools', tools);
  return args;
}

function cleanEnv(env = process.env) {
  const copy = { ...env };
  delete copy.ANTHROPIC_API_KEY; // subscription only — never fall back to metered API
  return copy;
}

function extractJson(text) {
  const raw = String(text ?? '').trim();
  try { return JSON.parse(raw); } catch { /* keep trying */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* keep trying */ }
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch { /* fall through */ }
  }
  throw new Error('Could not extract JSON from model output');
}

function askClaude(prompt, opts = {}) {
  const {
    exec = execFile,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    json = false,
  } = opts;
  const args = buildArgs(prompt, opts);

  return new Promise((resolve, reject) => {
    exec('claude', args, {
      env: cleanEnv(),
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      killSignal: 'SIGKILL',
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || '').trim().slice(-STDERR_TAIL) || err.message;
        return reject(new Error(`claude CLI failed: ${detail}`));
      }
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        return reject(new Error(`claude CLI returned non-JSON output: ${String(stdout).slice(0, 200)}`));
      }
      if (envelope.is_error) {
        return reject(new Error(`claude CLI error: ${envelope.result || envelope.subtype || 'unknown'}`));
      }
      const out = {
        text: envelope.result ?? '',
        sessionId: envelope.session_id || null,
        raw: envelope,
      };
      if (json) {
        try { out.json = extractJson(out.text); } catch (e) { return reject(e); }
      }
      resolve(out);
    });
  });
}

module.exports = {
  askClaude, buildArgs, cleanEnv, extractJson,
  DEFAULT_MODEL, DEFAULT_EFFORT,
};
