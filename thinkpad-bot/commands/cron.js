const { sh } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/crontab": {
      handler: async (chatId, arg) => {
        if (arg?.toLowerCase() === "edit") {
          const editor = process.env.EDITOR || "nano";
          return `🕐 Для редактирования crontab выполни на сервере:\n  ${editor} <(crontab -l)\n  crontab <файл>`;
        }
        const tab = await sh("crontab -l 2>/dev/null || echo '(crontab пуст)'");
        const lines = tab.split("\n").filter(Boolean);
        return `🕐 Crontab (${lines.length} строк):\n${lines.map((l, i) => `  ${i + 1}. ${l}`).join("\n")}`;
      },
      description: "Просмотр crontab: /crontab [edit]",
    },
  },
};
