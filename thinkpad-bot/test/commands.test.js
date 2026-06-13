const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { setTestEnv, clearToolCache } = require("./helpers/mock.js");

// Commands are now registered in commands/index.js. Tests use the registry
// directly instead of the old commands.js monolith.
describe("commands (registry)", () => {
  let registry;

  before(() => {
    setTestEnv();
    clearToolCache();

    // Load and mock tool modules BEFORE command modules so top-level requires
    // in commands/* (e.g. screen.js) pick up the mocked objects.
    const helpers = require("../tools/helpers.js");
    const mouse = require("../tools/mouse.js");
    const windowManager = require("../tools/window.js");
    const screenshot = require("../tools/screenshot.js");
    const clipboard = require("../tools/clipboard.js");

    mock.method(helpers, "sh", async (cmd) => {
      if (cmd.includes("pm2 jlist")) {
        return JSON.stringify([
          { name: "tg-bot", pid: 1, pm2_env: { status: "online", restart_time: 0 }, monit: { memory: 50000000, cpu: 2 } },
          { name: "health-check", pid: 2, pm2_env: { status: "stopped", restart_time: 1 }, monit: {} },
        ]);
      }
      if (cmd.includes("LANG=C free -m")) return "Mem: 8192 2048 4096 0 2048 6144";
      if (cmd.includes("LANG=C df -h /")) return "/dev/sda1 100G 30G 70G 30% /";
      if (cmd.includes("LANG=C df -h")) return "/dev/sda1 100G 30G 70G 30% /";
      if (cmd.includes("/proc/loadavg")) return "0.5 0.3 0.2 1/500 1234";
      if (cmd.includes("uptime -p")) return "up 2 hours";
      if (cmd.includes("thermal_zone0")) return "55000";
      if (cmd.includes("crontab -l")) return "0 */6 * * * /home/user/script.sh";
      return "(нет вывода)";
    });
    mock.method(mouse, "getMousePosition", async () => ({ ok: true, x: 800, y: 600 }));
    mock.method(windowManager, "listWindows", async () => ({
      ok: true,
      windows: [{ id: "1", title: "Firefox" }, { id: "2", title: "Terminal" }],
    }));
    mock.method(screenshot, "captureFullScreen", async () => ({ ok: true, path: "/tmp/test.png", size: 50000 }));
    mock.method(clipboard, "read", async () => ({ ok: true, text: "буфер" }));

    // Evict all commands/* from cache so they re-require the mocked tools above.
    const cmdDir = path.resolve(__dirname, "../commands");
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(cmdDir)) delete require.cache[key];
    }

    registry = require("../commands/index.js");
    registry.loadBuiltin();
  });

  after(() => mock.reset());

  it("/status → {text} с памятью, PM2 и именем процесса", async () => {
    const out = await registry.get("/status").handler(12345);
    assert.ok(out.text.includes("Память") || out.text.includes("Система"));
    assert.ok(out.text.includes("PM2"));
    assert.ok(out.text.includes("tg-bot"));
  });

  it("/ps → {text} со списком процессов", async () => {
    const out = await registry.get("/ps").handler(12345);
    assert.ok(out.text.includes("tg-bot"));
    assert.ok(out.text.includes("health-check"));
  });

  it("/cron → {text} с человекочитаемым расписанием", async () => {
    const out = await registry.get("/cron").handler(12345);
    assert.ok(out.text.includes("каждые 6 ч"), "expected humanized schedule");
  });

  it("/help → {text} со ссылками на команды", async () => {
    const out = await registry.get("/help").handler(12345);
    assert.ok(out.text.includes("/status"));
    assert.ok(out.text.includes("/screenshot"));
  });

  it("/start → {text} с приветствием", async () => {
    const out = await registry.get("/start").handler(12345);
    assert.ok(out.text.includes("ThinkPad"));
  });

  it("/screenshot → {photo}", async () => {
    const out = await registry.get("/screenshot").handler(12345);
    assert.strictEqual(out.photo, "/tmp/test.png");
  });

  it("/mouse → {text} с координатами", async () => {
    const out = await registry.get("/mouse").handler(12345);
    assert.ok(out.text.includes("800") && out.text.includes("600"));
  });

  it("/windows → {text} со списком окон", async () => {
    const out = await registry.get("/windows").handler(12345);
    assert.ok(out.text.includes("Firefox") || out.text.includes("Окна"));
  });

  it("/clipboard → {text}", async () => {
    const out = await registry.get("/clipboard").handler(12345);
    assert.ok(out.text.includes("буфер"));
  });

  it("/reset → {text} 'очищена'", () => {
    const out = registry.get("/reset").handler(12345);
    assert.ok(out.text.includes("очищена"));
  });

  it("/disk → {text}", async () => {
    const out = await registry.get("/disk").handler(12345);
    assert.ok(out.text.includes("Диски"));
  });

  it("/groq → {text}", async () => {
    const out = await registry.get("/groq").handler(12345);
    assert.ok(out.text.includes("Groq") || out.text.includes("Claude"));
  });

  it("/leads → {text} с прогресс-баром", async () => {
    const out = await registry.get("/leads").handler(12345);
    assert.ok(out.text.includes("Лиды"));
  });

  it("/health → {text}", async () => {
    const out = await registry.get("/health").handler(12345);
    assert.ok(out.text.includes("Health"));
  });
});
