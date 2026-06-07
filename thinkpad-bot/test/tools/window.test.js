const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { clearToolCache, setTestEnv } = require("../helpers/mock.js");

describe("tools/window.js", () => {
  let wm;
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
      if (cmd.includes("wmctrl -l")) return "0x01234567  0  DESKTOP-1  Firefox\n0x089abcdef  0  DESKTOP-1  Terminal";
      if (cmd.includes("xdotool search --name 'Terminator'")) return "";
      if (cmd.includes("xdotool search --class 'Terminator'")) return "99999";
      if (cmd.includes("xdotool search --name")) return "12345";
      if (cmd.includes("xdotool search --class")) return "67890";
      if (cmd.includes("xdotool getactivewindow getwindowname")) return "Firefox";
      if (cmd.includes("xdotool getactivewindow")) return "12345";
      if (cmd.includes("xdotool windowactivate 99999")) return "(нет вывода)";
      if (cmd.includes("xdotool windowactivate")) return "(нет вывода)";
      if (cmd.includes("xdotool windowminimize")) return "(нет вывода)";
      if (cmd.includes("xdotool windowstate")) return "(нет вывода)";
      if (cmd.includes("xdotool windowclose")) return "(нет вывода)";
      if (cmd.includes("xdotool getwindowgeometry")) return "X=100\nY=200\nWIDTH=800\nHEIGHT=600";
      return "(нет вывода)";
    });
    wm = require("../../tools/window.js");
  });

  after(() => mock.reset());

  it("listWindows через wmctrl", async () => {
    const result = await wm.listWindows();
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.windows));
    assert.strictEqual(result.windows.length, 2);
    assert.strictEqual(result.windows[0].title, "Firefox");
    assert.strictEqual(result.windows[1].title, "Terminal");
  });

  it("focusWindow по id", async () => {
    const result = await wm.focusWindow("12345");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("xdotool windowactivate 12345")));
  });

  it("focusWindowByName", async () => {
    const result = await wm.focusWindowByName("Firefox");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("xdotool search --name 'Firefox'")));
  });

  it("focusWindowByName по class если name не найден", async () => {
    const result = await wm.focusWindowByName("Terminator");
    assert.ok(result.ok);
  });

  it("minimizeWindow", async () => {
    const result = await wm.minimizeWindow("12345");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("xdotool windowminimize 12345")));
  });

  it("maximizeWindow", async () => {
    const result = await wm.maximizeWindow("12345");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("xdotool windowstate --add FULLSCREEN 12345")));
  });

  it("closeWindow", async () => {
    const result = await wm.closeWindow("12345");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("xdotool windowclose 12345")));
  });

  it("getActiveWindow", async () => {
    const result = await wm.getActiveWindow();
    assert.ok(result.ok);
    assert.strictEqual(result.title, "Firefox");
    assert.strictEqual(result.id, "12345");
  });

  it("getWindowGeometry", async () => {
    const result = await wm.getWindowGeometry("12345");
    assert.ok(result.ok);
    assert.strictEqual(result.x, 100);
    assert.strictEqual(result.y, 200);
    assert.strictEqual(result.width, 800);
    assert.strictEqual(result.height, 600);
  });
});
