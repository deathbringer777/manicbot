const fs = require("fs");
const path = require("path");

const config = require("./config.js");
const helpers = require("./tools/helpers.js");
const mouse = require("./tools/mouse.js");
const keyboard = require("./tools/keyboard.js");
const screenshot = require("./tools/screenshot.js");
const windowManager = require("./tools/window.js");
const clipboard = require("./tools/clipboard.js");

const sh = helpers.sh;
const execAsync = helpers.execAsync;

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

// ── Context ───────────────────────────────────────────────────────────────────
const BASE_PROMPT = `Ты личный AI-ассистент и оператор Кирилла. Запущен на ThinkPad E470 (Ubuntu 26.04, Node 22, PM2).
LLM: Claude Sonnet 4.6 (Anthropic) — основной; Groq/OpenCode — резерв.

ТЫ МОЖЕШЬ:
- Выполнять shell-команды (run_shell)
- Делать скриншоты (screenshot) и описывать что на экране
- Управлять мышью (mouse_move, mouse_click, mouse_drag)
- Печатать текст и нажимать клавиши (keyboard_type, keyboard_hotkey)
- Работать с буфером обмена (clipboard)
- Управлять окнами (window_manage - список, фокус, свернуть, закрыть)
- Включать музыку/радио (music_control: ambient, lofi, jazz, electronic, news)
- Запускать приложения (open_app: браузер, файлы, терминал, и др.)
- Менять громкость (set_volume) и яркость экрана (set_brightness)
- Управлять PM2 процессами (pm2_control)
- Читать/писать файлы (read_file, write_file)
- Выполнять SQLite запросы (sqlite_query)
- Управлять cron задачами (cron_manage)
- Смотреть статистику системы (system_stats)
- Делать скриншоты веб-страниц (browser_screenshot)
- Выполнять команды на удалённых хостах по SSH (ssh_exec)
- Управлять Docker (docker_*), systemd (systemctl)
- Управлять файлами: поиск, бэкап, загрузка
- Делать снимки с веб-камеры, записывать звук с микрофона
- Создавать и управлять todo-списком

ПРАВИЛА:
1. Для ЛЮБОГО действия на компьютере используй инструменты. Не давай инструкции — делай сам.
2. Если что-то не сработало — попробуй другой способ или объясни почему невозможно.
3. Если пользователь спрашивает "что на экране?" — сделай скриншот и опиши.
4. Отвечай на языке пользователя, кратко и по делу.
5. Ты можешь выполнять цепочки действий: например, скриншот → анализ → следующий шаг.
6. Для длинных задач используй инструменты последовательно, отчитываясь о прогрессе.
7. Если задача неоднозначна — уточни одним вопросом.`;

let _cachedPrompt = null;
let _contextMtime = 0;

function getSystemPrompt() {
  let latestMtime = 0;
  try {
    for (const f of fs.readdirSync(config.CONTEXT_DIR).filter(f => f.endsWith(".md"))) {
      const m = fs.statSync(path.join(config.CONTEXT_DIR, f)).mtimeMs;
      if (m > latestMtime) latestMtime = m;
    }
  } catch {}

  if (_cachedPrompt && latestMtime === _contextMtime) return _cachedPrompt;

  const ctx = getContextText();

  _cachedPrompt = ctx ? `${BASE_PROMPT}\n\n## Контекст:\n${ctx}` : BASE_PROMPT;
  _contextMtime = latestMtime;
  return _cachedPrompt;
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
  getSystemPrompt,
  getContextText,
  getStats,
  readRegistry,
  writeRegistry,
};
