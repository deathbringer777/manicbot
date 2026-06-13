const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { setTestEnv } = require("./helpers/mock.js");

// Verifies that the Telegram "/" menu and /help output are generated from the
// same registry — no separate hardcoded lists can drift out of sync.
describe("help / menu (registry)", () => {
  let registry;

  before(() => {
    setTestEnv();

    // Evict commands/* so loadBuiltin() runs fresh in this suite.
    const cmdDir = path.resolve(__dirname, "../commands");
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(cmdDir)) delete require.cache[key];
    }

    registry = require("../commands/index.js");
    registry.loadBuiltin();
  });

  it("getMenuCommands возвращает > 5 команд для Telegram /", () => {
    const menu = registry.getMenuCommands();
    assert.ok(Array.isArray(menu));
    assert.ok(menu.length > 5, `ожидалось > 5 команд, получили ${menu.length}`);
  });

  it("getMenuCommands: все команды имеют command и description", () => {
    for (const cmd of registry.getMenuCommands()) {
      assert.ok(cmd.command && typeof cmd.command === "string", "missing command");
      assert.ok(cmd.description && typeof cmd.description === "string", "missing description");
      assert.ok(!cmd.command.startsWith("/"), "command must not include leading slash");
    }
  });

  it("getMenuCommands включает status, ps, screenshot", () => {
    const names = registry.getMenuCommands().map((c) => c.command);
    assert.ok(names.includes("status"), "status должен быть в меню");
    assert.ok(names.includes("ps"), "ps должен быть в меню");
    assert.ok(names.includes("screenshot"), "screenshot должен быть в меню");
  });

  it("getMenuCommands не включает groq (устаревший алиас)", () => {
    const names = registry.getMenuCommands().map((c) => c.command);
    assert.ok(!names.includes("groq"), "groq не должен быть в Telegram-меню");
  });

  it("getHelp возвращает Map с группами команд", () => {
    const groups = registry.getHelp();
    assert.ok(groups instanceof Map);
    assert.ok(groups.size > 0, "должна быть хотя бы одна группа");
    for (const [groupName, cmds] of groups) {
      assert.ok(typeof groupName === "string");
      assert.ok(Array.isArray(cmds) && cmds.length > 0);
    }
  });

  it("getHelp покрывает /status, /screenshot, /cron", () => {
    const allNames = [];
    for (const cmds of registry.getHelp().values()) {
      allNames.push(...cmds.map((c) => c.name));
    }
    assert.ok(allNames.includes("/status"), "/status должен быть в help");
    assert.ok(allNames.includes("/screenshot"), "/screenshot должен быть в help");
    assert.ok(allNames.includes("/cron"), "/cron должен быть в help");
  });
});
