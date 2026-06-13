const fs = require("fs");
const path = require("path");

const config = require("./config.js");
const helpers = require("./tools/helpers.js");

const sh = helpers.sh;

// ── Stats formatter ───────────────────────────────────────────────────────────
async function getStats() {
  const [freeRaw, diskRaw, loadRaw, uptimeRaw, tempRaw] = await Promise.all([
    sh("LANG=C free -m"),
    sh("LANG=C df -h / | tail -1"),
    sh("cat /proc/loadavg"),
    sh("uptime -p 2>/dev/null || uptime"),
    sh("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{printf \"%.0f\", $1/1000}' || echo ''"),
  ]);

  let memLine = "—";
  const memMatch = freeRaw.match(/^Mem:\s+(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+(\d+)/m);
  if (memMatch) {
    const total = Math.round(memMatch[1] / 1024 * 10) / 10;
    const used = Math.round(memMatch[2] / 1024 * 10) / 10;
    const avail = Math.round(memMatch[3] / 1024 * 10) / 10;
    const pct = Math.round(memMatch[2] / memMatch[1] * 100);
    memLine = `${used}G / ${total}G (${pct}%, ${avail}G свободно)`;
  }

  let diskLine = "—";
  const diskParts = diskRaw.trim().split(/\s+/);
  if (diskParts.length >= 5) {
    diskLine = `${diskParts[2]} / ${diskParts[1]} (${diskParts[4]} занято)`;
  }

  let loadLine = "—";
  const lp = loadRaw.trim().split(/\s+/);
  if (lp.length >= 3) loadLine = `${lp[0]} ${lp[1]} ${lp[2]} (1/5/15)`;

  const uptime = uptimeRaw.replace(/^up\s+/, "").trim();
  const temp = tempRaw ? `${tempRaw}°C` : "—";

  return `🧠 Память: ${memLine}\n💾 Диск: ${diskLine}\n⚡ Нагрузка: ${loadLine}\n🌡 Темп: ${temp}\n⏱ Аптайм: ${uptime}`;
}

// Raw context/*.md text — llm.js appends it to the claude CLI system prompt.
function getContextText() {
  try {
    return fs.readdirSync(config.CONTEXT_DIR).filter(f => f.endsWith(".md")).sort()
      .map(f => `### [${f}]\n${fs.readFileSync(path.join(config.CONTEXT_DIR, f), "utf8")}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

// ── Cron registry ─────────────────────────────────────────────────────────────
function readRegistry() {
  try { return JSON.parse(fs.readFileSync(config.CRONS_FILE, "utf8")); }
  catch { return {}; }
}

function writeRegistry(reg) {
  fs.writeFileSync(config.CRONS_FILE, JSON.stringify(reg, null, 2));
  const lines = Object.entries(reg)
    .map(([n, c]) => `- **${n}**: \`${c.schedule}\` — \`${c.command}\`\n  ${c.description || ""} _(${c.created?.slice(0, 10)})_`)
    .join("\n");
  fs.writeFileSync(
    path.join(config.CONTEXT_DIR, "crons.md"),
    `# Cron-задачи\n\n_Обновлено: ${new Date().toISOString()}_\n\n${lines || "_(нет)_"}\n`
  );
}

module.exports = {
  getContextText,
  getStats,
  readRegistry,
  writeRegistry,
};
