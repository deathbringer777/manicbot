// TDD: tests for /ask command (one-shot LLM without history)

const { describe, it, before, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
});

afterEach(() => {
  mock.restoreAll();
});

describe("/ask command", () => {
  it("ask.js can be required", () => {
    delete require.cache[path.resolve(__dirname, "../commands/ask.js")];
    const askCmd = require("../commands/ask.js");
    assert.ok(askCmd.commands["/ask"], "/ask command must be exported");
    assert.strictEqual(typeof askCmd.commands["/ask"].handler, "function");
  });

  it("/ask without arg returns usage hint", async () => {
    delete require.cache[path.resolve(__dirname, "../commands/ask.js")];
    const askCmd = require("../commands/ask.js");
    const result = await askCmd.commands["/ask"].handler(12345, "");
    assert.ok(typeof result === "string");
    assert.ok(result.length > 0, "Should return usage hint");
  });

  it("/ask with arg calls askOnce and returns result", async () => {
    // Mock fetch for Anthropic
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => ({
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        id: "msg_ask_test",
        content: [{ type: "text", text: "The answer is 42" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 15, output_tokens: 8 },
      }),
    });

    delete require.cache[path.resolve(__dirname, "../llm.js")];
    delete require.cache[path.resolve(__dirname, "../commands/ask.js")];
    const askCmd = require("../commands/ask.js");
    const result = await askCmd.commands["/ask"].handler(12345, "What is the answer?");
    global.fetch = originalFetch;

    assert.ok(typeof result === "string", "Should return string");
    assert.ok(result.includes("42"), );
  });

  it("/ask does not add to conversation history", async () => {
    const fetchCalls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      fetchCalls.push(JSON.parse(opts.body));
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          content: [{ type: "text", text: "short answer" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
    };

    delete require.cache[path.resolve(__dirname, "../llm.js")];
    delete require.cache[path.resolve(__dirname, "../commands/ask.js")];
    const askCmd = require("../commands/ask.js");
    
    // Call /ask twice
    await askCmd.commands["/ask"].handler(12345, "Question 1");
    await askCmd.commands["/ask"].handler(12345, "Question 2");
    global.fetch = originalFetch;

    // Each call should have exactly 1 user message (no history accumulation)
    for (const body of fetchCalls) {
      const userMsgs = body.messages.filter(m => m.role === "user");
      assert.strictEqual(userMsgs.length, 1, "askOnce should send exactly 1 user message per call");
    }
  });
});
