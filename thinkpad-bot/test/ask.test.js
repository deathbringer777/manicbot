// /ask — one-shot Claude question without chat history (llm.askOnce).

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let askCmd;
let llm;

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.CLAUDE_SESSIONS_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "ask-test-")), "sessions.json",
  );
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../llm.js")];
  delete require.cache[path.resolve(__dirname, "../commands/ask.js")];
  llm = require("../llm.js");
  askCmd = require("../commands/ask.js");
});

describe("/ask command", () => {
  it("exports the /ask handler", () => {
    assert.ok(askCmd.commands["/ask"]);
    assert.strictEqual(typeof askCmd.commands["/ask"].handler, "function");
  });

  it("without arg returns a usage hint", async () => {
    const result = await askCmd.commands["/ask"].handler(12345, "");
    assert.ok(typeof result === "string" && result.length > 0);
  });

  it("with arg goes through llm.askOnce (one-shot, no --resume)", async () => {
    const calls = [];
    llm.deps.execFile = (cmd, args, opts, cb) => {
      calls.push({ cmd, args });
      cb(null, JSON.stringify({ is_error: false, result: "The answer is 42", session_id: "s" }), "");
    };
    const result = await askCmd.commands["/ask"].handler(12345, "What is the answer?");
    assert.ok(result.includes("42"));
    assert.strictEqual(calls.length, 1);
    assert.ok(!calls[0].args.includes("--resume"), "askOnce must not resume chat history");
  });
});
