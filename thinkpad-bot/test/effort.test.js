// /effort — per-chat reasoning-depth control mapped to the claude CLI --effort flag.

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let effortCmd;
let llm;

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.CLAUDE_MODEL = "sonnet";
  process.env.CLAUDE_EFFORT = "medium";
  process.env.CLAUDE_SESSIONS_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "effort-test-")), "sessions.json",
  );
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../llm.js")];
  delete require.cache[path.resolve(__dirname, "../commands/effort.js")];
  llm = require("../llm.js");
  effortCmd = require("../commands/effort.js");
});

describe("/effort command", () => {
  it("default effort is medium", () => {
    assert.strictEqual(llm.getEffort(999), "medium");
  });

  it("setEffort validates levels", () => {
    llm.setEffort(999, "high");
    assert.strictEqual(llm.getEffort(999), "high");
    assert.throws(() => llm.setEffort(999, "turbo"), /Invalid effort/);
  });

  it("/effort with no arg shows the current level and options", async () => {
    const out = await effortCmd.commands["/effort"].handler(777, "");
    assert.ok(out.includes("medium"));
    assert.ok(out.includes("/effort low"));
  });

  it("/effort high sets the level for the chat", async () => {
    const out = await effortCmd.commands["/effort"].handler(777, "high");
    assert.ok(out.includes("high"));
    assert.strictEqual(llm.getEffort(777), "high");
  });

  it("/effort with an invalid level explains the options", async () => {
    const out = await effortCmd.commands["/effort"].handler(777, "max");
    assert.ok(out.includes("low"));
    assert.strictEqual(llm.getEffort(777), "high", "level unchanged on invalid input");
  });
});
