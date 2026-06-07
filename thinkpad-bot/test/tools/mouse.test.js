const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { clearToolCache, setTestEnv } = require("../helpers/mock.js");

describe("tools/mouse.js", () => {
  let mouse;
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
      if (cmd.includes("xdotool getmouselocation")) return "X=1234\nY=567\nSCREEN=0";
      return "(нет вывода)";
    });
    mouse = require("../../tools/mouse.js");
  });

  after(() => mock.reset());

  it("mouseMoveAbsolute должен двигать курсор по абсолютным координатам", async () => {
    const result = await mouse.mouseMoveAbsolute(500, 300);
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool mousemove -a 500 300")));
  });

  it("mouseMoveRelative должен двигать курсор относительно", async () => {
    const result = await mouse.mouseMoveRelative(50, -30);
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool mousemove 50 -30")));
  });

  it("mouseClickLeft должен кликнуть левой кнопкой", async () => {
    const result = await mouse.mouseClick("left");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool click 0xC0")));
  });

  it("mouseClickRight должен кликнуть правой кнопкой", async () => {
    const result = await mouse.mouseClick("right");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool click 0xC1")));
  });

  it("mouseClickMiddle должен кликнуть средней кнопкой", async () => {
    const result = await mouse.mouseClick("middle");
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool click 0xC2")));
  });

  it("mouseClick должен вернуть ошибку для неизвестной кнопки", async () => {
    const result = await mouse.mouseClick("unknown");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("unknown button"));
  });

  it("getMousePosition должен вернуть позицию курсора", async () => {
    const result = await mouse.getMousePosition();
    assert.ok(result.ok);
    assert.strictEqual(result.x, 1234);
    assert.strictEqual(result.y, 567);
  });

  it("mouseButtonDown/Up должны нажать/отпустить кнопку", async () => {
    shCalls = [];
    const r1 = await mouse.mouseButtonDown("left");
    assert.ok(r1.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool click")));
    const r2 = await mouse.mouseButtonUp("left");
    assert.ok(r2.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool click")));
  });

  it("scrollVertical должен скроллить", async () => {
    const result = await mouse.scrollVertical(5);
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool mousemove -w -y 5")));
  });

  it("scrollHorizontal должен скроллить горизонтально", async () => {
    const result = await mouse.scrollHorizontal(-3);
    assert.ok(result.ok);
    assert.ok(shCalls.some(c => c.includes("ydotool mousemove -w -x -3")));
  });
});
