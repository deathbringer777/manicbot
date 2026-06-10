const { describe, it, before, after, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

function makeHeaders(isOpenCode = false) {
  if (isOpenCode) return { get: () => null };
  return {
    get: (h) => ({
      "x-ratelimit-limit-requests": "30",
      "x-ratelimit-remaining-requests": "29",
      "x-ratelimit-limit-tokens": "6000",
      "x-ratelimit-remaining-tokens": "5900",
      "x-ratelimit-limit-tokens-per-day": "500000",
      "x-ratelimit-remaining-tokens-per-day": "490000",
    })[h] || null,
  };
}

let llmModule;

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test:key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.GROQ_MODEL = "llama-3.3-70b-versatile";
  process.env.OPENCODE_KEY = "sk-test:opencode-key";
  process.env.OPENCODE_MODEL = "big-pickle";
  process.env.ANTHROPIC_API_KEY = ""; // empty string is falsy; dotenv won't override existing vars
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../llm.js")];
  llmModule = require("../llm.js");
});

after(() => {
  mock.reset();
});

describe("llm.js — OpenCode Zen", () => {
  let originalFetch;
  let fetchCalls;
  let groqCallIndex;

  // Helpers
  function groqTextResponse(content, usage) {
    return {
      id: "chatcmpl-groq",
      model: "llama-3.3-70b-versatile",
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
      usage: usage || { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      error: null,
    };
  }

  function groqToolCallResponse(toolName, args) {
    return {
      id: "chatcmpl-groq-tool",
      model: "llama-3.3-70b-versatile",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(args) },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 60, completion_tokens: 10, total_tokens: 70 },
      error: null,
    };
  }

  function groqError(errorCode, message) {
    return {
      error: { code: errorCode, message },
      choices: [],
    };
  }

  function openCodeResponse(content, opts = {}) {
    return {
      id: "chatcmpl-oc",
      model: "big-pickle",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(opts.reasoningContent ? { reasoning_content: opts.reasoningContent } : {}),
        },
        finish_reason: opts.finishReason || "stop",
      }],
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      error: null,
    };
  }

  function openCodeError(code, message) {
    return {
      error: { code, message },
      choices: [],
    };
  }

  beforeEach(() => {
    fetchCalls = [];
    groqCallIndex = 0;
    originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      const isOpenCode = url.includes("opencode.ai");

      if (isOpenCode) {
        const body = JSON.parse(opts.body);
        return {
          json: async () => fetchCalls._openCodeResponse || openCodeResponse("Ответ от OpenCode"),
          headers: makeHeaders(true),
        };
      }

      // Groq
      const response = fetchCalls._groqResponse
        ? (typeof fetchCalls._groqResponse === "function"
          ? fetchCalls._groqResponse(groqCallIndex++)
          : fetchCalls._groqResponse)
        : groqTextResponse("Ответ от Groq");

      return {
        json: async () => response,
        headers: makeHeaders(false),
      };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // Reset module-level state between tests
    if (!process.env.OPENCODE_KEY) process.env.OPENCODE_KEY = "sk-test:opencode-key";
    process.env.ANTHROPIC_API_KEY = ""; // empty = falsy; prevents dotenv from re-setting on require()
    delete require.cache[path.resolve(__dirname, "../config.js")];
    delete require.cache[path.resolve(__dirname, "../llm.js")];
    llmModule = require("../llm.js");
  });

  // ── callOpenCode ──────────────────────────────────────────────────────────────

  describe("callOpenCode — очистка истории", () => {
    it("должен удалить tool-сообщения из истории", async () => {
      const messages = [
        { role: "user", content: "привет" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "test" } }] },
        { role: "tool", tool_call_id: "c1", content: "результат" },
      ];
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode(messages, false);

      const sentBody = JSON.parse(fetchCalls[0].opts.body);
      const sentRoles = sentBody.messages.map(m => m.role);
      assert.ok(!sentRoles.includes("tool"), "tool-сообщения не должны быть в запросе");
      assert.strictEqual(sentBody.messages.length, 1);
      assert.strictEqual(sentBody.messages[0].role, "user");
    });

    it("должен удалить tool-only assistant сообщения", async () => {
      const messages = [
        { role: "user", content: "тест" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "test", arguments: "{}" } }] },
      ];
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode(messages, false);

      const sentBody = JSON.parse(fetchCalls[0].opts.body);
      assert.strictEqual(sentBody.messages.length, 1);
    });

    it("должен сохранить assistant сообщения с контентом", async () => {
      const messages = [
        { role: "user", content: "расскажи анекдот" },
        { role: "assistant", content: "Вот анекдот:" },
      ];
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode(messages, false);

      const sentBody = JSON.parse(fetchCalls[0].opts.body);
      assert.strictEqual(sentBody.messages.length, 2);
      assert.strictEqual(sentBody.messages[1].content, "Вот анекдот:");
    });

    it("должен удалить reasoning_content из сообщений", async () => {
      const messages = [
        { role: "user", content: "задача" },
        { role: "assistant", content: "думаю...", reasoning_content: "надо подумать" },
      ];
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode(messages, false);

      const sentBody = JSON.parse(fetchCalls[0].opts.body);
      const lastMsg = sentBody.messages[sentBody.messages.length - 1];
      assert.strictEqual(lastMsg.reasoning_content, undefined);
    });

    it("должен удалить tool_calls из сообщений", async () => {
      const messages = [
        { role: "user", content: "команда" },
        { role: "assistant", content: "выполняю", tool_calls: [{ id: "x", function: { name: "test" } }] },
      ];
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode(messages, false);

      const sentBody = JSON.parse(fetchCalls[0].opts.body);
      const lastMsg = sentBody.messages[sentBody.messages.length - 1];
      assert.strictEqual(lastMsg.tool_calls, undefined);
    });
  });

  describe("callOpenCode — запрос к API", () => {
    it("должен вызвать OpenCode Zen и вернуть структуру ответа", async () => {
      fetchCalls._openCodeResponse = openCodeResponse("Привет от Big Pickle!");

      const data = await llmModule.callOpenCode([{ role: "user", content: "hi" }], false);

      assert.ok(data.choices);
      assert.strictEqual(data.choices[0].message.content, "Привет от Big Pickle!");
      assert.strictEqual(data.model, "big-pickle");
    });

    it("должен использовать правильный URL и ключ", async () => {
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode([{ role: "user", content: "test" }], false);

      const call = fetchCalls.find(c => c.url.includes("opencode.ai"));
      assert.ok(call, "должен быть вызов OpenCode API");
      assert.ok(call.url.includes("zen/v1/chat/completions"));
      assert.ok(call.opts.headers.Authorization?.includes("sk-test"));
    });

    it("должен передать правильное тело запроса", async () => {
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.callOpenCode([{ role: "user", content: "тест" }], false);

      const sentBody = JSON.parse(fetchCalls[0].opts.body);
      assert.strictEqual(sentBody.model, "big-pickle");
      assert.strictEqual(sentBody.max_tokens, 32000);
      assert.strictEqual(sentBody.temperature, 0.2);
      assert.strictEqual(sentBody.messages[0].content, "тест");
    });

    it("должен пробросить ошибку API через data.error", async () => {
      fetchCalls._openCodeResponse = openCodeError("invalid_api_key", "Invalid key");

      const data = await llmModule.callOpenCode([{ role: "user", content: "test" }], false);

      assert.ok(data.error);
      assert.strictEqual(data.error.code, "invalid_api_key");
    });
  });

  describe("callOpenCode — статистика", () => {
    it("должен считать вызовы и токены", async () => {
      const statsBefore = llmModule.getOpenCodeStats();
      const beforeCalls = statsBefore.session.calls;
      const beforeTokens = statsBefore.session.totalTokens;

      fetchCalls._openCodeResponse = openCodeResponse("ок", { reasoningContent: "думаю..." });
      await llmModule.callOpenCode([{ role: "user", content: "тест" }], false);

      const statsAfter = llmModule.getOpenCodeStats();
      assert.strictEqual(statsAfter.session.calls, beforeCalls + 1);
      assert.strictEqual(statsAfter.session.totalTokens, beforeTokens + 300); // prompt 200 + completion 100
      assert.strictEqual(statsAfter.model, "big-pickle");
      assert.ok(statsAfter.lastUpdated);
    });

    it("должен считать несколько последовательных вызовов", async () => {
      fetchCalls._openCodeResponse = openCodeResponse("ок");
      await llmModule.callOpenCode([{ role: "user", content: "раз" }], false);

      fetchCalls._openCodeResponse = openCodeResponse("два");
      await llmModule.callOpenCode([{ role: "user", content: "два" }], false);

      const stats = llmModule.getOpenCodeStats();
      assert.strictEqual(stats.session.calls, 2);
      assert.strictEqual(stats.session.totalTokens, 600);
    });
  });

  // ── ask() fallback Groq → OpenCode ──────────────────────────────────────────

  describe("ask() — fallback на OpenCode Zen", () => {
    it("должен переключиться на Groq fast при rate limit", async () => {
      let groqCalls = 0;
      fetchCalls._groqResponse = () => {
        if (groqCalls++ === 0) return groqError("rate_limit_exceeded", "Rate limit");
        return groqTextResponse("ok");
      };
      fetchCalls._openCodeResponse = openCodeResponse("ok");

      const reply = await llmModule.ask(111, "тест");

      const groqFetches = fetchCalls.filter(c => c.url.includes("groq.com"));
      assert.strictEqual(groqFetches.length, 2, "должен быть второй вызов Groq с fast моделью");
      const secondBody = JSON.parse(groqFetches[1].opts.body);
      assert.strictEqual(secondBody.model, "llama-3.1-8b-instant");
    });

    it("должен упасть на OpenCode Zen если Groq fast тоже в лимите", async () => {
      fetchCalls._groqResponse = () => groqError("rate_limit_exceeded", "Rate limit");
      fetchCalls._openCodeResponse = openCodeResponse("Ответ от DeepSeek!");

      const reply = await llmModule.ask(222, "тест");

      assert.ok(reply.includes("DeepSeek") || reply.includes("Ответ от"));
      const openCodeFetches = fetchCalls.filter(c => c.url.includes("opencode.ai"));
      assert.strictEqual(openCodeFetches.length, 1, "должен быть ровно 1 вызов OpenCode");
    });

    it("должен вернуть сообщение о недоступности если OpenCode не настроен", async () => {
      process.env.OPENCODE_KEY = "";
      process.env.ANTHROPIC_API_KEY = "";
      delete require.cache[path.resolve(__dirname, "../config.js")];
      delete require.cache[path.resolve(__dirname, "../llm.js")];
      const llmNoKey = require("../llm.js");

      fetchCalls._groqResponse = () => groqError("rate_limit_exceeded", "Rate limit");

      const reply = await llmNoKey.ask(333, "тест");

      assert.ok(reply.includes("Лимит"), `сообщение должно содержать "Лимит", получили: ${reply}`);
    });

    it("должен вызвать OpenCode без tools (useTools=false)", async () => {
      fetchCalls._groqResponse = () => groqError("rate_limit_exceeded", "Rate limit");
      fetchCalls._openCodeResponse = openCodeResponse("ок");

      await llmModule.ask(444, "тест");

      const ocCall = fetchCalls.find(c => c.url.includes("opencode.ai"));
      const ocBody = JSON.parse(ocCall.opts.body);
      assert.strictEqual(ocBody.tools, undefined, "OpenCode не должен получать tools");
      assert.strictEqual(ocBody.tool_choice, undefined);
    });

    it("должен вернуть сообщение если OpenCode ответил ошибкой", async () => {
      fetchCalls._groqResponse = () => groqError("rate_limit_exceeded", "Rate limit");
      fetchCalls._openCodeResponse = openCodeError("server_error", "OpenCode временно недоступен");

      await assert.rejects(
        () => llmModule.ask(555, "тест"),
        /OpenCode временно недоступен/
      );
    });
  });

  // ── ask() — обработка ошибок Groq ───────────────────────────────────────────

  describe("ask() — обработка ошибок генерации", () => {
    it("должен retry без tools при failed_generation от Groq", async () => {
      let groqCalls = 0;
      fetchCalls._groqResponse = () => {
        if (groqCalls++ === 0) {
          return {
            id: "chatcmpl-fail",
            model: "test",
            choices: [],
            error: { type: "failed_generation", message: "Generation failed" },
          };
        }
        return groqTextResponse("OK после retry");
      };

      const reply = await llmModule.ask(666, "тест");
      assert.strictEqual(reply, "OK после retry");
      const groqFetches = fetchCalls.filter(c => c.url.includes("groq.com"));
      assert.strictEqual(groqFetches.length, 2);

      // Первый вызов — с tools, второй — без
      const body0 = JSON.parse(groqFetches[0].opts.body);
      const body1 = JSON.parse(groqFetches[1].opts.body);
      assert.ok(body0.tools, "первый вызов должен иметь tools");
      assert.strictEqual(body1.tools, undefined, "второй вызов не должен иметь tools");
    });

    it("должен retry без tools при tool_use_failed от Groq", async () => {
      let groqCalls = 0;
      fetchCalls._groqResponse = () => {
        if (groqCalls++ === 0) {
          return {
            choices: [],
            error: { code: "tool_use_failed", message: "Tool use failed" },
          };
        }
        return groqTextResponse("OK");
      };

      const reply = await llmModule.ask(777, "тест");
      assert.strictEqual(reply, "OK");
    });
  });

  // ── getStats ────────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("должен вернуть объекты groq и opencode со статистикой", () => {
      const stats = llmModule.getStats();
      assert.ok(stats.groq, "должен быть groq");
      assert.ok(stats.opencode, "должен быть opencode");
      assert.ok(stats.groq.model);
      assert.ok(stats.groq.session);
      assert.ok(stats.groq.rl);
      assert.ok(stats.opencode.model);
      assert.ok(stats.opencode.session);
    });

    it("должен обновить opencode статистику после вызова", async () => {
      fetchCalls._openCodeResponse = openCodeResponse("привет");

      await llmModule.callOpenCode([{ role: "user", content: "hi" }], false);

      const stats = llmModule.getStats();
      assert.strictEqual(stats.opencode.session.calls, 1);
      assert.strictEqual(stats.opencode.model, "big-pickle");
    });

    it("getOpenCodeStats должен вернуть отдельную статистику", () => {
      const stats = llmModule.getOpenCodeStats();
      assert.ok(stats.model);
      assert.ok(stats.session);
      assert.strictEqual(stats.model, "big-pickle");
    });
  });

  // ── resetHistory ────────────────────────────────────────────────────────────

  describe("resetHistory", () => {
    it("должен очистить историю чата", () => {
      llmModule.ask(888, "test");
      llmModule.resetHistory(888);
      const stats = llmModule.getStats();
      assert.ok(stats); // no crash
    });
  });
});
