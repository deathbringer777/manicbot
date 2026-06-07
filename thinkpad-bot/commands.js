const fs = require("fs");

const config = require("./config.js");
const render = require("./render.js");
const { humanizeCron } = require("./cron-humanize.js");
const tools = require("./tools.js");
const mouse = require("./tools/mouse.js");
const screenshot = require("./tools/screenshot.js");
const windowManager = require("./tools/window.js");
const clipboard = require("./tools/clipboard.js");
const llm = require("./llm.js");
const { sh } = require("./tools/helpers.js");

const { esc, b, code, kv, bar, block } = render;

// ── PM2 helpers ───────────────────────────────────────────────────────────────
async function getPm2List() {
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

// ── /status ───────────────────────────────────────────────────────────────────
async function renderStatus() {
  const [statsText, list] = await Promise.all([tools.getStats(), getPm2List()]);
  const lines = [`📊 <b>Система</b>`, esc(statsText)];
  if (list) {
    const online = list.filter((p) => p.pm2_env.status === "online").length;
    lines.push("", `🔄 <b>PM2</b> (${online}/${list.length} online)`);
    lines.push(block(list.map(pm2Line).join("\n"), { maxLines: 14 }));
  }
  return { text: lines.join("\n") };
}

// ── /ps ───────────────────────────────────────────────────────────────────────
async function renderPs() {
  const list = await getPm2List();
  if (!list) return { text: "🔄 <b>PM2</b>\n<i>не удалось прочитать список</i>" };
  const online = list.filter((p) => p.pm2_env.status === "online").length;
  return {
    text: `🔄 <b>PM2</b> (${online}/${list.length} online)\n${block(list.map(pm2Line).join("\n"), { maxLines: 20 })}`,
  };
}

// ── /disk ─────────────────────────────────────────────────────────────────────
async function renderDisk() {
  const raw = await sh("LANG=C df -h 2>/dev/null");
  const rows = raw.split("\n").filter((l) => /^\s*\/dev\/(sd|nvme|vd|mmcblk)/.test(l));
  if (!rows.length) return { text: block(raw, { title: "💾 Диски" }) };
  const table = rows.map((l) => {
    const p = l.trim().split(/\s+/);
    return `${p[5]}\n  ${p[2]} / ${p[1]}  занято ${p[4]}  свободно ${p[3]}`;
  });
  return { text: `💾 <b>Диски</b>\n${block(table.join("\n"), { maxLines: 24 })}` };
}

// ── /cron (merges old /crons + /crontab) ──────────────────────────────────────
async function renderCron() {
  const [tab, reg] = await Promise.all([
    sh("crontab -l 2>/dev/null || echo ''"),
    Promise.resolve(tools.readRegistry()),
  ]);

  const lines = [`🕐 <b>Запланированные задачи</b>`, "", `<b>Системный crontab</b>`];
  const cronLines = tab
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^[A-Z_]+=/.test(l));
  if (!cronLines.length) {
    lines.push("<i>пусто</i>");
  } else {
    for (const l of cronLines) {
      const parts = l.split(/\s+/);
      const expr = parts.slice(0, 5).join(" ");
      const cmd = parts.slice(5).join(" ").replace(/\s*#\s*bot:.*$/, "");
      lines.push(`• ${esc(humanizeCron(expr))}\n  ${code(cmd)}`);
    }
  }

  const entries = Object.entries(reg);
  lines.push("", `<b>Задачи бота</b>`);
  if (!entries.length) {
    lines.push("<i>пусто</i>");
  } else {
    for (const [name, c] of entries) {
      lines.push(`• <b>${esc(name)}</b> — ${esc(humanizeCron(c.schedule))}\n  ${code(c.command)}`);
    }
  }
  return { text: lines.join("\n") };
}

// ── /leads ────────────────────────────────────────────────────────────────────
async function renderLeads() {
  const csvPath = `${process.env.HOME}/manicbot-backend/marketing/research/leads.csv`;
  const statePath = `${process.env.HOME}/manicbot-backend/marketing/research/lead-scout-state.json`;
  let csvLines = 0;
  let state = {};
  try {
    csvLines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean).length - 1;
  } catch { /* ignore */ }
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

// ── /health ───────────────────────────────────────────────────────────────────
async function renderHealth() {
  let log = "лог не найден";
  try {
    const content = fs.readFileSync(`${process.env.HOME}/automation/logs/health.log`, "utf8");
    log = content.trim().split("\n").filter(Boolean).slice(-9).join("\n");
    log = log.replace(/\[(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}\.\d+Z\]/g, "[$3.$2 $4:$5]");
  } catch { /* ignore */ }
  return { text: block(log, { title: "🏥 Health (последние запуски)", maxLines: 12 }) };
}

// ── /groq ─────────────────────────────────────────────────────────────────────
function renderGroq() {
  const { rl, session, lastUpdated, startedAt, model } = llm.getStats();
  if (!lastUpdated) {
    return { text: `🤖 <b>Groq</b> — ${code(model)}\n<i>нет данных — отправь текстовый запрос</i>` };
  }
  const fmt = (iso) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Warsaw" });
  const lines = [`🤖 <b>Groq</b> — ${code(model)}`, `<i>обновлено ${esc(fmt(lastUpdated))}</i>`, ""];

  if (rl.tokDayLimit) {
    const limit = parseInt(rl.tokDayLimit);
    const remaining = parseInt(rl.tokDayRemaining || 0);
    lines.push(`📅 Токены/день  ${bar(((limit - remaining) / limit) * 100)}`);
    lines.push(kv("осталось", `${remaining.toLocaleString()} · сброс ${rl.tokDayReset || "—"}`));
    lines.push("");
  }
  if (rl.tokLimit) {
    const limit = parseInt(rl.tokLimit);
    const remaining = parseInt(rl.tokRemaining || 0);
    lines.push(`⚡ Токены/мин  ${bar(((limit - remaining) / limit) * 100)}`);
    lines.push("");
  }
  lines.push(`📊 <b>Сессия</b> · ${esc(fmt(startedAt))}`);
  lines.push(kv("вызовов", session.calls));
  lines.push(kv("токенов", session.totalTokens.toLocaleString()));
  if (session.calls) lines.push(kv("в среднем", Math.round(session.totalTokens / session.calls)));
  return { text: lines.join("\n") };
}

// ── /screenshot ───────────────────────────────────────────────────────────────
async function renderScreenshot() {
  const r = await screenshot.captureFullScreen();
  if (!r.ok) return { text: esc(r.error) };
  return { photo: r.path, caption: `📸 ${Math.round(r.size / 1024)} KB` };
}

// ── /mouse, /windows, /clipboard — degrade clearly on GNOME Wayland ────────────
async function renderMouse() {
  const r = await mouse.getMousePosition();
  if (r.ok) return { text: `📍 Курсор: <code>${r.x}, ${r.y}</code>` };
  return { text: "📍 Позиция курсора недоступна на GNOME Wayland.\n<i>Двигать/кликать мышью можно — читать координаты нельзя.</i>" };
}

async function renderWindows() {
  const r = await windowManager.listWindows();
  if (r.ok && r.windows.length) {
    const list = r.windows.map((w, idx) => `${idx + 1}. ${w.title}`).join("\n");
    return { text: `🪟 <b>Окна</b> (${r.windows.length})\n${block(list, { maxLines: 20 })}` };
  }
  return { text: "🪟 Список окон недоступен на GNOME Wayland.\n<i>Используй «открой &lt;приложение&gt;» — приложения запускаются.</i>" };
}

async function renderClipboard() {
  const r = await clipboard.read();
  if (r.ok) return { text: `📋 <b>Буфер обмена</b>\n${block(r.text.slice(0, 1500))}` };
  return { text: `📋 ${esc(r.error)}.\n<i>Буфер через wl-clipboard не работает на Mutter.</i>` };
}

// ── /help, /start ─────────────────────────────────────────────────────────────
function renderHelp() {
  const text = [
    `🤖 <b>ThinkPad ops-бот</b>`,
    `<i>Пиши команду или просто скажи словами что нужно — выполню.</i>`,
    "",
    `<b>📊 Система</b>`,
    `/status — CPU, память, диск, PM2`,
    `/ps — процессы PM2 · /disk — диски · /groq — лимиты Groq`,
    `/health — health-check · /leads — прогресс лидов`,
    "",
    `<b>🖥 Экран и ввод</b>`,
    `/screenshot — снимок экрана`,
    `/clipboard — буфер · /windows — окна · /mouse — курсор`,
    "",
    `<b>⚙️ Процессы и задачи</b>`,
    `/logs &lt;имя&gt; — логи · /restart_proc &lt;имя&gt; — перезапуск`,
    `/start_proc · /stop_proc · /run &lt;имя&gt; · /cron — расписания`,
    "",
    `<b>🔧 Утилиты</b>`,
    `/exec &lt;cmd&gt; — shell · /ssh &lt;host&gt; &lt;cmd&gt;`,
    `/ping · /ip · /uptime · /battery · /wifi · /calc · /weather &lt;город&gt;`,
    `/find &lt;шаблон&gt; · /upload &lt;путь&gt; · /backup &lt;путь&gt; · /todo`,
    "",
    `<b>🧠 ИИ</b>`,
    `/translate · /summarize · /note — или просто пиши текстом`,
    "",
    `/reset — очистить историю чата`,
  ].join("\n");
  return { text };
}

function renderStart() {
  return {
    text: [
      `👋 <b>ThinkPad ops-бот на связи.</b>`,
      "",
      `Я управляю компьютером: скриншоты, музыка, процессы, файлы, shell.`,
      `Скажи словами — <i>«сделай скриншот»</i>, <i>«включи lofi»</i>, <i>«что с диском»</i> — или жми /help.`,
    ].join("\n"),
  };
}

// ── COMMANDS registry ─────────────────────────────────────────────────────────
const COMMANDS = {
  "/start": renderStart,
  "/help": renderHelp,
  "/status": renderStatus,
  "/ps": renderPs,
  "/disk": renderDisk,
  "/cron": renderCron,
  "/crons": renderCron,
  "/leads": renderLeads,
  "/health": renderHealth,
  "/groq": renderGroq,
  "/screenshot": renderScreenshot,
  "/mouse": renderMouse,
  "/windows": renderWindows,
  "/clipboard": renderClipboard,
  "/reset": (chatId) => {
    llm.resetHistory(chatId);
    return { text: "🧹 История чата очищена." };
  },
};

module.exports = { COMMANDS, renderCron };
