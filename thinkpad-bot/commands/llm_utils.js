module.exports = {
  commands: {
    "/translate": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи текст: /translate <text>\n\nПереведёт на русский через LLM";
        const llm = require("../llm.js");
        const reply = await llm.ask(chatId, `Переведи на русский язык:\n${arg}`);
        return `🌍 Перевод:\n${reply}`;
      },
      description: "Перевод текста (через LLM): /translate Hello world",
    },

    "/summarize": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи текст или URL: /summarize <text>\n\nПример: /summarize Длинный текст...";
        const llm = require("../llm.js");
        const reply = await llm.ask(chatId, `Сделай краткое содержание этого текста на русском (3-5 предложений):\n\n${arg.slice(0, 3000)}`);
        return `📄 Краткое содержание:\n${reply}`;
      },
      description: "Суммаризация текста: /summarize <text>",
    },

    "/note": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи текст: /note <text>\n\nПример: /note Позвонить клиенту в 15:00";
        const fs = require("fs");
        const path = require("path");
        const notesDir = path.join(__dirname, "..", "notes");
        try { fs.mkdirSync(notesDir, { recursive: true }); } catch {}
        const date = new Date().toISOString().slice(0, 10);
        const file = path.join(notesDir, `${date}.md`);
        const time = new Date().toLocaleString("ru-RU");
        fs.appendFileSync(file, `- [${time}] ${arg}\n`);
        return `📝 Заметка сохранена (${date}.md)`;
      },
      description: "Быстрая заметка: /note купить молоко",
    },
  },
};
