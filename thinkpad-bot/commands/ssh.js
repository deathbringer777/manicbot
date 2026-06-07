const { sh } = require("../tools/helpers.js");
const render = require("../render.js");

module.exports = {
  commands: {
    "/ssh": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи: <code>/ssh &lt;host&gt; &lt;command&gt;</code>\nПример: <code>/ssh 192.168.1.100 uptime</code>" };
        const parts = arg.split(/\s+/);
        const host = parts[0];
        const cmd = parts.slice(1).join(" ");
        if (!cmd) return { text: "Укажи команду для выполнения" };
        const out = await sh(
          `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${host} '${cmd.replace(/'/g, "'\\''")}' 2>&1`,
          30000,
        );
        return { text: render.block(out, { title: `🔌 ${host}: ${cmd}`, maxLines: 30 }) };
      },
      description: "Команда по SSH: /ssh 192.168.1.100 uptime",
    },
  },
};
