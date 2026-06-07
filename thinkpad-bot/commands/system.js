const { sh } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/process": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи имя процесса: /process <name>\n\nПример: /process node";
        const out = await sh(`ps aux | grep -i "${arg}" | grep -v grep | head -10`);
        if (!out.trim() || out.startsWith("Ошибка")) return `🔍 Процесс "${arg}" не найден`;
        const lines = out.split("\n").map(l => {
          const p = l.trim().split(/\s+/);
          return `  ${p[10] || "?"}  PID:${p[1]}  CPU:${p[2]}%  MEM:${p[3]}%  RSS:${Math.round(parseInt(p[5]) / 1024) || "?"}MB`;
        });
        return `🔄 Процессы "${arg}" (${lines.length}):\n${lines.join("\n")}`;
      },
      description: "Информация о процессе: /process node",
    },

    "/port": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи номер порта: /port <number>\n\nПример: /port 3000";
        const port = parseInt(arg, 10);
        if (isNaN(port) || port < 1 || port > 65535) return "❌ Некорректный порт (1-65535)";
        const out = await sh(`ss -tlnp "sport = :${port}" 2>/dev/null || lsof -i :${port} 2>/dev/null`);
        if (!out.trim() || out.startsWith("Ошибка")) return `🔌 Порт ${port} свободен`;
        return `🔌 Порт ${port}:\n${out}`;
      },
      description: "Какой процесс слушает порт: /port 3000",
    },

    "/systemd": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи: /systemd <name> <action>\n\nПример: /systemd nginx status";
        const [name, action = "status"] = arg.split(/\s+/);
        const out = await sh(`systemctl ${action} ${name} 2>&1 | head -15`);
        return `⚙️ systemctl ${action} ${name}:\n${out}`;
      },
      description: "Управление systemd: /systemd nginx status",
    },

    "/notification": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи текст: /notification <text>\n\nПример: /notification Задача выполнена!";
        const out = await sh(`notify-send "🤖 TG Bot" "${arg.replace(/"/g, '\\"')}"`);
        return out.startsWith("Ошибка") ? `❌ ${out}` : `💬 Уведомление отправлено на рабочий стол`;
      },
      description: "Уведомление на рабочий стол: /notification Привет!",
    },

    "/docker": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи команду: /docker <cmd> [args]\n\nПример: /docker ps -a";
        const out = await sh(`docker ${arg} 2>&1 | head -30`);
        return `🐳 docker ${arg}:\n${out}`;
      },
      description: "Docker: /docker ps -a",
    },

    "/speedtest": {
      handler: async () => {
        const out = await sh("curl -s https://raw.githubusercontent.com/sivel/speedtest-cli/master/speedtest.py 2>/dev/null | python3 - --simple 2>&1 || echo 'speedtest-cli не установлен'");
        return `🚀 Speedtest:\n${out}`;
      },
      description: "Тест скорости интернета",
    },
  },
};
