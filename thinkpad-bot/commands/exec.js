const config = require("../config.js");

module.exports = {
  commands: {
    "/exec": {
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи команду: /exec <shell_command>";
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const out = await execAsync(arg, { timeout: 30000, env: config.ENV })
          .then(r => (r.stdout + r.stderr).trim() || "(пустой вывод)")
          .catch(e => `Ошибка (exit ${e.code}): ${(e.stderr || e.message).slice(0, 600)}`);
        return `$ ${arg}\n${out}`;
      },
      description: "Выполнить shell-команду: /exec ls -la",
    },
  },
};
