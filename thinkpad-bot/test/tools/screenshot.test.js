const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { clearToolCache, setTestEnv } = require("../helpers/mock.js");

describe("tools/screenshot.js", () => {
  let screenshot;
  let shCalls;
  const { mock } = require("node:test");

  function mockSh(handler) {
    delete require.cache[require.resolve("../../tools/helpers.js")];
    const helpers = require("../../tools/helpers.js");
    mock.method(helpers, "sh", (cmd) => {
      shCalls.push(cmd);
      return handler(cmd);
    });
  }

  before(() => {
    setTestEnv();
    shCalls = [];
    clearToolCache();
    mockSh((cmd) => {
      if (cmd.includes("grim")) {
        const match = cmd.match(/"([^"]+\.png)"/);
        const outPath = match ? match[1] : "/tmp/screenshot_test.png";
        try { fs.writeFileSync(outPath, "fake-png-data"); } catch {}
      }
      if (cmd.includes("xdotool getdisplaygeometry")) return "1920 1080";
      return "(нет вывода)";
    });
    screenshot = require("../../tools/screenshot.js");
  });

  after(() => {
    mock.reset();
    try { fs.unlinkSync("/tmp/screenshot_test.png"); } catch {}
  });

  it("captureFullScreen должен сделать скриншот через grim", async () => {
    const result = await screenshot.captureFullScreen("/tmp/screenshot_test.png");
    assert.ok(result.ok);
    assert.strictEqual(result.path, "/tmp/screenshot_test.png");
    assert.ok(shCalls.some(c => c.includes("grim")));
  });

  it("captureArea с координатами", async () => {
    const result = await screenshot.captureArea(100, 200, 800, 600, "/tmp/screenshot_test.png");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes('grim -g "100,200 800x600"')));
  });

  it("getScreenSize должен вернуть размер через xdotool", async () => {
    const result = await screenshot.getScreenSize();
    assert.ok(result.ok);
    assert.strictEqual(result.width, 1920);
    assert.strictEqual(result.height, 1080);
  });
});
