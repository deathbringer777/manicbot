const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { clearToolCache, setTestEnv } = require("../helpers/mock.js");

describe("tools/keyboard.js", () => {
  let keyboard;
  let shCalls;
  const { mock } = require("node:test");

  function mockShReturn(value = "(нет вывода)") {
    delete require.cache[require.resolve("../../tools/helpers.js")];
    const helpers = require("../../tools/helpers.js");
    mock.method(helpers, "sh", (cmd) => {
      shCalls.push(cmd);
      return value;
    });
  }

  before(() => {
    setTestEnv();
    shCalls = [];
    clearToolCache();
    mockShReturn();
    keyboard = require("../../tools/keyboard.js");
  });

  after(() => mock.reset());

  it("typeText должен напечатать текст через wtype", async () => {
    const result = await keyboard.typeText("Hello world");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("wtype 'Hello world'")));
  });

  it("typeText должен экранировать одинарные кавычки", async () => {
    const result = await keyboard.typeText("It's done");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("'It'\\''s done'")));
  });

  it("hotkey ctrl+c", async () => {
    const result = await keyboard.hotkey("ctrl+c");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 29+46")));
  });

  it("hotkey ctrl+shift+esc", async () => {
    const result = await keyboard.hotkey("ctrl+shift+esc");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 29+42+1") || c.includes("ydotool key 29+42+27")));
  });

  it("hotkey alt+tab", async () => {
    const result = await keyboard.hotkey("alt+tab");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 56+15")));
  });

  it("hotkey super", async () => {
    const result = await keyboard.hotkey("super");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 125")));
  });

  it("pressKey enter", async () => {
    const result = await keyboard.pressKey("enter");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 28")));
  });

  it("pressKey err на неизвестную клавишу", async () => {
    const result = await keyboard.pressKey("nonexistent");
    assert.ok(!result.ok);
  });

  it("holdKey/releaseKey", async () => {
    shCalls = [];
    const r1 = await keyboard.holdKey("ctrl");
    assert.ok(r1.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 29 -d 0")));
    const r2 = await keyboard.releaseKey("ctrl");
    assert.ok(r2.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool key 29 -u 0")));
  });
});
