const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { setTestEnv, clearToolCache } = require("./helpers/mock.js");

describe("bot.js", () => {
  let tg;

  before(() => {
    setTestEnv();
    clearToolCache();

    // Mock fetch for Telegram API
    const fetchCalls = [];
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      // Return empty updates on getUpdates
      if (url.includes("getUpdates")) {
        return { json: async () => ({ ok: true, result: [] }) };
      }
      if (url.includes("sendMessage")) {
        return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }
      if (url.includes("sendChatAction")) {
        return { json: async () => ({ ok: true }) };
      }
      if (url.includes("setMyCommands")) {
        return { json: async () => ({ ok: true }) };
      }
      return { json: async () => ({ ok: true }), headers: new Map() };
    };

    // Load telegram module
    delete require.cache[path.resolve(__dirname, "../telegram.js")];
    delete require.cache[path.resolve(__dirname, "../config.js")];
    tg = require("../telegram.js");
  });

  after(() => {
    mock.reset();
    global.fetch = undefined;
  });

  it("isAllowedUser должен вернуть true для разрешённого пользователя", () => {
    assert.ok(tg.isAllowedUser(12345));
  });

  it("isAllowedUser должен вернуть false для неразрешённого пользователя", () => {
    assert.ok(!tg.isAllowedUser(99999));
  });

  it("sendMessage должен вернуть ok", async () => {
    const result = await tg.sendMessage(12345, "test");
    assert.ok(result.ok);
  });

  it("sendLongMessage должен разбить длинное сообщение", async () => {
    const { api } = tg;
    const longText = "A".repeat(5000);
    // Don't actually send, just verify the function exists and handles long text
    const result = await tg.sendLongMessage(12345, longText);
    assert.ok(result);
  });

  it("keepTyping должен вернуть функцию остановки", () => {
    const stop = tg.keepTyping(12345);
    assert.strictEqual(typeof stop, "function");
    stop();
  });

  it("registerCommands должен зарегистрировать команды", async () => {
    const result = await tg.registerCommands();
    assert.ok(result);
  });

  it("config должен содержать обязательные поля", () => {
    delete require.cache[path.resolve(__dirname, "../config.js")];
    const config = require("../config.js");
    assert.ok(config.TELEGRAM_TOKEN);
    assert.ok(config.GROQ_KEY);
    assert.ok(config.ALLOWED_USER_ID);
    assert.ok(config.TG_API_BASE);
  });

  it("config должен валидировать ALLOWED_USER_ID как число", () => {
    const config = require("../config.js");
    assert.strictEqual(typeof config.ALLOWED_USER_ID, "number");
    assert.strictEqual(config.ALLOWED_USER_ID, 12345);
  });

  it("command registry должен загрузить команды", () => {
    const cmdRegistry = require("../commands/index.js");
    cmdRegistry.loadBuiltin();
    const all = cmdRegistry.getAll();
    assert.ok(all.length >= 5);
    assert.ok(cmdRegistry.get("/exec"));
    assert.ok(cmdRegistry.get("/logs"));
  });
});
