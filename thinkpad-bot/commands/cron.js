// /cron — merges system crontab + bot task registry into one human-readable view.
const { humanizeCron } = require("../cron-humanize.js");
const tools = require("../tools.js");
const kb = require("../keyboards.js");
const render = require("../render.js");
const { esc, code, block } = render;

async function renderCron() {
  const { sh } = require("../tools/helpers.js");
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

  return { text: lines.join("\n"), keyboard: kb.screenKb("cron") };
}

module.exports = {
  commands: {
    "/cron": {
      handler: renderCron,
      description: "🕐 Расписания: crontab + задачи бота",
      group: "⚙️ Процессы",
      menu: true,
    },
    "/crons": {
      handler: renderCron,
      description: "🕐 Расписания (алиас /cron)",
      group: "⚙️ Процессы",
    },
  },
  renderCron,
};
