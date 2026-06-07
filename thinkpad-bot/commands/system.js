const { sh } = require("../tools/helpers.js");
const render = require("../render.js");

module.exports = {
  commands: {
    "/process": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи имя процесса: <code>/process node</code>" };
        const out = await sh(`ps aux | grep -i "${arg}" | grep -v grep | head -10`);
        if (!out.trim() || out.startsWith("Ошибка")) return { text: `🔍 Процесс «${render.esc(arg)}» не найден` };
        const lines = out.split("\n").map((l) => {
          const p = l.trim().split(/\s+/);
          return `${p[10] || "?"}  PID:${p[1]} CPU:${p[2]}% MEM:${p[3]}% ${Math.round(parseInt(p[5]) / 1024) || "?"}MB`;
        });
        return { text: render.block(lines.join("\n"), { title: `🔄 Процессы «${arg}»`, maxLines: 12 }) };
      },
      description: "Информация о процессе: /process node",
    },

    "/port": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи порт: <code>/port 3000</code>" };
        const port = parseInt(arg, 10);
        if (Number.isNaN(port) || port < 1 || port > 65535) return { text: "❌ Некорректный порт (1–65535)" };
        const out = await sh(`ss -tlnp "sport = :${port}" 2>/dev/null || lsof -i :${port} 2>/dev/null`);
        if (!out.trim() || out.startsWith("Ошибка")) return { text: `🔌 Порт ${port} свободен` };
        return { text: render.block(out, { title: `🔌 Порт ${port}`, maxLines: 16 }) };
      },
      description: "Кто слушает порт: /port 3000",
    },

    "/systemd": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи: <code>/systemd nginx status</code>" };
        const [name, action = "status"] = arg.split(/\s+/);
        const out = await sh(`systemctl ${action} ${name} 2>&1 | head -15`);
        return { text: render.block(out, { title: `⚙️ systemctl ${action} ${name}`, maxLines: 16 }) };
      },
      description: "Управление systemd: /systemd nginx status",
    },

    "/notification": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи текст: <code>/notification Привет!</code>" };
        const out = await sh(`notify-send "🤖 TG Bot" "${arg.replace(/"/g, '\\"')}"`);
        return { text: out.startsWith("Ошибка") ? `❌ ${render.esc(out)}` : "💬 Уведомление отправлено на рабочий стол" };
      },
      description: "Уведомление на рабочий стол: /notification Привет!",
    },

    "/docker": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи команду: <code>/docker ps -a</code>" };
        const out = await sh(`docker ${arg} 2>&1 | head -30`);
        return { text: render.block(out, { title: `🐳 docker ${arg}`, maxLines: 30 }) };
      },
      description: "Docker: /docker ps -a",
    },

    "/speedtest": {
      handler: async (chatId) => {
        const tg = require("../telegram.js");
        const stop = tg.keepTyping(chatId);
        const out = await sh(
          "curl -s https://raw.githubusercontent.com/sivel/speedtest-cli/master/speedtest.py 2>/dev/null | python3 - --simple 2>&1 || echo 'speedtest-cli не установлен'",
          60000,
        );
        stop();
        return { text: render.block(out, { title: "🚀 Speedtest", maxLines: 10 }) };
      },
      description: "Тест скорости интернета",
    },
  },
};
