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

  // The OpenAI-style TOOLS_DEFINITIONS/runTool loop is gone: the claude CLI
  // brings its own agentic tools. tools.js keeps only the prompt/context
  // helpers, system stats and the cron registry.
  it("не должен больше экспортировать LLM tool-loop (runTool/TOOLS_DEFINITIONS)", () => {
    assert.strictEqual(tools.TOOLS_DEFINITIONS, undefined);
    assert.strictEqual(tools.runTool, undefined);
  });

  it("getContextText отдаёт сырой контекст из context/*.md", () => {
    const ctx = tools.getContextText();
    assert.strictEqual(typeof ctx, "string");
  });

  it("getStats должен вернуть статистику", async () => {
    const stats = await tools.getStats();
    assert.ok(stats);
  });
});
