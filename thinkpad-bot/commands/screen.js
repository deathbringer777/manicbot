// Screen & input commands: screenshot, mouse position, window list, clipboard.
const screenshot = require("../tools/screenshot.js");
const mouse = require("../tools/mouse.js");
const windowManager = require("../tools/window.js");
const clipboard = require("../tools/clipboard.js");
const render = require("../render.js");

const { esc, block } = render;

async function renderScreenshot() {
  const r = await screenshot.captureFullScreen();
  if (!r.ok) return { text: esc(r.error) };
  return { photo: r.path, caption: `📸 ${Math.round(r.size / 1024)} KB` };
}

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

module.exports = {
  commands: {
    "/screenshot": {
      handler: renderScreenshot,
      description: "📸 Скриншот экрана",
      group: "🖥 Экран и ввод",
      menu: true,
    },
    "/mouse": {
      handler: renderMouse,
      description: "Позиция курсора мыши",
      group: "🖥 Экран и ввод",
    },
    "/windows": {
      handler: renderWindows,
      description: "Список открытых окон",
      group: "🖥 Экран и ввод",
    },
    "/clipboard": {
      handler: renderClipboard,
      description: "Содержимое буфера обмена",
      group: "🖥 Экран и ввод",
    },
  },
  // Exported for callbacks.js navigation (editMessage flow needs renderScreenshot).
  renderScreenshot,
};
