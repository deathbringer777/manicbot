const { exec } = require("child_process");
const { promisify } = require("util");
const render = require("../render.js");

const execAsync = promisify(exec);
const TMUX_SESSION = "bot-term";

async function ensureSession() {
  await execAsync(`tmux new-session -d -s ${TMUX_SESSION} 2>/dev/null || true`);
}

async function runInTmux(cmd) {
  const windowName = `w-${Date.now()}`;
  await ensureSession();
  await execAsync(`tmux new-window -t ${TMUX_SESSION}: -n "${windowName}"`);
  await execAsync(`tmux send-keys -t ${TMUX_SESSION}:"${windowName}" ${JSON.stringify(cmd + "; exit")} Enter`);

  // Wait for command to finish (poll exit status via a marker file)
  await new Promise((r) => setTimeout(r, 2500));

  const output = await execAsync(`tmux capture-pane -t ${TMUX_SESSION}:"${windowName}" -p 2>/dev/null`)
    .then((r) => r.stdout.trim())
    .catch(() => "");

  return { output: output || "(нет вывода)", windowName };
}

module.exports = {
  commands: {
    "/term": {
      handler: async (chatId, arg) => {
        if (!arg) {
          return {
            text: [
              "<b>/term</b> — запуск команды в tmux-терминале",
              "",
              "Примеры:",
              "<code>/term claude</code> — запустить Claude Code",
              "<code>/term htop</code> — мониторинг процессов",
              "<code>/term npx jest</code> — запустить тесты",
              "",
              "/term-list — список активных окон",
            ].join("\n"),
          };
        }

        try {
          const { output, windowName } = await runInTmux(arg);
          return {
            text: render.block(output, {
              title: `$ ${arg}  [tmux:${windowName}]`,
              maxLines: 40,
            }),
          };
        } catch (e) {
          // Fallback: direct exec with timeout when tmux unavailable
          const out = await execAsync(arg, { timeout: 30000 })
            .then((r) => (r.stdout + r.stderr).trim() || "(пустой вывод)")
            .catch((e2) => `Ошибка (exit ${e2.code}): ${(e2.stderr || e2.message).slice(0, 600)}`);
          return { text: render.block(out, { title: `$ ${arg}`, maxLines: 40 }) };
        }
      },
      description: "Запустить команду в tmux-терминале: /term claude | /term htop",
    },

    "/term-list": {
      handler: async (_chatId, _arg) => {
        const out = await execAsync(`tmux list-windows -t ${TMUX_SESSION} -F "#I: #W" 2>/dev/null`)
          .then((r) => r.stdout.trim() || "Нет активных окон")
          .catch(() => "Нет активных tmux-сессий");
        return { text: render.block(out, { title: `tmux ${TMUX_SESSION}` }) };
      },
      description: "Список активных tmux-окон: /term-list",
    },

    "/term-out": {
      handler: async (_chatId, win) => {
        const target = win?.trim() || "0";
        const out = await execAsync(`tmux capture-pane -t ${TMUX_SESSION}:"${target}" -p 2>/dev/null`)
          .then((r) => r.stdout.trim() || "(пусто)")
          .catch(() => "Окно не найдено");
        return { text: render.block(out, { title: `tmux capture [${target}]`, maxLines: 50 }) };
      },
      description: "Получить вывод tmux-окна: /term-out [номер_окна]",
    },
  },
};
