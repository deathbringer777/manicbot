const fs = require("fs");

const config = require("./config.js");
const tools = require("./tools.js");
const mouse = require("./tools/mouse.js");
const keyboard = require("./tools/keyboard.js");
const screenshot = require("./tools/screenshot.js");
const windowManager = require("./tools/window.js");
const clipboard = require("./tools/clipboard.js");
const llm = require("./llm.js");

const { sh } = require("./tools/helpers.js");

// ── Statistics formatters ─────────────────────────────────────────────────────
function formatGroqStats() {
  const { rl, session, lastUpdated, startedAt, model } = llm.getStats();
  if (!lastUpdated) return "Нет данных — отправь текстовый запрос.";

  const fmt = (iso) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Warsaw" });
  const bar = (used, total) => {
    if (!total) return "—";
    const pct = Math.min(100, Math.round(used / total * 100));
    return `${"█".repeat(Math.round(pct / 10))}${"░".repeat(10 - Math.round(pct / 10))} ${pct}%`;
  };
  const lines = [
    `🤖 Groq — ${model}`,
    `Обновлено: ${fmt(lastUpdated)}`,
    "",
  ];
  if (rl.tokLimit) {
    const used = parseInt(rl.tokLimit) - parseInt(rl.tokRemaining || 0);
    lines.push(`⚡ Токены / мин: ${bar(used, parseInt(rl.tokLimit))}`);
    lines.push(`   Осталось: ${parseInt(rl.tokRemaining).toLocaleString()}  Сброс: ${rl.tokReset || "—"}`);
    lines.push("");
  }
  if (rl.tokDayLimit) {
    const used = parseInt(rl.tokDayLimit) - parseInt(rl.tokDayRemaining || 0);
    lines.push(`📅 Токены / день: ${bar(used, parseInt(rl.tokDayLimit))}`);
    lines.push(`   Осталось: ${parseInt(rl.tokDayRemaining).toLocaleString()}  Сброс: ${rl.tokDayReset || "—"}`);
    lines.push("");
  }
  if (rl.reqLimit) {
    const used = parseInt(rl.reqLimit) - parseInt(rl.reqRemaining || 0);
    lines.push(`📨 Запросы / мин: ${bar(used, parseInt(rl.reqLimit))}`);
    lines.push(`   Осталось: ${rl.reqRemaining}  Сброс: ${rl.reqReset || "—"}`);
    lines.push("");
  }
  lines.push(`📊 Сессия с ${fmt(startedAt)}:`);
  lines.push(`   Вызовов: ${session.calls}`);
  lines.push(`   Prompt: ${session.promptTokens.toLocaleString()}`);
  lines.push(`   Output: ${session.completionTokens.toLocaleString()}`);
  lines.push(`   Всего:  ${session.totalTokens.toLocaleString()}`);
  if (session.calls > 0) lines.push(`   Avg:   ${Math.round(session.totalTokens / session.calls)}`);
  return lines.join("\n");
}

// ── COMMANDS registry ─────────────────────────────────────────────────────────
const COMMANDS = {
  "/start": async () =>
    "ThinkPad ops-бот v5 запущен.\nНапиши /help для списка команд или просто скажи что нужно сделать.",

  "/help": async () => {
    const cmdRegistry = require("./commands/index.js");
    const dynamic = cmdRegistry.getAll().filter(c => !["/exec", "/logs", "/start_proc", "/stop_proc", "/restart_proc", "/run"].includes(c.name));
    const lines = [
      `Команды:
/status — CPU, память, диск, PM2
/ps — процессы PM2 с памятью и CPU
/screenshot — скриншот всего экрана
/mouse — позиция курсора
/windows — список открытых окон
/clipboard — содержимое буфера обмена
/leads — прогресс сбора лидов
/health — последние запуски health-check
/disk — использование дисков
/groq — токены и лимиты Groq API
/logs <name> — логи PM2-процесса
/start_proc <name> — запустить процесс
/stop_proc <name> — остановить процесс
/restart_proc <name> — перезапустить процесс
/run <name> — запустить PM2-скрипт
/crons — список cron-задач
/exec <cmd> — выполнить shell-команду
/reset — очистить историю чата
/help — эта справка`,
    ];
    if (dynamic.length) {
      lines.push("", "📦 Дополнительные команды:");
      for (const c of dynamic) {
        lines.push(`  ${c.name} — ${c.description || "?"}`);
      }
    }
    lines.push("", "Или просто пиши что нужно — выполню.");
    return lines.join("\n");
  },

  "/status": async () => {
    const [stats, pm2Raw] = await Promise.all([tools.getStats(), sh("pm2 jlist")]);
    let pm2 = pm2Raw;
    try {
      pm2 = JSON.parse(pm2Raw)
        .map(p => `${p.pm2_env.status === "online" ? "✅" : "⏹"} ${p.name}`)
        .join("\n");
    } catch {}
    return `📊 Система\n${stats}\n\n🔄 PM2:\n${pm2}`;
  },

  "/ps": async () => {
    const raw = await sh("pm2 jlist");
    try {
      const procs = JSON.parse(raw);
      const lines = procs.map(p => {
        const online = p.pm2_env.status === "online";
        const mem = online && p.monit?.memory ? ` ${Math.round(p.monit.memory / 1024 / 1024)}MB` : "";
        const cpu = online && p.monit?.cpu != null ? ` CPU:${p.monit.cpu}%` : "";
        const restarts = p.pm2_env.restart_time > 0 ? ` ↺${p.pm2_env.restart_time}` : "";
        return `${online ? "✅" : "⏹"} ${p.name}${mem}${cpu}${restarts}`;
      });
      return `🔄 PM2 (${procs.filter(p => p.pm2_env.status === "online").length}/${procs.length} online):\n${lines.join("\n")}`;
    } catch { return raw; }
  },

  "/screenshot": async () => {
    const r = await screenshot.captureFullScreen();
    if (!r.ok) return `❌ ${r.error}`;
    return { type: "photo", path: r.path, caption: `📸 ${Math.round(r.size / 1024)}KB` };
  },

  "/mouse": async () => {
    const r = await mouse.getMousePosition();
    return r.ok ? `📍 Позиция курсора: (${r.x}, ${r.y})` : `❌ ${r.error}`;
  },

  "/windows": async () => {
    const r = await windowManager.listWindows();
    if (!r.ok) return `❌ ${r.error}`;
    if (!r.windows.length) return "Нет открытых окон";
    const lines = r.windows.map((w, i) => `${i + 1}. ${w.title} [${w.id}]`);
    return `🪟 Окна (${r.windows.length}):\n${lines.join("\n")}`;
  },

  "/clipboard": async () => {
    const r = await clipboard.read();
    return r.ok ? `📋 Буфер обмена:\n${r.text.slice(0, 1000)}` : `❌ ${r.error}`;
  },

  "/disk": async () => {
    const raw = await sh("LANG=C df -h 2>/dev/null");
    const lines = raw.split("\n").filter(l => /^\s*\/dev\/(sd|nvme|vd)/.test(l));
    if (!lines.length) return `💾 Диски:\n${raw}`;
    const header = "Раздел          Размер  Исп.  Своб.  % Точка";
    const rows = lines.map(l => {
      const p = l.trim().split(/\s+/);
      return `${p[0].padEnd(16)} ${p[1].padStart(6)} ${p[2].padStart(4)} ${p[3].padStart(5)} ${p[4].padStart(3)} ${p[5]}`;
    });
    return `💾 Диски:\n${header}\n${rows.join("\n")}`;
  },

  "/leads": async () => {
    const csvPath = `${process.env.HOME}/manicbot-backend/marketing/research/leads.csv`;
    const statePath = `${process.env.HOME}/manicbot-backend/marketing/research/lead-scout-state.json`;
    let csvLines = 0, state = {};
    try {
      const content = fs.readFileSync(csvPath, "utf8");
      csvLines = content.split("\n").filter(Boolean).length - 1;
    } catch {}
    try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
    const total = 5000;
    const collected = state.totalLeads || 0;
    const pct = Math.min(100, Math.round(collected / total * 100));
    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
    const lastRun = state.lastRunAt
      ? new Date(state.lastRunAt).toLocaleString("ru-RU", { timeZone: "Europe/Warsaw" })
      : "—";
    return [
      `📋 Лиды Warsaw (цель: ${total})`,
      `${bar} ${pct}% (${collected}/${total})`,
      ``,
      `Строк в CSV:    ${csvLines}`,
      `В state:        ${collected}`,
      `Районов пройд:  ${state.districtIndex ?? "?"}`,
      `Запусков:       ${state.runsCompleted ?? "?"}`,
      `Последний:      ${lastRun}`,
    ].join("\n");
  },

  "/health": async () => {
    let log = "";
    try {
      const content = fs.readFileSync(`${process.env.HOME}/automation/logs/health.log`, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      log = lines.slice(-9).join("\n");
    } catch { log = "лог не найден"; }
    log = log.replace(/\[(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}\.\d+Z\]/g, "[$3.$2 $4:$5]");
    return `🏥 Health (последние 3 запуска):\n${log}`;
  },

  "/crons": async () => {
    const [tab, reg] = await Promise.all([
      sh("crontab -l 2>/dev/null || echo '(пусто)'"),
      Promise.resolve(tools.readRegistry()),
    ]);
    const regList = Object.entries(reg).map(([n, c]) => `  ${n}: ${c.schedule} → ${c.command}`).join("\n") || "  (пусто)";
    return `🕐 Crontab:\n${tab}\n\n📋 Реестр бота:\n${regList}`;
  },

  "/groq": formatGroqStats,

  "/reset": (chatId) => {
    llm.resetHistory(chatId);
    return "История очищена.";
  },
};

module.exports = { COMMANDS };
