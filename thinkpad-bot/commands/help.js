// /start and /help. Both are special: /help is auto-generated from the registry
// so it never drifts from the actual command set.
const kb = require("../keyboards.js");
const render = require("../render.js");

function renderStart() {
  return {
    text: [
      `👋 <b>ThinkPad ops-бот на связи.</b>`,
      "",
      `Я управляю компьютером: скриншоты, музыка, процессы, файлы, shell.`,
      `Скажи словами — <i>«сделай скриншот»</i>, <i>«включи lofi»</i>, <i>«что с диском»</i> — или жми кнопки.`,
    ].join("\n"),
    keyboard: kb.mainMenu(),
  };
}

function renderHelp() {
  // Lazy require breaks the load-time cycle: index.js is done by the time any
  // handler is called, so this is safe.
  const registry = require("./index.js");
  const groups = registry.getHelp();

  const lines = [
    `🤖 <b>ThinkPad ops-бот</b>`,
    `<i>Пиши команду или просто говори словами — выполню.</i>`,
    "",
  ];

  for (const [groupName, cmds] of groups.entries()) {
    if (groupName === "") continue; // skip ungrouped in /help
    lines.push(`<b>${groupName}</b>`);
    for (const { name, description } of cmds) {
      lines.push(`${name} — ${render.esc(description)}`);
    }
    lines.push("");
  }

  return { text: lines.join("\n").trimEnd() };
}

module.exports = {
  commands: {
    "/start": {
      handler: renderStart,
      description: "🏠 Главное меню",
      group: "",
      menu: true,
    },
    "/help": {
      handler: renderHelp,
      description: "❓ Все команды",
      group: "",
      menu: true,
    },
  },
  renderStart,
  renderHelp,
};
