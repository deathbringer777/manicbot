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

  let ctx = "";
  try {
    ctx = fs.readdirSync(config.CONTEXT_DIR).filter(f => f.endsWith(".md")).sort()
      .map(f => `### [${f}]\n${fs.readFileSync(path.join(config.CONTEXT_DIR, f), "utf8")}`)
      .join("\n\n");
  } catch {}

  _cachedPrompt = ctx ? `${BASE_PROMPT}\n\n## Контекст:\n${ctx}` : BASE_PROMPT;
  _contextMtime = latestMtime;
  return _cachedPrompt;
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

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Выполняет команду в терминале ThinkPad. Используй для ЛЮБЫХ действий на компьютере, включая запуск приложений, скриптов, установку пакетов.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "shell-команда для выполнения" },
          timeout: { type: "number", description: "таймаут в мс (по умолчанию 20000)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Делает скриншот экрана. Без аргументов — весь экран. С area — область. Возвращает путь к файлу.",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string", description: "формат: 'x,y width height', например '0,0 800x600'. Пусто = весь экран" },
          output: { type: "string", description: "путь сохранения (опционально)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_move",
      description: "Двигает курсор мыши. Абсолютные координаты (x,y) или относительные (dx,dy).",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "абсолютная X координата (если absolute=true) или смещение X" },
          y: { type: "number", description: "абсолютная Y координата или смещение Y" },
          absolute: { type: "boolean", description: "true = абсолютные координаты, false = относительные" },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_click",
      description: "Кликает кнопкой мыши. button: left | right | middle | double",
      parameters: {
        type: "object",
        properties: {
          button: { type: "string", enum: ["left", "right", "middle", "double"], description: "кнопка для клика" },
        },
        default: "left",
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_drag",
      description: "Перетаскивает мышь из точки (x1,y1) в (x2,y2).",
      parameters: {
        type: "object",
        properties: {
          x1: { type: "number" }, y1: { type: "number" },
          x2: { type: "number" }, y2: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle"] },
        },
        required: ["x1", "y1", "x2", "y2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_position",
      description: "Возвращает текущие координаты курсора.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_scroll",
      description: "Скроллит колесиком мыши. Положительное значение = вниз, отрицательное = вверх.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "количество шагов (полож. = вниз, отриц. = вверх)" },
          horizontal: { type: "boolean", description: "горизонтальный скролл" },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "keyboard_type",
      description: "Печатает текст на клавиатуре (wtype).",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "текст для ввода" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "keyboard_hotkey",
      description: "Нажимает комбинацию клавиш. Примеры: ctrl+c, alt+tab, ctrl+shift+esc, super, ctrl+alt+delete",
      parameters: {
        type: "object",
        properties: { hotkey: { type: "string", description: "комбинация через +, например ctrl+c" } },
        required: ["hotkey"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "keyboard_press",
      description: "Нажимает одну клавишу. Примеры: enter, tab, escape, space, up, down, f5",
      parameters: {
        type: "object",
        properties: { key: { type: "string", description: "название клавиши" } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clipboard",
      description: "Читает или записывает буфер обмена. action: read | write | clear",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["read", "write", "clear"] },
          text: { type: "string", description: "текст для записи (только для write)" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "window_manage",
      description: "Управляет окнами: list - список, focus - активировать по id или имени, minimize, maximize, close, active - инфо об активном окне",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "focus", "minimize", "maximize", "close", "active"] },
          target: { type: "string", description: "window id или название окна (для focus)" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pm2_control",
      description: "Управляет PM2-процессами. action: list | start | stop | restart | logs",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "start", "stop", "restart", "logs"] },
          name: { type: "string" },
          lines: { type: "number" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Читает файл или последние N строк (tail).",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" }, tail: { type: "number" } },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Записывает/обновляет файл. Создаёт директории при необходимости.",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" }, content: { type: "string" } },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sqlite_query",
      description: "SQL-запрос к SQLite базе данных.",
      parameters: {
        type: "object",
        properties: { db_path: { type: "string" }, query: { type: "string" } },
        required: ["db_path", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "system_stats",
      description: "CPU, память, диск, температура, аптайм.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Делает скриншот веб-страницы через Puppeteer. Возвращает путь к скриншоту.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL страницы для скриншота" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ssh_exec",
      description: "Выполняет команду на удалённом хосте через SSH.",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string", description: "IP или hostname удалённого хоста" },
          command: { type: "string", description: "команда для выполнения" },
          timeout: { type: "number", description: "таймаут в мс (по умолчанию 30000)" },
        },
        required: ["host", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cron_manage",
      description: "Управляет cron-задачами: list | add | remove",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "remove"] },
          name: { type: "string" },
          schedule: { type: "string" },
          command: { type: "string" },
          description: { type: "string" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "music_control",
      description: "Музыка/радио на компьютере. action: play (с query — жанр: ambient, lofi, jazz, electronic, news, focus, или 'radio'), stop, next, status.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["play", "stop", "next", "status"] },
          query: { type: "string", description: "жанр/станция для play" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Запускает приложение на компьютере. name: google-chrome, rhythmbox, nautilus, code, или по-русски (браузер, файлы, терминал).",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_volume",
      description: "Системная громкость: percent (0-100) ИЛИ direction up/down.",
      parameters: {
        type: "object",
        properties: {
          percent: { type: "number" },
          direction: { type: "string", enum: ["up", "down"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_brightness",
      description: "Яркость экрана, percent 1-100.",
      parameters: {
        type: "object",
        properties: { percent: { type: "number" } },
        required: ["percent"],
      },
    },
  },
];

// ── Tool runner ───────────────────────────────────────────────────────────────
async function runTool(name, args) {
  switch (name) {
    // ── Shell ──
    case "run_shell":
      return sh(args.command, args.timeout || 20000);

    // ── Screenshot ──
    case "screenshot": {
      if (args.area) {
        const parts = args.area.match(/(\d+),(\d+)\s+(\d+)x(\d+)/);
        if (parts) {
          const r = await screenshot.captureArea(
            parseInt(parts[1]), parseInt(parts[2]),
            parseInt(parts[3]), parseInt(parts[4]),
            args.output
          );
          return r.ok ? `✅ Скриншот: ${r.path} (${Math.round(r.size / 1024)}KB)` : `❌ ${r.error}`;
        }
        return `❌ Неверный формат area. Используй: x,y width×height`;
      }
      const r = await screenshot.captureFullScreen(args.output);
      return r.ok ? `✅ Скриншот: ${r.path} (${Math.round(r.size / 1024)}KB)` : `❌ ${r.error}`;
    }

    // ── Mouse ──
    case "mouse_move": {
      if (args.absolute) {
        const r = await mouse.mouseMoveAbsolute(args.x, args.y);
        return r.ok ? `✅ Курсор перемещён на (${args.x}, ${args.y})` : `❌ ${r.error}`;
      }
      const r = await mouse.mouseMoveRelative(args.x, args.y);
      return r.ok ? `✅ Курсор сдвинут на (${args.x}, ${args.y})` : `❌ ${r.error}`;
    }

    case "mouse_click": {
      if (args.button === "double") {
        const r = await mouse.mouseDoubleClick("left");
        return r.ok ? "✅ Двойной клик" : `❌ ${r.error}`;
      }
      const r = await mouse.mouseClick(args.button || "left");
      return r.ok ? `✅ Клик ${args.button || "left"}` : `❌ ${r.error}`;
    }

    case "mouse_drag": {
      const r = await mouse.mouseDrag(args.x1, args.y1, args.x2, args.y2, args.button);
      return r.ok ? `✅ Перетаскивание (${args.x1},${args.y1}) → (${args.x2},${args.y2})` : `❌ ${r.error}`;
    }

    case "mouse_position": {
      const r = await mouse.getMousePosition();
      return r.ok ? `📍 Курсор: (${r.x}, ${r.y})` : `❌ ${r.error}`;
    }

    case "mouse_scroll": {
      let r;
      if (args.horizontal) r = await mouse.scrollHorizontal(args.amount);
      else r = await mouse.scrollVertical(args.amount);
      return r.ok ? `✅ Скролл ${args.horizontal ? "гориз." : "верт."} на ${args.amount}` : `❌ ${r.error}`;
    }

    // ── Keyboard ──
    case "keyboard_type": {
      const r = await keyboard.typeText(args.text);
      return r.ok ? "✅ Текст напечатан" : `❌ ${r.error}`;
    }

    case "keyboard_hotkey": {
      const r = await keyboard.hotkey(args.hotkey);
      return r.ok ? `✅ Хоткей: ${args.hotkey}` : `❌ ${r.error}`;
    }

    case "keyboard_press": {
      const r = await keyboard.pressKey(args.key);
      return r.ok ? `✅ Клавиша: ${args.key}` : `❌ ${r.error}`;
    }

    // ── Clipboard ──
    case "clipboard": {
      if (args.action === "read") {
        const r = await clipboard.read();
        return r.ok ? `📋 Буфер: ${r.text}` : `❌ ${r.error}`;
      }
      if (args.action === "write") {
        const r = await clipboard.write(args.text || "");
        return r.ok ? "✅ Записано в буфер" : `❌ ${r.error}`;
      }
      if (args.action === "clear") {
        const r = await clipboard.clear();
        return r.ok ? "✅ Буфер очищен" : `❌ ${r.error}`;
      }
      return "❌ Неизвестное действие. Используй: read, write, clear";
    }

    // ── Windows ──
    case "window_manage": {
      if (args.action === "list") {
        const r = await windowManager.listWindows();
        if (!r.ok) return `❌ ${r.error}`;
        return r.windows.map(w => `  ${w.id} → ${w.title}`).join("\n") || "(нет окон)";
      }
      if (args.action === "active") {
        const r = await windowManager.getActiveWindow();
        return r.ok ? `🪟 Активное окно: ${r.title} (${r.id})` : `❌ ${r.error}`;
      }
      if (args.action === "minimize") {
        const r = await windowManager.minimizeWindow(args.target);
        return r.ok ? "✅ Окно свёрнуто" : `❌ ${r.error}`;
      }
      if (args.action === "maximize") {
        const r = await windowManager.maximizeWindow(args.target);
        return r.ok ? "✅ Окно развёрнуто" : `❌ ${r.error}`;
      }
      if (args.action === "close") {
        const r = await windowManager.closeWindow(args.target);
        return r.ok ? "✅ Окно закрыто" : `❌ ${r.error}`;
      }
      if (args.action === "focus") {
        // Try as numeric ID first
        if (args.target && /^0x[0-9a-f]+$|^\d+$/.test(args.target)) {
          const r = await windowManager.focusWindow(args.target);
          return r.ok ? `✅ Фокус на окно ${args.target}` : `❌ ${r.error}`;
        }
        const r = await windowManager.focusWindowByName(args.target);
        return r.ok ? `✅ Фокус на "${args.target}"` : `❌ ${r.error}`;
      }
      return "❌ Неизвестное действие. Используй: list, focus, minimize, maximize, close, active";
    }

    // ── PM2 ──
    case "pm2_control": {
      if (args.action === "list") {
        const raw = await sh("pm2 jlist");
        try {
          return JSON.parse(raw)
            .map(p => {
              const mem = p.pm2_env.status === "online" && p.monit?.memory
                ? ` ${Math.round(p.monit.memory / 1024 / 1024)}MB` : "";
              const restarts = p.pm2_env.restart_time > 0 ? ` ↺${p.pm2_env.restart_time}` : "";
              return `${p.pm2_env.status === "online" ? "✅" : "⏹"} ${p.name}${mem}${restarts}`;
            })
            .join("\n");
        } catch { return raw; }
      }
      if (args.action === "logs") {
        const raw = await sh(`pm2 logs ${args.name || "all"} --lines ${args.lines || 40} --nostream 2>&1`);
        return raw.split("\n")
          .map(l => l.replace(/^\d+\|[\w-]+\s*\|\s?/, ""))
          .filter(l => l.trim())
          .join("\n");
      }
      const out = await sh(`pm2 ${args.action} ${args.name} 2>&1`);
      const ok = !out.toLowerCase().includes("error");
      return `${ok ? "✅" : "❌"} pm2 ${args.action} ${args.name}\n${out.split("\n").slice(0, 4).join("\n")}`;
    }

    // ── File operations ──
    case "read_file": {
      try {
        if (args.tail) return sh(`tail -n ${args.tail} "${args.file_path}"`);
        const c = fs.readFileSync(args.file_path, "utf8");
        return c.slice(0, 4000) || "(пустой)";
      } catch (e) { return `Ошибка: ${e.message}`; }
    }

    case "write_file": {
      try {
        fs.mkdirSync(path.dirname(args.file_path), { recursive: true });
        fs.writeFileSync(args.file_path, args.content, "utf8");
        return `✅ Записан: ${args.file_path}`;
      } catch (e) { return `Ошибка: ${e.message}`; }
    }

    // ── SQLite ──
    case "sqlite_query": {
      const tmpQ = `/tmp/bot_query_${Date.now()}.sql`;
      fs.writeFileSync(tmpQ, args.query);
      const result = await sh(`sqlite3 -header -column "${args.db_path}" < "${tmpQ}" 2>&1 | head -80`);
      try { fs.unlinkSync(tmpQ); } catch {}
      return result;
    }

    // ── System stats ──
    case "system_stats":
      return getStats();

    // ── Browser screenshot ──
    case "browser_screenshot": {
      const url = args.url.startsWith("http") ? args.url : `https://${args.url}`;
      const execAsync2 = require("./tools/helpers.js").execAsync;
      const outPath = `/tmp/browser_${Date.now()}.png`;
      try {
        await execAsync2(
          `node ${__dirname}/browser/screenshot.js '${url.replace(/'/g, "'\\''")}'`,
          { timeout: 30000 }
        );
        if (require("fs").existsSync("/tmp/screenshot.png")) {
          require("fs").renameSync("/tmp/screenshot.png", outPath);
        } else {
          return `❌ Не удалось сделать скриншот ${url}`;
        }
        const size = require("fs").statSync(outPath).size;
        return `✅ Скриншот: ${outPath} (${Math.round(size / 1024)}KB)`;
      } catch (e) { return `❌ Ошибка: ${e.message}`; }
    }

    // ── SSH ──
    case "ssh_exec": {
      return await sh(`ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${args.host} '${args.command.replace(/'/g, "'\\''")}' 2>&1`, args.timeout || 30000);
    }

    // ── Cron ──
    case "cron_manage": {
      const reg = readRegistry();
      if (args.action === "list") {
        const tab = await sh("crontab -l 2>/dev/null || echo '(пусто)'");
        const list = Object.entries(reg).map(([n, c]) => `  ${n}: ${c.schedule} → ${c.command}`).join("\n") || "  (пусто)";
        return `Crontab:\n${tab}\n\nРеестр:\n${list}`;
      }
      if (args.action === "add") {
        if (!args.name || !args.schedule || !args.command) return "Нужны: name, schedule, command";
        const tag = `# bot:${args.name}`;
        const line = `${args.schedule} ${args.command} ${tag}`;
        const tmpCron = `/tmp/bot_cron_${Date.now()}.txt`;
        const existing = await sh(`crontab -l 2>/dev/null | grep -v "bot:${args.name}" || true`);
        fs.writeFileSync(tmpCron, (existing.trim() ? existing.trim() + "\n" : "") + line + "\n");
        const result = await sh(`crontab "${tmpCron}" && echo "OK"`);
        try { fs.unlinkSync(tmpCron); } catch {}
        if (!result.includes("OK")) return `Ошибка установки crontab: ${result}`;
        reg[args.name] = {
          schedule: args.schedule, command: args.command,
          description: args.description || "", created: new Date().toISOString(),
        };
        writeRegistry(reg);
        return `✅ Добавлена: ${args.name}\nРасписание: ${args.schedule}\nКоманда: ${args.command}`;
      }
      if (args.action === "remove") {
        await sh(`(crontab -l 2>/dev/null | grep -v "bot:${args.name}") | crontab -`);
        delete reg[args.name];
        writeRegistry(reg);
        return `✅ Удалена: ${args.name}`;
      }
      return "Неизвестное действие";
    }

    // ── Music ──
    case "music_control": {
      const music = require("./tools/music.js");
      if (args.action === "play") { const r = await music.playQuery(args.query || "radio"); return `🎵 Играю: ${r.title}`; }
      if (args.action === "stop") { await music.stop(); return "⏹ Музыка остановлена"; }
      if (args.action === "next") { const r = await music.next(); return `⏭ ${r.title}`; }
      const np = await music.nowPlaying();
      return np.playing ? `🎶 ${np.title}` : "⏹ ничего не играет";
    }

    // ── Launch app ──
    case "open_app": {
      const ALIASES = {
        "браузер": "google-chrome", "хром": "google-chrome", "chrome": "google-chrome",
        "файлы": "org.gnome.Nautilus", "проводник": "org.gnome.Nautilus", "nautilus": "org.gnome.Nautilus",
        "терминал": "org.gnome.Terminal", "terminal": "org.gnome.Terminal",
        "музыка": "org.gnome.Rhythmbox3", "rhythmbox": "org.gnome.Rhythmbox3",
        "код": "code", "vscode": "code",
      };
      const raw = String(args.name || "").toLowerCase().trim();
      const id = (ALIASES[raw] || raw).replace(/[^a-zA-Z0-9._@+-]/g, "");
      if (!id) return "❌ укажи имя приложения";
      await sh(`gtk-launch ${id} >/dev/null 2>&1 || setsid -f ${id} >/dev/null 2>&1 || true`, 8000);
      return `🚀 Запускаю ${id}`;
    }

    // ── Volume ──
    case "set_volume": {
      if (args.direction === "up") { await sh("wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 && wpctl set-volume @DEFAULT_AUDIO_SINK@ 10%+", 4000); return "🔊 громче"; }
      if (args.direction === "down") { await sh("wpctl set-volume @DEFAULT_AUDIO_SINK@ 10%-", 4000); return "🔉 тише"; }
      const pct = Math.max(0, Math.min(100, parseInt(args.percent, 10) || 0));
      await sh(`wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 && wpctl set-volume @DEFAULT_AUDIO_SINK@ ${pct / 100}`, 4000);
      return `🔊 громкость ${pct}%`;
    }

    // ── Brightness ──
    case "set_brightness": {
      const p = Math.max(1, Math.min(100, parseInt(args.percent, 10) || 50));
      await sh(`brightnessctl set ${p}% >/dev/null 2>&1 || true`, 4000);
      return `☀️ яркость ${p}%`;
    }

    default:
      return `Неизвестный инструмент: ${name}. Доступные: ${TOOLS_DEFINITIONS.map(t => t.function.name).join(", ")}`;
  }
}

module.exports = {
  TOOLS_DEFINITIONS,
  runTool,
  getSystemPrompt,
  getStats,
  readRegistry,
  writeRegistry,
};
