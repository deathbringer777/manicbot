const { sh } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/ssh": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи: /ssh <host> <command>\n\nПример: /ssh 192.168.1.100 uptime";
        const parts = arg.split(/\s+/);
        const host = parts[0];
        const cmd = parts.slice(1).join(" ");
        if (!cmd) return "❌ Укажи команду для выполнения";
        const out = await sh(`ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${host} '${cmd.replace(/'/g, "'\\''")}' 2>&1`, 30000);
        return `🔌 SSH ${host}:\n$ ${cmd}\n${out}`;
      },
      description: "Команда по SSH: /ssh 192.168.1.100 uptime",
    },
  },
};
