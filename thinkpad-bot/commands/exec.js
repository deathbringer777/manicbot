const config = require("../config.js");
const render = require("../render.js");

module.exports = {
  commands: {
    "/exec": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи команду: <code>/exec ls -la</code>" };
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const out = await execAsync(arg, { timeout: 30000, env: config.ENV })
          .then((r) => (r.stdout + r.stderr).trim() || "(пустой вывод)")
          .catch((e) => `Ошибка (exit ${e.code}): ${(e.stderr || e.message).slice(0, 600)}`);
        return { text: render.block(out, { title: `$ ${arg}`, maxLines: 40 }) };
      },
      description: "Выполнить shell-команду: /exec ls -la",
    },
  },
};
