const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

describe("commands.js", () => {
  let commands;

  before(() => {
    const helpers = require("../tools/helpers.js");
    const mouse = require("../tools/mouse.js");
    const windowManager = require("../tools/window.js");
    const screenshot = require("../tools/screenshot.js");
    const clipboard = require("../tools/clipboard.js");

    mock.method(helpers, "sh", async (cmd) => {
      if (cmd.includes("pm2 jlist")) {
        return JSON.stringify([
          { name: "tg-bot", pid: 1234, pm2_env: { status: "online", restart_time: 0 }, monit: { memory: 50000000, cpu: 2 } },
          { name: "health-check", pid: 5678, pm2_env: { status: "online", restart_time: 1 }, monit: { memory: 30000000, cpu: 1 } },
        ]);
      }
      if (cmd.includes("LANG=C free -m")) {
        return "Mem: 8192 2048 4096 0 2048 6144";
      }
      if (cmd.includes("LANG=C df -h /")) {
        return "/dev/sda1 100G 30G 70G 30% /";
      }
      if (cmd.includes("/proc/loadavg")) {
        return "0.5 0.3 0.2 1/500 1234";
      }
      if (cmd.includes("uptime -p")) {
        return "up 2 hours";
      }
      if (cmd.includes("thermal_zone0")) {
        return "55000";
      }
      if (cmd.includes("crontab -l")) {
        return "0 */6 * * * /home/user/script.sh";
      }
      if (cmd.includes("LANG=C df -h")) {
        return "/dev/sda1 100G 30G 70G 30% /";
      }
      return "(нет вывода)";
    });

    mock.method(mouse, "getMousePosition", async () => ({ ok: true, x: 800, y: 600 }));
    mock.method(mouse, "mouseMoveAbsolute", async () => ({ ok: true }));
    mock.method(mouse, "mouseClick", async () => ({ ok: true }));

    mock.method(windowManager, "listWindows", async () => ({
      ok: true,
      windows: [
        { id: "0x1234", desktop: "0", pid: "0", title: "Firefox" },
        { id: "0x5678", desktop: "0", pid: "0", title: "Terminal" },
      ],
    }));

    mock.method(screenshot, "captureFullScreen", async () => ({ ok: true, path: "/tmp/test.png", size: 50000 }));

    mock.method(clipboard, "read", async () => ({ ok: true, text: "test clipboard" }));

    process.env.TELEGRAM_TOKEN = "test:token";
    process.env.GROQ_KEY = "test:key";
    process.env.ALLOWED_USER_ID = "12345";
    process.env.CHAT_ID = "12345";
    process.env.GROQ_MODEL = "test-model";
    delete require.cache[path.resolve(__dirname, "../config.js")];
    delete require.cache[path.resolve(__dirname, "../commands.js")];
    commands = require("../commands.js");
  });

  after(() => mock.reset());

  it("/status должен вернуть статус системы", async () => {
    const result = await commands.COMMANDS["/status"]();
    assert.ok(result.includes("Память"));
    assert.ok(result.includes("PM2"));
    assert.ok(result.includes("tg-bot"));
  });

  it("/ps должен вернуть список PM2 процессов", async () => {
    const result = await commands.COMMANDS["/ps"]();
    assert.ok(result.includes("tg-bot"));
    assert.ok(result.includes("health-check"));
  });

  it("/help должен вернуть список команд", async () => {
    const result = await commands.COMMANDS["/help"]();
    assert.ok(result.includes("/status"));
    assert.ok(result.includes("/screenshot"));
  });

  it("/start должен вернуть приветствие", async () => {
    const result = await commands.COMMANDS["/start"]();
    assert.ok(result.includes("ThinkPad"));
  });

  it("/screenshot должен сделать скриншот и вернуть путь", async () => {
    const result = await commands.COMMANDS["/screenshot"]();
    assert.ok(result);
  });

  it("/mouse должен вернуть позицию курсора", async () => {
    const result = await commands.COMMANDS["/mouse"]();
    assert.ok(result.includes("800"));
    assert.ok(result.includes("600"));
  });

  it("/windows должен вернуть список окон", async () => {
    const result = await commands.COMMANDS["/windows"]();
    assert.ok(result.includes("Firefox") || result.includes("окон"));
  });

  it("/clipboard должен прочитать буфер обмена", async () => {
    const result = await commands.COMMANDS["/clipboard"]();
    assert.ok(result);
  });

  it("/reset должен очистить историю", () => {
    const result = commands.COMMANDS["/reset"]("test");
    assert.ok(result.includes("очищен"));
  });

  it("/disk должен показать диски", async () => {
    const result = await commands.COMMANDS["/disk"]();
    assert.ok(result);
  });

  it("/groq должен показать статистику Groq API", async () => {
    const result = await commands.COMMANDS["/groq"]();
    assert.ok(result);
  });

  it("/crons должен показать cron задачи", async () => {
    const result = await commands.COMMANDS["/crons"]();
    assert.ok(result);
  });

  it("/health должен показать health check", async () => {
    const result = await commands.COMMANDS["/health"]();
    assert.ok(result);
  });
});
