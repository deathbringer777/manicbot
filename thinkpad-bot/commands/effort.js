const llm = require("../llm.js");

const EFFORT_DESCRIPTIONS = {
  low: "быстро, экономно (меньше рассуждений)",
  medium: "баланс скорости и качества",
  high: "максимальное качество (больше рассуждений)",
};

module.exports = {
  commands: {
    "/effort": {
      handler: async (chatId, arg) => {
        const level = arg ? arg.trim().toLowerCase() : "";
        if (!level) {
          const current = llm.getEffort(chatId);
          const lines = Object.entries(EFFORT_DESCRIPTIONS)
            .map(([k, v]) => (k === current ? "▶" : "  ") + " <b>" + k + "</b> — " + v)
            .join("\n");
          return "Текущий effort: <b>" + current + "</b>\n\n" + lines + "\n\n/effort low | /effort medium | /effort high";
        }
        try {
          llm.setEffort(chatId, level);
          return "✅ Effort установлен: <b>" + level + "</b> — " + EFFORT_DESCRIPTIONS[level];
        } catch (e) {
          return "Неверный уровень. Используй: /effort low | /effort medium | /effort high";
        }
      },
      description: "Управление глубиной рассуждений Claude: /effort [low|medium|high]",
    },
  },
};
