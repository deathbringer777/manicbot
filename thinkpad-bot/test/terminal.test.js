// TDD: tests for /term command (run commands in terminal/tmux)

const { describe, it, before, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});

afterEach(() => {
  mock.restoreAll();
});

describe("/term command", () => {
  it("terminal.js can be required", () => {
    delete require.cache[path.resolve(__dirname, "../commands/terminal.js")];
    const termCmd = require("../commands/terminal.js");
    assert.ok(termCmd.commands["/term"], "/term command must be exported");
    assert.strictEqual(typeof termCmd.commands["/term"].handler, "function");
  });

  it("/term without arg returns usage hint", async () => {
    delete require.cache[path.resolve(__dirname, "../commands/terminal.js")];
    const termCmd = require("../commands/terminal.js");
    const result = await termCmd.commands["/term"].handler(12345, "");
    const text = typeof result === "object" ? result.text : result;
    assert.ok(text.length > 0, "Should return usage hint");
  });

  it("/term runs a command and returns output", async () => {
    // Mock child_process for safe testing without real shell execution
    const cp = require("child_process");
    const originalExec = cp.exec;
    
    // Override exec to simulate command execution
    cp.exec = (cmd, opts, callback) => {
      if (typeof opts === "function") { callback = opts; opts = {}; }
      // Simulate tmux setup commands succeeding silently
      if (cmd.includes("tmux")) {
        callback(null, "", "");
        return;
      }
      // Simulate the actual command
      callback(null, "hello world\nline2", "");
    };

    delete require.cache[path.resolve(__dirname, "../commands/terminal.js")];
    const termCmd = require("../commands/terminal.js");
    const result = await termCmd.commands["/term"].handler(12345, "echo hello");
    cp.exec = originalExec;

    const text = typeof result === "object" ? result.text : result;
    assert.ok(typeof text === "string", "Should return a string");
    assert.ok(text.length > 0, "Output should not be empty");
  });

  it("/term handles command errors gracefully", async () => {
    const cp = require("child_process");
    const originalExec = cp.exec;
    
    cp.exec = (cmd, opts, callback) => {
      if (typeof opts === "function") { callback = opts; opts = {}; }
      if (cmd.includes("tmux")) { callback(null, "", ""); return; }
      const err = new Error("command not found");
      err.code = 127;
      err.stderr = "bash: notexist: command not found";
      callback(err, "", err.stderr);
    };

    delete require.cache[path.resolve(__dirname, "../commands/terminal.js")];
    const termCmd = require("../commands/terminal.js");
    const result = await termCmd.commands["/term"].handler(12345, "notexist");
    cp.exec = originalExec;

    const text = typeof result === "object" ? result.text : result;
    assert.ok(typeof text === "string", "Should handle errors and return string");
  });

  it("/term-list command is exported", () => {
    delete require.cache[path.resolve(__dirname, "../commands/terminal.js")];
    const termCmd = require("../commands/terminal.js");
    assert.ok(termCmd.commands["/term-list"], "/term-list must be exported");
  });
});
