const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const ENV_BAK = { ...process.env };

describe("config.js", () => {
  before(() => {
    mock.method(require("dotenv"), "config", () => ({}));
    delete process.env.TELEGRAM_TOKEN;
    delete process.env.GROQ_KEY;
    delete process.env.ALLOWED_USER_ID;
    delete process.env.CHAT_ID;
    delete process.env.GROQ_MODEL;
  });

  after(() => {
    mock.reset();
    Object.assign(process.env, ENV_BAK);
  });

  it("должен загрузить конфиг из .env файла", () => {
    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.GROQ_KEY = "test:key";
    process.env.ALLOWED_USER_ID = "12345";
    process.env.CHAT_ID = "12345";
    process.env.GROQ_MODEL = "test-model";

    // Force re-read by clearing module cache
    delete require.cache[path.resolve(__dirname, "../config.js")];
    const config = require("../config.js");

    assert.strictEqual(config.TELEGRAM_TOKEN, "test:token");
    assert.strictEqual(config.GROQ_KEY, "test:key");
    assert.strictEqual(config.ALLOWED_USER_ID, 12345);
    assert.strictEqual(config.CHAT_ID, 12345);
    assert.strictEqual(config.GROQ_MODEL, "test-model");
    assert.strictEqual(config.POLL_TIMEOUT, 30);
    assert.strictEqual(config.MAX_TOKENS, 4096);
    assert.strictEqual(config.TEMPERATURE, 0.2);
  });

  it("должен упасть если нет TELEGRAM_TOKEN", () => {
    delete process.env.TELEGRAM_TOKEN;
    delete require.cache[path.resolve(__dirname, "../config.js")];
    assert.throws(() => require("../config.js"), /TELEGRAM_TOKEN/);
  });

  it("должен упасть если нет GROQ_KEY", () => {
    process.env.TELEGRAM_TOKEN = "test:token";
    delete process.env.GROQ_KEY;
    delete require.cache[path.resolve(__dirname, "../config.js")];
    assert.throws(() => require("../config.js"), /GROQ_KEY/);
  });

  it("должен упасть если нет ALLOWED_USER_ID", () => {
    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.GROQ_KEY = "test:key";
    delete process.env.ALLOWED_USER_ID;
    delete require.cache[path.resolve(__dirname, "../config.js")];
    assert.throws(() => require("../config.js"), /ALLOWED_USER_ID/);
  });

  it("должен содержать ENV с DISPLAY и DBUS_SESSION_BUS_ADDRESS", () => {
    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.GROQ_KEY = "test:key";
    process.env.ALLOWED_USER_ID = "12345";
    process.env.CHAT_ID = "12345";
    process.env.GROQ_MODEL = "test-model";
    delete require.cache[path.resolve(__dirname, "../config.js")];
    const config = require("../config.js");

    assert.ok(config.ENV.DISPLAY);
    assert.ok(config.ENV.DBUS_SESSION_BUS_ADDRESS);
    assert.ok(config.ENV.HOME);
    assert.ok(config.ENV.XDG_RUNTIME_DIR);
  });
});
