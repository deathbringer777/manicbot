// llm.js v6 — Claude Code CLI adapter.
//
// Every text-LLM request goes through `claude -p` (headless print mode) so it
// bills the owner's Max SUBSCRIPTION via the CLI's OAuth credentials — never
// the metered Anthropic API (the adapter strips ANTHROPIC_API_KEY from the
// child env). There are intentionally NO fallback models: when Claude is
// unavailable the bot reports the error honestly instead of silently
// degrading to a weaker LLM. Voice transcription stays on Groq Whisper
// (stt.js) — Claude does not do speech-to-text.
//
// Conversation continuity: claude CLI sessions, one per Telegram chat,
// resumed with --resume <session_id> and persisted across bot restarts.
// Claude's own agentic tools (Bash, Read, ...) replace the old homegrown
// tool-call loop; access is gated upstream by ALLOWED_USER_ID — this bot
// talks to exactly one human, its owner, on the owner's own machine.

const fs = require("fs");
const { execFile } = require("child_process");
const config = require("./config.js");
const tools = require("./tools.js");

// Test seam: tests replace deps.execFile with a fake.
const deps = { execFile };

const sessions = new Map();      // chatId → claude session uuid
const sessionEffort = new Map(); // chatId → low|medium|high

const stats = {
  model: config.CLAUDE_MODEL,
  startedAt: new Date().toISOString(),
  lastUpdated: null,
  session: { calls: 0, errors: 0, totalDurationMs: 0, totalCostUsd: 0 },
};

// ── Session persistence (survives bot restarts; /tmp is fine — it's context, not data) ──

function loadSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(config.CLAUDE_SESSIONS_FILE, "utf8"));
    for (const [k, v] of Object.entries(data)) sessions.set(Number(k) || k, v);
  } catch { /* first start */ }
}

function saveSessions() {
  try {
    fs.writeFileSync(config.CLAUDE_SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
  } catch { /* non-fatal */ }
}

loadSessions();

// ── System prompt ─────────────────────────────────────────────────────────────

const CLI_RULES = `You are the ThinkPad ops assistant, talking to your owner through his private Telegram bot.

- Reply in Russian unless explicitly asked otherwise. Be concise — replies are read on a phone.
- PLAIN TEXT ONLY: no Markdown (#, *, \`\`\`), no HTML tags. Short paragraphs and simple lists with «—».
- You run on the owner's Ubuntu ThinkPad (GNOME Wayland) with full shell access. Cheat sheet:
  pm2 ls / pm2 logs <name> --lines 30 --nostream / pm2 restart <name> — the cron fleet;
  ~/manicbot-backend — ManicBot sidecar crons (README.md explains them);
  mbshot /tmp/shot.png — screenshot; ydotool — GUI input (YDOTOOL_SOCKET is set).
- NEVER pm2 restart/stop/delete "tg-bot" — that kills the process you are running inside. Tell the owner to use the bot's /ps screen instead.
- Refuse destructive operations (rm -rf outside /tmp, reboot, mkfs, dd, ufw changes) — explain and suggest a manual path.
- When asked to check or diagnose something, actually run the commands and report real findings, not guesses.`;

function systemPrompt() {
  const ctx = tools.getContextText();
  return ctx ? `${CLI_RULES}\n\n## Machine context\n${ctx}` : CLI_RULES;
}

// ── CLI plumbing ──────────────────────────────────────────────────────────────

function cleanEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // subscription only — never bill the metered API
  return env;
}

function buildArgs(text, { resume = null, effort = null, system = null } = {}) {
  const args = [
    "-p", text,
    "--model", config.CLAUDE_MODEL,
    "--effort", effort || config.CLAUDE_EFFORT,
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--append-system-prompt", system || systemPrompt(),
  ];
  if (resume) args.push("--resume", resume);
  return args;
}

function runClaude(args) {
  return new Promise((resolve, reject) => {
    deps.execFile(config.CLAUDE_BIN, args, {
      env: cleanEnv(),
      cwd: process.env.HOME || config.BOT_DIR,
      timeout: config.CLAUDE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      killSignal: "SIGKILL",
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || "").trim().slice(-400) || err.message;
        return reject(new Error(`claude CLI: ${detail}`));
      }
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        return reject(new Error(`claude вернул не-JSON ответ: ${String(stdout).slice(0, 200)}`));
      }
      if (envelope.is_error) {
        return reject(new Error(envelope.result || envelope.subtype || "unknown claude error"));
      }
      resolve(envelope);
    });
  });
}

function recordSuccess(envelope, startedAt) {
  stats.session.calls++;
  stats.session.totalDurationMs += envelope.duration_ms || (Date.now() - startedAt);
  stats.session.totalCostUsd += envelope.total_cost_usd || 0;
  stats.lastUpdated = new Date().toISOString();
}

function isDeadSessionError(err) {
  return /no conversation|session/i.test(err.message || "");
}

// ── Public API (shape preserved from v5 for bot.js/commands) ──────────────────

async function ask(chatId, userText) {
  const effort = getEffort(chatId);
  const resume = sessions.get(chatId) || null;
  const startedAt = Date.now();

  let envelope;
  try {
    envelope = await runClaude(buildArgs(userText, { resume, effort }));
  } catch (err) {
    // A stale/garbage-collected session must not break the chat — start fresh.
    if (resume && isDeadSessionError(err)) {
      sessions.delete(chatId);
      saveSessions();
      envelope = await runClaude(buildArgs(userText, { effort }));
    } else {
      stats.session.errors++;
      stats.lastUpdated = new Date().toISOString();
      throw err;
    }
  }

  recordSuccess(envelope, startedAt);
  if (envelope.session_id) {
    sessions.set(chatId, envelope.session_id);
    saveSessions();
  }
  return envelope.result || "(пустой ответ)";
}

const ASK_ONCE_SYSTEM = "Answer directly and concisely in the language of the question (default Russian). Plain text only. Avoid using tools unless strictly necessary.";

async function askOnce(userText, chatId = null) {
  const effort = chatId ? getEffort(chatId) : config.CLAUDE_EFFORT;
  const startedAt = Date.now();
  try {
    const envelope = await runClaude(buildArgs(userText, { effort, system: ASK_ONCE_SYSTEM }));
    recordSuccess(envelope, startedAt);
    return envelope.result || "(пустой ответ)";
  } catch (err) {
    stats.session.errors++;
    stats.lastUpdated = new Date().toISOString();
    throw err;
  }
}

function setEffort(chatId, level) {
  const valid = ["low", "medium", "high"];
  if (!valid.includes(level)) throw new Error("Invalid effort: must be low, medium, or high");
  sessionEffort.set(chatId, level);
}

function getEffort(chatId) {
  return sessionEffort.get(chatId) || config.CLAUDE_EFFORT;
}

function resetHistory(chatId) {
  sessions.delete(chatId);
  saveSessions();
}

function getStats() {
  return {
    claude: {
      ...stats,
      session: { ...stats.session },
      activeSessions: sessions.size,
    },
  };
}

module.exports = {
  ask,
  askOnce,
  setEffort,
  getEffort,
  resetHistory,
  getStats,
  deps,
};
