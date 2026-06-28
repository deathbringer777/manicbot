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
  permissionMode = undefined,
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
  // SEC-001: callers running UNTRUSTED prompts pass permissionMode:'default' so a
  // malicious prompt cannot coerce tool use even if the host's ~/.claude config is
  // bypassPermissions. Only emitted when explicitly requested (trusted crons keep
  // their existing behaviour).
  if (permissionMode) args.push('--permission-mode', permissionMode);
  return args;
}

// SEC-001: the spawned `claude -p` must NEVER carry our secrets. A generation job
// has no need for them, and stripping them caps the blast radius if tool use is
// ever (mis)enabled by the host config. ANTHROPIC_API_KEY also forces
// subscription billing (never the metered API).
const SENSITIVE_ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'D1_DATABASE_ID', 'TELEGRAM_TOKEN', 'TG_BOT_TOKEN', 'CHAT_ID', 'TG_CHAT_ID',
  'GROQ_API_KEY', 'META_ADS_TOKEN', 'META_CAPI_TOKEN', 'GSC_SERVICE_ACCOUNT_JSON',
  'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET',
];
const SENSITIVE_ENV_RE = /(TOKEN|SECRET|API_?KEY|PASSWORD|CREDENTIALS?|PRIVATE_KEY)$/i;

function cleanEnv(env = process.env) {
  const copy = { ...env };
  for (const k of SENSITIVE_ENV_KEYS) delete copy[k];
  for (const k of Object.keys(copy)) {
    if (SENSITIVE_ENV_RE.test(k)) delete copy[k];
  }
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
