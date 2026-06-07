const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const { clearToolCache, setTestEnv } = require("../helpers/mock.js");

function getMockedHelpers(results) {
  clearToolCache();
  delete require.cache[require.resolve("../../tools/helpers.js")];
  const helpers = require("../../tools/helpers.js");
  const shCalls = [];
  mock.method(helpers, "sh", (cmd) => {
    shCalls.push(cmd);
    for (const [pattern, result] of results) {
      if (cmd.includes(pattern)) return result;
    }
    return "(нет вывода)";
  });
  return { shCalls, helpers };
}

describe("tools/clipboard.js", () => {
  let clipboard;
  let shCalls;

  before(() => {
    setTestEnv();
    const m = getMockedHelpers([
      ["wl-paste", "clipboard content"],
      ["wl-copy", "(нет вывода)"],
    ]);
    shCalls = m.shCalls;
    clipboard = require("../../tools/clipboard.js");
  });

  after(() => mock.reset());

  it("read должен прочитать буфер через wl-paste", async () => {
    shCalls.length = 0;
    const result = await clipboard.read();
    assert.ok(result.ok);
    assert.strictEqual(result.text, "clipboard content");
    assert.ok(shCalls.some(c => c.includes("wl-paste")));
  });

  it("write должен записать текст через wl-copy", async () => {
    shCalls.length = 0;
    const result = await clipboard.write("Hello from bot");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("wl-copy") && c.includes("Hello from bot")));
  });

  it("clear должен очистить буфер", async () => {
    shCalls.length = 0;
    const result = await clipboard.clear();
    assert.ok(result.ok);
  });

  it("append должен добавить текст к существующему", async () => {
    const m = getMockedHelpers([
      ["wl-paste", "prefix"],
      ["wl-copy", "(нет вывода)"],
    ]);
    shCalls = m.shCalls;
    clipboard = require("../../tools/clipboard.js");
    const result = await clipboard.append("suffix");
    assert.ok(result.ok);
    const writeCmd = shCalls.find(c => c.includes("wl-copy") && c.includes("prefixsuffix"));
    assert.ok(writeCmd, "command should contain concatenated text");
  });
});
