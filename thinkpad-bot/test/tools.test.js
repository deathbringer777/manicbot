const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { clearToolCache, setTestEnv } = require("./helpers/mock.js");

describe("tools.js (registry)", () => {
  let tools;

  before(() => {
    setTestEnv();
    clearToolCache();

    const cp = require("node:child_process");
    mock.method(cp, "exec", (cmd, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, { stdout: "mocked output", stderr: "" });
    });

    // Clear and reload
    delete require.cache[path.resolve(__dirname, "../tools/helpers.js")];
    delete require.cache[path.resolve(__dirname, "../tools.js")];
    tools = require("../tools.js");
  });

  after(() => mock.reset());

  it("должен экспортировать массив TOOLS_DEFINITIONS с функциями", () => {
    assert.ok(Array.isArray(tools.TOOLS_DEFINITIONS));
    assert.ok(tools.TOOLS_DEFINITIONS.length > 0);
  });

  it("каждый инструмент должен иметь name, description, parameters", () => {
    for (const t of tools.TOOLS_DEFINITIONS) {
      assert.ok(t.function.name, `tool missing name`);
      assert.ok(t.function.description, `${t.function.name} missing description`);
      assert.ok(t.function.parameters, `${t.function.name} missing parameters`);
    }
  });

  it("должен содержать все необходимые инструменты", () => {
    const names = tools.TOOLS_DEFINITIONS.map(t => t.function.name);
    const required = ["run_shell", "screenshot", "mouse_move", "keyboard_type", "clipboard", "window_manage", "system_stats", "browser_screenshot", "ssh_exec"];
    for (const name of required) {
      assert.ok(names.includes(name), `missing tool: ${name}`);
    }
  });

  it("runTool должен вернуть ошибку для неизвестного инструмента", async () => {
    const result = await tools.runTool("unknown_tool", {});
    assert.ok(result.includes("Неизвестный инструмент"));
  });

  it("getSystemPrompt должен возвращать промпт с контекстом", () => {
    const prompt = tools.getSystemPrompt();
    assert.ok(prompt.includes("личный AI-ассистент"));
    assert.ok(prompt.includes("run_shell"));
  });

  it("getStats должен вернуть статистику", async () => {
    const stats = await tools.getStats();
    assert.ok(stats);
  });
});
