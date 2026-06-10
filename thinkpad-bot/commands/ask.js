const llm = require("../llm.js");

module.exports = {
  commands: {
    "/ask": {
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи вопрос: /ask что такое TCP/IP?\nОтвечаю без истории разговора — быстро и прямо.";
        return await llm.askOnce(arg, chatId);
      },
      description: "Быстрый вопрос без истории чата: /ask что такое TCP/IP",
    },
  },
};
