const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

describe("llm.js", () => {
  let llm;
  let fetchCalls;

  before(() => {
    let groqCallCount = 0;
    const originalFetch = global.fetch;
    fetchCalls = [];
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      const body = JSON.parse(opts.body);
      const hasTools = body.tools !== undefined;
      const isToolCall = hasTools && groqCallCount === 0;
      groqCallCount++;
      return {
        json: async () => ({
          id: "chatcmpl-test",
          model: "llama-3.3-70b-versatile",
          choices: [{
            index: 0,
            message: isToolCall
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: { name: "run_shell", arguments: '{"command":"echo hello"}' },
                  }],
                }
              : {
                  role: "assistant",
                  content: "Test response",
                },
            finish_reason: isToolCall ? "tool_calls" : "stop",
          }],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 20,
            total_tokens: 70,
          },
          error: null,
        }),
        headers: {
          get: (h) => {
            const map = {
              "x-ratelimit-limit-requests": "30",
              "x-ratelimit-remaining-requests": "29",
              "x-ratelimit-limit-tokens": "6000",
              "x-ratelimit-remaining-tokens": "5900",
              "x-ratelimit-limit-tokens-per-day": "500000",
              "x-ratelimit-remaining-tokens-per-day": "490000",
            };
            return map[h] || null;
          },
        },
      };
    };

    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.GROQ_KEY = "test:key";
    process.env.ALLOWED_USER_ID = "12345";
    process.env.CHAT_ID = "12345";
    process.env.GROQ_MODEL = "test-model";
    delete require.cache[path.resolve(__dirname, "../config.js")];
    delete require.cache[path.resolve(__dirname, "../llm.js")];
    llm = require("../llm.js");

    this.originalFetch = originalFetch;
  });

  after(() => {
    global.fetch = this.originalFetch;
    mock.reset();
  });

  it("callGroq должен вызвать Groq API и вернуть ответ", async () => {
    fetchCalls = [];
    const data = await llm.callGroq([{ role: "user", content: "test" }], true);
    assert.ok(data.choices);
    assert.strictEqual(data.choices[0].message.tool_calls[0].function.name, "run_shell");
    assert.ok(fetchCalls.some(c => c.url.includes("groq.com")));
  });

  it("callGroq без tools должен вернуть текстовый ответ", async () => {
    fetchCalls = [];
    const data = await llm.callGroq([{ role: "user", content: "test" }], false);
    assert.strictEqual(data.choices[0].message.content, "Test response");
  });

  it("ask должен обработать диалог с tool_calls", async () => {
    fetchCalls = [];
    const result = await llm.ask(12345, "выполни команду");
    assert.ok(result);
  });

  it("getStats должен вернуть статистику Groq", () => {
    const stats = llm.getStats();
    assert.ok(stats.model);
    assert.ok(stats.session);
    assert.ok(stats.rl);
  });

  it("resetHistory должен очистить историю чата", () => {
    llm.ask(12345, "test");
    llm.resetHistory(12345);
    const stats = llm.getStats();
    assert.ok(stats); // no crash
  });
});
