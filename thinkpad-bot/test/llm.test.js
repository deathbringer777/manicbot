// llm.js v6 — Claude Code CLI adapter (Max subscription, no API fallbacks).
// The adapter spawns `claude -p` via an injectable deps.execFile (no shell),
// resumes per-chat sessions, and surfaces honest errors instead of silently
// degrading to another model.

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let llm;

function envelope(over = {}) {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "привет",
    session_id: "sess-1",
    duration_ms: 1200,
    total_cost_usd: 0.01,
    ...over,
  });
}

// script: array of steps, or fn(callIndex, args) → step.
// step: { stdout } for success, { error, stderr } for a CLI failure.
function fakeExec(script) {
  const calls = [];
  const fn = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    const step = typeof script === "function"
      ? script(calls.length, args)
      : script[Math.min(calls.length - 1, script.length - 1)];
    if (step.error) cb(new Error(step.error), "", step.stderr || "");
    else cb(null, step.stdout, "");
  };
  fn.calls = calls;
  return fn;
}

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key"; // Whisper STT only
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  // Pin CLI defaults — the dev machine may export CLAUDE_EFFORT/CLAUDE_MODEL
  // (Claude Code itself does) and tests must not inherit them.
  process.env.CLAUDE_MODEL = "sonnet";
  process.env.CLAUDE_EFFORT = "medium";
  process.env.CLAUDE_SESSIONS_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "llm-test-")), "sessions.json",
  );
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../llm.js")];
  llm = require("../llm.js");
});

beforeEach(() => {
  llm.resetHistory(111);
  llm.resetHistory(222);
});

describe("llm.js — Claude CLI adapter", () => {
  it("ask spawns claude -p with model/effort/json + skip-permissions, no API key in env", async () => {
    const exec = fakeExec([{ stdout: envelope() }]);
    llm.deps.execFile = exec;

    const reply = await llm.ask(111, "привет");
    assert.strictEqual(reply, "привет");

    const { cmd, args, opts } = exec.calls[0];
    assert.strictEqual(cmd, "claude");
    assert.strictEqual(args[0], "-p");
    assert.strictEqual(args[1], "привет");
    assert.strictEqual(args[args.indexOf("--model") + 1], "sonnet");
    assert.strictEqual(args[args.indexOf("--effort") + 1], "medium");
    assert.strictEqual(args[args.indexOf("--output-format") + 1], "json");
    // Permission system stays ON: an explicit tool allowlist, never the
    // wholesale --dangerously-skip-permissions switch.
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.strictEqual(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
    const allowed = args[args.indexOf("--allowedTools") + 1];
    assert.ok(allowed.includes("Bash"), "ops bot needs shell diagnostics");
    assert.ok(args.includes("--append-system-prompt"));
    assert.ok(opts.env, "child env must be explicit");
    assert.ok(!("ANTHROPIC_API_KEY" in opts.env), "must bill the subscription, not the API");
  });

  it("second ask in the same chat resumes the claude session", async () => {
    const exec = fakeExec([
      { stdout: envelope({ session_id: "sess-A" }) },
      { stdout: envelope({ session_id: "sess-A", result: "ещё" }) },
    ]);
    llm.deps.execFile = exec;

    await llm.ask(111, "раз");
    assert.ok(!exec.calls[0].args.includes("--resume"), "first call starts fresh");
    await llm.ask(111, "два");
    const args2 = exec.calls[1].args;
    assert.strictEqual(args2[args2.indexOf("--resume") + 1], "sess-A");
  });

  it("resetHistory drops the session — next ask starts fresh", async () => {
    const exec = fakeExec([{ stdout: envelope({ session_id: "sess-B" }) }, { stdout: envelope() }]);
    llm.deps.execFile = exec;
    await llm.ask(111, "раз");
    llm.resetHistory(111);
    await llm.ask(111, "два");
    assert.ok(!exec.calls[1].args.includes("--resume"));
  });

  it("per-chat /effort flows into the CLI args", async () => {
    const exec = fakeExec([{ stdout: envelope() }]);
    llm.deps.execFile = exec;
    llm.setEffort(222, "high");
    await llm.ask(222, "подумай");
    const args = exec.calls[0].args;
    assert.strictEqual(args[args.indexOf("--effort") + 1], "high");
  });

  it("a dead session id falls back to a fresh session transparently", async () => {
    const exec = fakeExec((n, args) => {
      if (n === 1) return { stdout: envelope({ session_id: "sess-old" }) };
      if (args.includes("--resume")) {
        return { error: "claude exited 1", stderr: "No conversation found with session ID sess-old" };
      }
      return { stdout: envelope({ session_id: "sess-new", result: "ok again" }) };
    });
    llm.deps.execFile = exec;

    await llm.ask(111, "раз");
    const r = await llm.ask(111, "два");
    assert.strictEqual(r, "ok again");
    assert.strictEqual(exec.calls.length, 3, "resume attempt + fresh retry");
  });

  it("is_error envelope throws an honest error — no fallback to other models", async () => {
    llm.deps.execFile = fakeExec([{ stdout: envelope({ is_error: true, result: "usage limit reached" }) }]);
    await assert.rejects(() => llm.ask(111, "x"), /usage limit/);
    assert.strictEqual(llm.getStats().claude.session.errors >= 1, true);
  });

  it("non-JSON CLI output is reported, not parsed as a reply", async () => {
    llm.deps.execFile = fakeExec([{ stdout: "Segmentation fault" }]);
    await assert.rejects(() => llm.ask(111, "x"), /не-JSON|non-JSON/i);
  });

  it("askOnce never resumes and never stores a session", async () => {
    const exec = fakeExec([
      { stdout: envelope({ session_id: "sess-Z", result: "42" }) },
      { stdout: envelope({ session_id: "sess-Y", result: "43" }) },
    ]);
    llm.deps.execFile = exec;
    const a = await llm.askOnce("вопрос", 222);
    await llm.askOnce("ещё", 222);
    assert.strictEqual(a, "42");
    for (const c of exec.calls) assert.ok(!c.args.includes("--resume"));
  });

  it("getStats exposes claude counters in the shape commands.js renders", async () => {
    llm.deps.execFile = fakeExec([{ stdout: envelope({ duration_ms: 500, total_cost_usd: 0.02 }) }]);
    await llm.ask(111, "x");
    const s = llm.getStats();
    assert.strictEqual(s.claude.model, "sonnet");
    assert.ok(s.claude.session.calls >= 1);
    assert.ok(s.claude.session.totalDurationMs >= 500);
    assert.ok(typeof s.claude.activeSessions === "number");
  });
});
