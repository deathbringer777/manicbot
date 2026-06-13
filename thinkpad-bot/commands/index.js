const fs = require("fs");
const path = require("path");

// Record shape: { handler, description, group, menu }
// group  — section header shown in /help (e.g. "📊 Система")
// menu   — true  →  included in the Telegram "/" menu (curated shortlist)
const REGISTRY = new Map();

function register(name, handler, description, group = "", menu = false) {
  REGISTRY.set(name, { handler, description, group, menu });
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

// For Telegram setMyCommands — curated subset where menu===true, ordered by insertion.
function getMenuCommands() {
  return Array.from(REGISTRY.entries())
    .filter(([, cmd]) => cmd.menu)
    .map(([name, cmd]) => ({ command: name.replace(/^\//, ""), description: cmd.description }));
}

// For /help — commands grouped by `group`, sorted by group+name.
function getHelp() {
  const groups = new Map();
  for (const [name, cmd] of REGISTRY.entries()) {
    const g = cmd.group || "Прочее";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ name, description: cmd.description });
  }
  return groups;
}

function loadBuiltin() {
  const dir = __dirname;
  fs.readdirSync(dir)
    .filter(f => f.endsWith(".js") && f !== "index.js")
    .sort()
    .forEach(f => {
      try {
        const mod = require(path.join(dir, f));
        if (mod.register) mod.register(register);
        if (mod.commands) {
          for (const [name, cfg] of Object.entries(mod.commands)) {
            register(name, cfg.handler, cfg.description, cfg.group || "", cfg.menu || false);
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
  getMenuCommands,
  getHelp,
  loadBuiltin,
  REGISTRY,
};
