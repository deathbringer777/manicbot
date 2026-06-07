const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const { setTestEnv, clearToolCache } = require("./helpers/mock.js");

// Commands now return { text } (HTML) or { photo } objects, not raw strings.
describe("commands.js", () => {
  let commands;

  before(() => {
    // Env MUST be set before requiring modules that load config.js.
    setTestEnv();
    clearToolCache();

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
      if (cmd.includes("/proc/loadavg")) return "0.5 0.3 0.2 1/500 1234";
      if (cmd.includes("uptime -p")) return "up 2 hours";
      if (cmd.includes("thermal_zone0")) return "55000";
      if (cmd.includes("crontab -l")) return "0 */6 * * * /home/user/script.sh";
      if (cmd.includes("LANG=C df -h")) return "/dev/sda1 100G 30G 70G 30% /";
      return "(нет вывода)";
    });
    mock.method(mouse, "getMousePosition", async () => ({ ok: true, x: 800, y: 600 }));
    mock.method(windowManager, "listWindows", async () => ({
      ok: true,
      windows: [{ id: "1", title: "Firefox" }, { id: "2", title: "Terminal" }],
    }));
    mock.method(screenshot, "captureFullScreen", async () => ({ ok: true, path: "/tmp/test.png", size: 50000 }));
    mock.method(clipboard, "read", async () => ({ ok: true, text: "буфер" }));

    commands = require("../commands.js");
  });

  after(() => mock.reset());

  it("/status → {text} с памятью, PM2 и именем процесса", async () => {
    const out = await commands.COMMANDS["/status"]();
    assert.ok(out.text.includes("Память"));
    assert.ok(out.text.includes("PM2"));
    assert.ok(out.text.includes("tg-bot"));
  });

  it("/ps → {text} со списком процессов", async () => {
    const out = await commands.COMMANDS["/ps"]();
    assert.ok(out.text.includes("tg-bot"));
    assert.ok(out.text.includes("health-check"));
  });

  it("/cron → {text} с человекочитаемым расписанием", async () => {
    const out = await commands.COMMANDS["/cron"]();
    assert.ok(out.text.includes("каждые 6 ч"), "expected humanized schedule");
  });

  it("/help → {text} со ссылками на команды", async () => {
    const out = await commands.COMMANDS["/help"]();
    assert.ok(out.text.includes("/status"));
    assert.ok(out.text.includes("/screenshot"));
  });

  it("/start → {text} с приветствием", async () => {
    const out = await commands.COMMANDS["/start"]();
    assert.ok(out.text.includes("ThinkPad"));
  });

  it("/screenshot → {photo}", async () => {
    const out = await commands.COMMANDS["/screenshot"]();
    assert.strictEqual(out.photo, "/tmp/test.png");
  });

  it("/mouse → {text} с координатами", async () => {
    const out = await commands.COMMANDS["/mouse"]();
    assert.ok(out.text.includes("800") && out.text.includes("600"));
  });

  it("/windows → {text} со списком окон", async () => {
    const out = await commands.COMMANDS["/windows"]();
    assert.ok(out.text.includes("Firefox") || out.text.includes("Окна"));
  });

  it("/clipboard → {text}", async () => {
    const out = await commands.COMMANDS["/clipboard"]();
    assert.ok(out.text.includes("буфер"));
  });

  it("/reset → {text} 'очищена'", () => {
    const out = commands.COMMANDS["/reset"]("test");
    assert.ok(out.text.includes("очищена"));
  });

  it("/disk → {text}", async () => {
    const out = await commands.COMMANDS["/disk"]();
    assert.ok(out.text.includes("Диски"));
  });

  it("/groq → {text}", async () => {
    const out = await commands.COMMANDS["/groq"]();
    assert.ok(out.text.includes("Groq"));
  });

  it("/leads → {text} с прогресс-баром", async () => {
    const out = await commands.COMMANDS["/leads"]();
    assert.ok(out.text.includes("Лиды"));
  });

  it("/health → {text}", async () => {
    const out = await commands.COMMANDS["/health"]();
    assert.ok(out.text.includes("Health"));
  });
});
