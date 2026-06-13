// Inline-keyboard builders. Callback data is a compact "kind:..." string kept
// well under Telegram's 64-byte limit. Mutating actions (stop/restart) go
// through an ask:→do: confirm step so a stray tap can't kill a process.
const { keyboard } = require("./render.js");

const MENU_ROW = [["⬅️ Меню", "nav:menu"]];

function mainMenu() {
  return keyboard([
    [["📊 Статус", "nav:status"], ["🔄 Процессы", "nav:ps"]],
    [["🕐 Задачи", "nav:cron"], ["💾 Диск", "nav:disk"]],
    [["📸 Скриншот", "nav:shot"], ["🤖 Claude", "nav:groq"]],
    [["❓ Все команды", "nav:help"]],
  ]);
}

// A screen with a self-refresh button + back-to-menu.
function screenKb(screen, extraRows = []) {
  return keyboard([...extraRows, [["🔄 Обновить", `nav:${screen}`], ["⬅️ Меню", "nav:menu"]]]);
}

// Per-process control rows for /ps. logs is read-only (do:); stop/restart are
// mutating (ask: → confirm). A stopped process gets a ▶️ start instead.
function procRows(list) {
  const rows = (list || []).slice(0, 8).map((p) => {
    const n = p.name;
    const online = p.pm2_env?.status === "online";
    const short = n.length > 12 ? n.slice(0, 11) + "…" : n;
    return [
      [(online ? "🟢 " : "⚪️ ") + short, "noop"],
      online ? ["🔄", `ask:proc:restart:${n}`] : ["▶️", `do:proc:start:${n}`],
      ["⏹", `ask:proc:stop:${n}`],
      ["📜", `do:proc:logs:${n}`],
    ];
  });
  rows.push([["🔄 Обновить", "nav:ps"], ["⬅️ Меню", "nav:menu"]]);
  return { inline_keyboard: rows };
}

// Confirm dialog for a mutating action token (e.g. "proc:stop:health-check").
function confirm(token, cancelScreen = "ps") {
  return keyboard([
    [["✅ Да", `do:${token}`], ["❌ Отмена", `nav:${cancelScreen}`]],
  ]);
}

// Music transport (used in Phase 4; defined here so all keyboards live together).
function musicTransport() {
  return keyboard([
    [["⏮", "mus:prev"], ["⏯", "mus:toggle"], ["⏭", "mus:next"], ["⏹", "mus:stop"]],
    [["🔉", "mus:voldown"], ["🔊", "mus:volup"], ["🎶 Что играет", "mus:np"]],
  ]);
}

module.exports = {
  MENU_ROW,
  mainMenu,
  screenKb,
  procRows,
  confirm,
  musicTransport,
};
