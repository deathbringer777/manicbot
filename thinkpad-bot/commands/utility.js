const { sh } = require("../tools/helpers.js");
const keyboard = require("../tools/keyboard.js");

module.exports = {
  commands: {
    "/type": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи текст: /type <text>\n\nПример: /type Привет, мир!";
        const r = await keyboard.typeText(arg);
        if (!r.ok) return `❌ ${r.error}`;
        return `⌨️ Текст напечатан (${arg.length} символов)`;
      },
      description: "Напечатать текст на клавиатуре: /type Hello world",
    },

    "/calc": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи выражение: /calc <expression>\n\nПример: /calc 2 + 2 * 3";
        const allowed = /^[\d\s+\-*/().,%^]+$/;
        if (!allowed.test(arg)) return "❌ Выражение содержит недопустимые символы";
        try {
          const result = eval(arg);
          return `🧮 ${arg} = ${result}`;
        } catch (e) {
          return `❌ Ошибка вычисления: ${e.message}`;
        }
      },
      description: "Калькулятор: /calc 2 + 2 * 3",
    },

    "/ping": {
      handler: async (chatId, arg) => {
        const host = arg || "8.8.8.8";
        const out = await sh(`ping -c 4 -W 2 ${host} 2>&1 | tail -3`);
        return `📡 Ping ${host}:\n${out}`;
      },
      description: "Пинг хоста: /ping google.com",
    },

    "/ip": {
      handler: async () => {
        const ip = await sh("curl -s https://ipinfo.io/json 2>/dev/null || echo '{}'");
        try {
          const d = JSON.parse(ip);
          if (d.ip) {
            return `🌐 Внешний IP:\n  Адрес: ${d.ip}\n  Локация: ${d.city || "?"}, ${d.region || "?"}\n  Провайдер: ${d.org || "?"}`;
          }
        } catch {}
        const simple = await sh("curl -s https://api.ipify.org 2>/dev/null || echo 'недоступно'");
        return `🌐 Внешний IP: ${simple}`;
      },
      description: "Внешний IP адрес",
    },

    "/uptime": {
      handler: async () => {
        const [uptime, load] = await Promise.all([
          sh("uptime -p 2>/dev/null || uptime"),
          sh("cat /proc/loadavg | awk '{print $1, $2, $3}'"),
        ]);
        return `⏱ Система работает: ${uptime.replace(/^up\s+/, "").trim()}\n⚡ Нагрузка: ${load}`;
      },
      description: "Время работы системы",
    },

    "/battery": {
      handler: async () => {
        const out = await sh(
          'upower -i $(upower -e | grep BAT) 2>/dev/null | grep -E "percentage|state|time to empty|time to full"'
        );
        if (out.startsWith("Ошибка") || !out.trim()) {
          const alt = await sh("cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1");
          return alt ? `🔋 Заряд батареи: ${alt.trim()}%` : "🔋 Информация о батарее недоступна";
        }
        return `🔋 Батарея:\n${out}`;
      },
      description: "Статус батареи",
    },

    "/wifi": {
      handler: async () => {
        const ssid = await sh("iwgetid -r 2>/dev/null || echo 'не подключён'");
        const signal = await sh("iwconfig 2>/dev/null | grep -o 'Signal level=[^ ]*' || echo ''");
        const ip = await sh("ip -4 addr show wlan0 2>/dev/null | grep -oP 'inet \\K[\\d.]+' || echo '—'");
        return `📶 Wi-Fi:\n  Сеть: ${ssid.trim()}\n  ${signal.trim() || "Уровень: —"}\n  IP: ${ip.trim()}`;
      },
      description: "Статус Wi-Fi сети",
    },

    "/bluetooth": {
      handler: async () => {
        const devices = await sh("bluetoothctl devices 2>/dev/null || echo 'нет устройств'");
        const connected = await sh("bluetoothctl info 2>/dev/null | grep -E 'Name|Connected' || echo ''");
        const lines = devices.split("\n").filter(Boolean);
        if (lines.length === 0 || lines[0].includes("нет")) return "🔵 Bluetooth устройства не найдены";
        return `🔵 Bluetooth:\n${lines.join("\n")}\n\n${connected ? `Активно:\n${connected}` : ""}`;
      },
      description: "Список Bluetooth устройств",
    },

    "/env": {
      handler: async () => {
        const safe = ["HOME", "USER", "SHELL", "LANG", "PATH", "NODE_ENV", "DISPLAY", "XDG_RUNTIME_DIR", "WAYLAND_DISPLAY", "TERM"];
        return safe.map(k => `  ${k}=${process.env[k] || "—"}`).join("\n");
      },
      description: "Переменные окружения (безопасно)",
    },
  },
};
