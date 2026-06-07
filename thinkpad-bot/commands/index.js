const fs = require("fs");
const path = require("path");

const REGISTRY = new Map();

function register(name, handler, description) {
  REGISTRY.set(name, { handler, description });
}

function get(name) {
  return REGISTRY.get(name);
}

function has(name) {
  return REGISTRY.has(name);
}

function getAll() {
  return Array.from(REGISTRY.entries()).map(([name, cmd]) => ({ name, ...cmd }));
}

function getDescriptions() {
  return Array.from(REGISTRY.entries())
    .map(([name, cmd]) => ({ command: name.replace("/", ""), description: cmd.description }))
    .filter(c => c.command !== "start" && c.command !== "help");
}

function loadBuiltin() {
  const dir = __dirname;
  fs.readdirSync(dir).filter(f => f.endsWith(".js") && f !== "index.js").sort().forEach(f => {
    try {
      const mod = require(path.join(dir, f));
      if (mod.register) mod.register(register);
      if (mod.commands) {
        for (const [name, cfg] of Object.entries(mod.commands)) {
          register(name, cfg.handler, cfg.description);
        }
      }
    } catch (e) {
      console.error(`[commands] failed to load ${f}:`, e.message);
    }
  });
}

module.exports = {
  register,
  get,
  has,
  getAll,
  getDescriptions,
  loadBuiltin,
  REGISTRY,
};
