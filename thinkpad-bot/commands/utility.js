const { sh } = require("../tools/helpers.js");
const keyboard = require("../tools/keyboard.js");
const render = require("../render.js");

const { esc, b, block, kv } = render;

module.exports = {
  commands: {
    "/type": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи текст: <code>/type Привет, мир!</code>" };
        const r = await keyboard.typeText(arg);
        return { text: r.ok ? `⌨️ Напечатано (${arg.length} симв.)` : `❌ ${esc(r.error)}` };
      },
      description: "Напечатать текст на клавиатуре: /type Hello world",
    },

    "/calc": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи выражение: <code>/calc 2 + 2 * 3</code>" };
        if (!/^[\d\s+\-*/().,%]+$/.test(arg)) return { text: "❌ Выражение содержит недопустимые символы" };
        try {
          // eslint-disable-next-line no-eval
          return { text: `🧮 ${esc(arg)} = ${b(eval(arg))}` };
        } catch (e) {
          return { text: `❌ ${esc(e.message)}` };
        }
      },
      description: "Калькулятор: /calc 2 + 2 * 3",
    },

    "/ping": {
      handler: async (chatId, arg) => {
        const host = arg || "8.8.8.8";
        const out = await sh(`ping -c 4 -W 2 ${host} 2>&1 | tail -3`);
        return { text: block(out, { title: `📡 Ping ${host}`, maxLines: 6 }) };
      },
      description: "Пинг хоста: /ping google.com",
    },

    "/ip": {
      handler: async () => {
        const ip = await sh("curl -s https://ipinfo.io/json 2>/dev/null || echo '{}'");
        try {
          const d = JSON.parse(ip);
          if (d.ip) {
            return {
              text: `🌐 <b>Внешний IP</b>\n${kv("адрес", d.ip)}\n${kv("локация", `${d.city || "?"}, ${d.region || "?"}`)}\n${kv("провайдер", d.org || "?")}`,
            };
          }
        } catch { /* ignore */ }
        const simple = await sh("curl -s https://api.ipify.org 2>/dev/null || echo 'недоступно'");
        return { text: `🌐 ${kv("Внешний IP", simple.trim())}` };
      },
      description: "Внешний IP адрес",
    },

    "/uptime": {
      handler: async () => {
        const [uptime, load] = await Promise.all([
          sh("uptime -p 2>/dev/null || uptime"),
          sh("cat /proc/loadavg | awk '{print $1, $2, $3}'"),
        ]);
        return { text: `⏱ <b>Аптайм:</b> ${esc(uptime.replace(/^up\s+/, "").trim())}\n⚡ <b>Нагрузка:</b> ${esc(load.trim())}` };
      },
      description: "Время работы системы",
    },

    "/battery": {
      handler: async () => {
        const out = await sh('upower -i $(upower -e | grep BAT) 2>/dev/null | grep -E "percentage|state|time to empty|time to full"');
        if (out.startsWith("Ошибка") || !out.trim()) {
          const alt = await sh("cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1");
          return { text: alt.trim() ? `🔋 Заряд батареи: ${esc(alt.trim())}%` : "🔋 Информация о батарее недоступна" };
        }
        return { text: block(out, { title: "🔋 Батарея", maxLines: 8 }) };
      },
      description: "Статус батареи",
    },

    "/wifi": {
      handler: async () => {
        const ssid = await sh("iwgetid -r 2>/dev/null || echo 'не подключён'");
        const signal = await sh("iwconfig 2>/dev/null | grep -o 'Signal level=[^ ]*' || echo ''");
        const ip = await sh("ip -4 addr show wlan0 2>/dev/null | grep -oP 'inet \\K[\\d.]+' || echo '—'");
        return {
          text: `📶 <b>Wi-Fi</b>\n${kv("сеть", ssid.trim())}\n${kv("уровень", signal.trim().replace("Signal level=", "") || "—")}\n${kv("IP", ip.trim())}`,
        };
      },
      description: "Статус Wi-Fi сети",
    },

    "/bluetooth": {
      handler: async () => {
        const devices = await sh("bluetoothctl devices 2>/dev/null || echo ''");
        const lines = devices.split("\n").filter(Boolean);
        if (!lines.length) return { text: "🔵 Bluetooth-устройства не найдены" };
        return { text: block(lines.join("\n"), { title: "🔵 Bluetooth", maxLines: 16 }) };
      },
      description: "Список Bluetooth устройств",
    },

    "/env": {
      handler: async () => {
        const safe = ["HOME", "USER", "SHELL", "LANG", "PATH", "NODE_ENV", "DISPLAY", "XDG_RUNTIME_DIR", "WAYLAND_DISPLAY", "TERM"];
        return { text: block(safe.map((k) => `${k}=${process.env[k] || "—"}`).join("\n"), { title: "🌍 Окружение", maxLines: 16 }) };
      },
      description: "Переменные окружения (безопасно)",
    },
  },
};
