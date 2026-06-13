// Dashboard commands — system stats, PM2 overview, disk, health, leads, Claude AI stats.
const fs = require("fs");
const render = require("../render.js");
const tools = require("../tools.js");
const llm = require("../llm.js");
const kb = require("../keyboards.js");

const { esc, code, kv, bar, block } = render;

// Shared PM2 helper used by /status and /ps.
async function getPm2List() {
  const { sh } = require("../tools/helpers.js");
  const raw = await sh("pm2 jlist");
  try { return JSON.parse(raw); } catch { return null; }
}

function pm2Line(p) {
  const online = p.pm2_env.status === "online";
  const icon = online ? "✅" : "⏹";
  const mem = online && p.monit?.memory ? `  ${Math.round(p.monit.memory / 1048576)}MB` : "";
  const cpu = online && p.monit?.cpu != null ? `  ${p.monit.cpu}%` : "";
  const restarts = p.pm2_env.restart_time > 0 ? `  ↺${p.pm2_env.restart_time}` : "";
  return `${icon} ${p.name}${mem}${cpu}${restarts}`;
}

async function renderStatus() {
  const [statsText, list] = await Promise.all([tools.getStats(), getPm2List()]);
  const lines = [`📊 <b>Система</b>`, esc(statsText)];
  if (list) {
    const online = list.filter((p) => p.pm2_env.status === "online").length;
    lines.push("", `🔄 <b>PM2</b> (${online}/${list.length} online)`);
    lines.push(block(list.map(pm2Line).join("\n"), { maxLines: 14 }));
  }
  return {
    text: lines.join("\n"),
    keyboard: kb.screenKb("status", [[["🔄 Процессы", "nav:ps"], ["💾 Диск", "nav:disk"]]]),
  };
}

async function renderPs() {
  const list = await getPm2List();
  if (!list) return { text: "🔄 <b>PM2</b>\n<i>не удалось прочитать список</i>" };
  const online = list.filter((p) => p.pm2_env.status === "online").length;
  return {
    text: `🔄 <b>PM2</b> (${online}/${list.length} online)\n${block(list.map(pm2Line).join("\n"), { maxLines: 20 })}`,
    keyboard: kb.procRows(list),
  };
}

async function renderDisk() {
  const { sh } = require("../tools/helpers.js");
  const raw = await sh("LANG=C df -h 2>/dev/null");
  const rows = raw.split("\n").filter((l) => /^\s*\/dev\/(sd|nvme|vd|mmcblk)/.test(l));
  if (!rows.length) return { text: block(raw, { title: "💾 Диски" }), keyboard: kb.screenKb("disk") };
  const table = rows.map((l) => {
    const p = l.trim().split(/\s+/);
    return `${p[5]}\n  ${p[2]} / ${p[1]}  занято ${p[4]}  свободно ${p[3]}`;
  });
  return { text: `💾 <b>Диски</b>\n${block(table.join("\n"), { maxLines: 24 })}`, keyboard: kb.screenKb("disk") };
}

async function renderHealth() {
  let log = "лог не найден";
  try {
    const content = fs.readFileSync(`${process.env.HOME}/automation/logs/health.log`, "utf8");
    log = content.trim().split("\n").filter(Boolean).slice(-9).join("\n");
    log = log.replace(/\[(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}\.\d+Z\]/g, "[$3.$2 $4:$5]");
  } catch { /* ignore */ }
  return { text: block(log, { title: "🏥 Health (последние запуски)", maxLines: 12 }) };
}

async function renderLeads() {
  const home = process.env.HOME;
  const csvPath = `${home}/manicbot-backend/marketing/research/leads.csv`;
  const statePath = `${home}/manicbot-backend/marketing/research/lead-scout-state.json`;
  let csvLines = 0;
  let state = {};
  try { csvLines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean).length - 1; } catch { /* ignore */ }
  try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { /* ignore */ }

  const total = 5000;
  const collected = state.totalLeads || 0;
  const lastRun = state.lastRunAt
    ? new Date(state.lastRunAt).toLocaleString("ru-RU", { timeZone: "Europe/Warsaw" })
    : "—";
  return {
    text: [
      `📋 <b>Лиды Warsaw</b> (цель ${total})`,
      bar((collected / total) * 100) + `  ${collected}/${total}`,
      "",
      kv("строк в CSV", csvLines),
      kv("в state", collected),
      kv("районов пройдено", state.districtIndex ?? "?"),
      kv("запусков", state.runsCompleted ?? "?"),
      kv("последний", lastRun),
    ].join("\n"),
  };
}

function renderAi() {
  const s = llm.getStats().claude;
  const fmt = (iso) => iso
    ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Warsaw" })
    : "—";
  const avgSec = s.session.calls
    ? Math.round(s.session.totalDurationMs / s.session.calls / 100) / 10
    : 0;
  const lines = [
    `🧠 <b>Claude</b> — ${code(s.model)} <i>(CLI, подписка Max)</i>`,
    `<i>обновлено ${esc(fmt(s.lastUpdated))}</i>`,
    "",
    `📊 <b>Сессия бота</b> · с ${esc(fmt(s.startedAt))}`,
    kv("вызовов", s.session.calls),
    kv("ошибок", s.session.errors),
    s.session.calls ? kv("ср. время", `${avgSec}s`) : null,
    kv("номинал. стоимость", `$${s.session.totalCostUsd.toFixed(2)} <i>(не списывается — подписка)</i>`),
    kv("чат-сессий", s.activeSessions),
    "",
    `Глубина рассуждений: /effort · голос: Groq Whisper`,
  ].filter((l) => l !== null);

  return { text: lines.join("\n"), keyboard: kb.screenKb("groq") };
}

module.exports = {
  commands: {
    "/status": {
      handler: renderStatus,
      description: "📊 Система: CPU, память, диск, PM2",
      group: "📊 Система",
      menu: true,
    },
    "/ps": {
      handler: renderPs,
      description: "🔄 Процессы PM2",
      group: "📊 Система",
      menu: true,
    },
    "/disk": {
      handler: renderDisk,
      description: "💾 Диски",
      group: "📊 Система",
      menu: true,
    },
    "/health": {
      handler: renderHealth,
      description: "🏥 Health-check — последние запуски",
      group: "📊 Система",
    },
    "/leads": {
      handler: renderLeads,
      description: "📋 Прогресс по лидам Warsaw",
      group: "📊 Система",
      menu: true,
    },
    "/ai": {
      handler: renderAi,
      description: "🤖 Claude — статистика подписки",
      group: "🧠 ИИ",
      menu: true,
    },
    "/groq": {
      handler: renderAi,
      description: "🤖 Claude — статистика (алиас /ai)",
      group: "🧠 ИИ",
    },
    "/reset": {
      handler: (chatId) => {
        llm.resetHistory(chatId);
        return { text: "🧹 История чата очищена." };
      },
      description: "🧹 Очистить историю чата с Claude",
      group: "🧠 ИИ",
      menu: true,
    },
  },
  // Exported for callbacks.js navigation (editMessage flow).
  renderStatus,
  renderPs,
  renderDisk,
  renderHealth,
  renderLeads,
  renderAi,
};
