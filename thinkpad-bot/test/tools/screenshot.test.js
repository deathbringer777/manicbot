const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { clearToolCache, setTestEnv } = require("../helpers/mock.js");

// Screenshots now go through the MbShot GNOME-extension D-Bus service (gdbus),
// not grim — see tools/screenshot.js for why (GNOME 50 Wayland).
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

  // Simulates a loaded, working extension: Capture/CaptureArea write the file
  // and return gdbus's "(true,)"; Ping answers alive.
  function workingBackend(cmd) {
    if (cmd.includes(".Capture") || cmd.includes(".CaptureArea")) {
      const m = cmd.match(/"([^"]+\.png)"/);
      if (m) { try { fs.writeFileSync(m[1], "fake-png-data"); } catch {} }
      return "(true,)";
    }
    if (cmd.includes(".Ping")) return "(mbshot-ok,)";
    return "(нет вывода)";
  }

  before(() => {
    setTestEnv();
    shCalls = [];
    clearToolCache();
    mockSh(workingBackend);
    screenshot = require("../../tools/screenshot.js");
  });

  after(() => {
    mock.reset();
    try { fs.unlinkSync("/tmp/screenshot_test.png"); } catch {}
  });

  it("captureFullScreen снимает экран через D-Bus расширения", async () => {
    const result = await screenshot.captureFullScreen("/tmp/screenshot_test.png");
    assert.ok(result.ok);
    assert.strictEqual(result.path, "/tmp/screenshot_test.png");
    assert.ok(shCalls.some(c => c.includes("org.local.MbShot.Capture")));
  });

  it("captureArea с координатами вызывает CaptureArea", async () => {
    const result = await screenshot.captureArea(100, 200, 800, 600, "/tmp/screenshot_test.png");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("org.local.MbShot.CaptureArea 100 200 800 600")));
  });

  it("getScreenSize возвращает безопасный дефолт", async () => {
    const result = await screenshot.getScreenSize();
    assert.ok(result.ok);
    assert.strictEqual(result.width, 1920);
    assert.strictEqual(result.height, 1080);
  });

  it("если бэкенд не активен — понятная подсказка, а не сырая ошибка", async () => {
    mock.reset();
    shCalls = [];
    mockSh(() => "Ошибка (exit 1): ServiceUnknown: org.local.MbShot was not provided");
    delete require.cache[require.resolve("../../tools/screenshot.js")];
    const screenshot2 = require("../../tools/screenshot.js");
    const result = await screenshot2.captureFullScreen("/tmp/should_not_exist_xyz.png");
    assert.ok(!result.ok);
    assert.match(result.error, /перезаход|расширение mbshot/i);
  });
});
