const { sh } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/weather": {
      handler: async (chatId, arg) => {
        const city = arg || "Warsaw";
        const out = await sh(`curl -s "wttr.in/${city}?format=%C|%t|%h|%w|%p" 2>/dev/null || echo 'Ошибка'`);
        if (out === "Ошибка" || !out.includes("|")) return `🌤 Погода для "${city}" недоступна`;
        const [condition, temp, humidity, wind, precip] = out.split("|");
        const emoji = condition.includes("rain") ? "🌧" :
                      condition.includes("cloud") ? "☁️" :
                      condition.includes("sun") || condition.includes("clear") ? "☀️" :
                      condition.includes("snow") ? "❄️" :
                      condition.includes("fog") ? "🌫" : "🌤";
        return `${emoji} Погода: ${city}\n  Состояние: ${condition}\n  Температура: ${temp}\n  Влажность: ${humidity}\n  Ветер: ${wind}\n  Осадки: ${precip || "—"}`;
      },
      description: "Погода: /weather Warsaw",
    },
  },
};
