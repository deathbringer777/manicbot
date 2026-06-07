const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

describe("notify.js", () => {
  let originalArgv;
  let fetchCalls;

  before(() => {
    originalArgv = process.argv;
    fetchCalls = [];

    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.CHAT_ID = "12345";
    process.env.ALLOWED_USER_ID = "12345";

    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { json: async () => ({ ok: true }) };
    };
  });

  after(() => {
    mock.reset();
    global.fetch = undefined;
  });

  it("должен отправить сообщение при наличии аргументов", async () => {
    process.argv = ["node", "notify.js", "test", "message"];
    delete require.cache[path.resolve(__dirname, "../notify.js")];
    require("../notify.js");

    // Wait a tick for fetch to fire
    await new Promise(r => setTimeout(r, 50));

    const call = fetchCalls.find(c => c.url.includes("sendMessage"));
    assert.ok(call, "должен быть вызов sendMessage");
    const body = JSON.parse(call.opts.body);
    assert.ok(body.text.includes("test message"));
  });

  it("должен завершиться без ошибок без аргументов", () => {
    process.argv = ["node", "notify.js"];
    fetchCalls = [];
    delete require.cache[path.resolve(__dirname, "../notify.js")];
    require("../notify.js");
    assert.strictEqual(fetchCalls.length, 0);
  });

  it("должен использовать TELEGRAM_TOKEN и CHAT_ID из .env", () => {
    process.argv = ["node", "notify.js", "hello"];
    fetchCalls = [];
    delete require.cache[path.resolve(__dirname, "../notify.js")];
    require("../notify.js");

    const call = fetchCalls.find(c => c.url.includes("sendMessage"));
    assert.ok(call, "должен быть вызов sendMessage");
    assert.ok(call.url.includes("test:token"));
  });
});
