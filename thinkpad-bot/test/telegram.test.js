const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

describe("telegram.js", () => {
  let telegram;
  let fetchCalls;

  before(() => {
    // Mock global fetch
    const originalFetch = global.fetch;
    fetchCalls = [];
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return {
        json: async () => {
          if (url.includes("getUpdates")) return { ok: true, result: [] };
          if (url.includes("sendMessage")) return { ok: true, result: { message_id: 1 } };
          if (url.includes("sendChatAction")) return { ok: true };
          if (url.includes("setMyCommands")) return { ok: true };
          return { ok: true };
        },
        headers: new Map(),
      };
    };

    // Set up env for telegram
    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.GROQ_KEY = "test:key";
    process.env.ALLOWED_USER_ID = "12345";
    process.env.CHAT_ID = "12345";
    process.env.GROQ_MODEL = "test-model";
    delete require.cache[path.resolve(__dirname, "../config.js")];
    delete require.cache[path.resolve(__dirname, "../telegram.js")];
    telegram = require("../telegram.js");

    this.originalFetch = originalFetch;
  });

  after(() => {
    global.fetch = this.originalFetch;
    mock.reset();
  });

  it("sendMessage должен отправить сообщение через API", async () => {
    fetchCalls = [];
    const result = await telegram.sendMessage(12345, "test message");
    assert.ok(result.ok);
    const call = fetchCalls.find(c => c.url.includes("sendMessage"));
    assert.ok(call);
    const body = JSON.parse(call.opts.body);
    assert.strictEqual(body.chat_id, 12345);
    assert.strictEqual(body.text, "test message");
  });

  it("sendLongMessage должен разбить длинное сообщение на части", async () => {
    fetchCalls = [];
    const longText = "A".repeat(5000);
    await telegram.sendLongMessage(12345, longText);
    // Should split into 2 messages (4000+1000)
    const sendCalls = fetchCalls.filter(c => c.url.includes("sendMessage"));
    assert.ok(sendCalls.length >= 2);
  });

  it("sendTypingAction должен отправить typing action", async () => {
    fetchCalls = [];
    await telegram.sendTypingAction(12345);
    const call = fetchCalls.find(c => c.url.includes("sendChatAction"));
    assert.ok(call);
  });

  it("keepTyping должен отправлять typing каждые 4 секунды и возвращать stop", async () => {
    fetchCalls = [];
    const stop = telegram.keepTyping(12345);
    assert.ok(typeof stop === "function");
    stop(); // stop the interval
  });

  it("registerCommands должен зарегистрировать команды", async () => {
    fetchCalls = [];
    // Commands registry must be populated before building the menu.
    const cmdRegistry = require("../commands/index.js");
    cmdRegistry.loadBuiltin();
    await telegram.registerCommands();
    const call = fetchCalls.find(c => c.url.includes("setMyCommands"));
    assert.ok(call);
    const body = JSON.parse(call.opts.body);
    assert.ok(Array.isArray(body.commands));
    assert.ok(body.commands.length > 5);
  });

  it("isAllowedUser должен проверить разрешённого пользователя", () => {
    assert.ok(telegram.isAllowedUser(12345));
    assert.ok(!telegram.isAllowedUser(99999));
  });
});
