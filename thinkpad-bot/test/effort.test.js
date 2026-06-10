// TDD: tests for /effort command and per-session effort in llm.js
// Tests run BEFORE implementation; they drive the design of setEffort/getEffort/askOnce.

const { describe, it, before, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

let llmModule;
let effortModule;

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../llm.js")];
  llmModule = require("../llm.js");
});

afterEach(() => {
  mock.restoreAll();
});

describe("llm.js — per-session effort", () => {
  it("getEffort returns medium by default for any chatId", () => {
    assert.strictEqual(llmModule.getEffort(999), "medium");
    assert.strictEqual(llmModule.getEffort("abc"), "medium");
  });

  it("setEffort stores effort for a chatId", () => {
    llmModule.setEffort(100, "high");
    assert.strictEqual(llmModule.getEffort(100), "high");
  });

  it("setEffort low stores correctly", () => {
    llmModule.setEffort(101, "low");
    assert.strictEqual(llmModule.getEffort(101), "low");
  });

  it("setEffort invalid level throws", () => {
    assert.throws(() => llmModule.setEffort(102, "ultra"), /invalid effort/i);
  });

  it("different chatIds have independent effort", () => {
    llmModule.setEffort(200, "low");
    llmModule.setEffort(201, "high");
    assert.strictEqual(llmModule.getEffort(200), "low");
    assert.strictEqual(llmModule.getEffort(201), "high");
  });
});

describe("llm.js — askOnce", () => {
  it("askOnce is exported", () => {
    assert.strictEqual(typeof llmModule.askOnce, "function");
  });

  it("askOnce calls Anthropic with no stored history", async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          id: "msg_test",
          content: [{ type: "text", text: "Paris" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
    };
    const result = await llmModule.askOnce("Capital of France?");
    global.fetch = originalFetch;
    assert.ok(result.includes("Paris"), );
    // Should have made exactly 1 fetch call
    assert.strictEqual(calls.length, 1);
    // Should not have tools
    assert.ok(!calls[0].body.tools, "askOnce should not use tools");
  });

  it("askOnce throws on API error", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      status: 400,
      headers: { get: () => null },
      json: async () => ({ error: { type: "invalid_request", message: "bad input" } }),
    });
    await assert.rejects(
      () => llmModule.askOnce("test"),
      /bad input/
    );
    global.fetch = originalFetch;
  });
});

describe("/effort command", () => {
  it("effort.js module can be required", () => {
    delete require.cache[path.resolve(__dirname, "../commands/effort.js")];
    const effortCmd = require("../commands/effort.js");
    assert.ok(effortCmd.commands["/effort"], "/effort command must be exported");
  });

  it("/effort without arg returns current level", async () => {
    delete require.cache[path.resolve(__dirname, "../commands/effort.js")];
    const effortCmd = require("../commands/effort.js");
    // fresh chatId with default effort
    const result = await effortCmd.commands["/effort"].handler(9999, "");
    assert.ok(typeof result === "string", "Should return a string");
    assert.ok(result.includes("medium"), );
  });

  it("/effort high sets effort", async () => {
    delete require.cache[path.resolve(__dirname, "../commands/effort.js")];
    const effortCmd = require("../commands/effort.js");
    const result = await effortCmd.commands["/effort"].handler(9998, "high");
    assert.ok(result.includes("high"), );
  });

  it("/effort invalid returns error", async () => {
    delete require.cache[path.resolve(__dirname, "../commands/effort.js")];
    const effortCmd = require("../commands/effort.js");
    const result = await effortCmd.commands["/effort"].handler(9997, "ultra");
    assert.ok(result.toLowerCase().includes("low") || result.toLowerCase().includes("medium") || result.toLowerCase().includes("invalid"),
      );
  });
});
