/**
 * commands/msgconsole.js — the Messaging control-panel screens that complement
 * the /drafts console: a /menu hub plus /stats, /plan, /calendar, /settings and a
 * messaging-cron view. Shares the Worker seam + humanization helpers exported by
 * commands/messaging.js (single seam, single occasion-name map). All screens are
 * inline-button driven under the SAME `msg:` callback prefix — messaging.js routes
 * the console actions here (see CONSOLE_ACTIONS there).
 *
 * Owner-only (enforced by the bot). Read-only against the Worker except the
 * operator send-pause toggle (POST /admin/messaging/flag), which is a SECONDARY
 * gate — the env master flag MESSAGING_SEND_ENABLED still owns real egress.
 */

const render = require("../render.js");
const tg = require("../telegram.js");
const helpers = require("../tools/helpers.js");
const { _internal } = require("./messaging.js");

const { seam, occasionName, occasionEmoji, occasionOf, fmtDate, paginate } = _internal;
const PLAN_DAYS = 150;
const CAL_DAYS = 180;
const MSG_CRONS = ["msg-holidays-sync", "msg-content-plan", "msg-preset-gen", "msg-health"];
const CRON_MARKER = { "msg-holidays-sync": "holidays-sync", "msg-content-plan": "content-plan", "msg-preset-gen": "preset-gen", "msg-health": "health" };

// ── send-state wording (shared) ──────────────────────────────────────────────
function sendStateShort(stats) {
  if (!stats.send_enabled) return "⛔ выкл (env)";
  return stats.send_paused ? "⏸ пауза" : "✅ идёт";
}
function sendStateWord(stats) {
  if (!stats.send_enabled) return "выключены глобально (env)";
  return stats.send_paused ? "на паузе у оператора" : "идут";
}

function errorView(error) {
  return { text: `⚠️ ${render.b("Ошибка")}: ${render.code(error)}`, keyboard: render.keyboard([[["⬅️ Меню", "msg:menu"]]]) };
}

// ── view builders (pure given seam data) ─────────────────────────────────────

function menuView(stats) {
  const head = stats.ok
    ? `${render.i(`Черновики: ${stats.counts.draft} · Запланировано: ${stats.counts.scheduled} · Отправка: ${sendStateShort(stats)}`)}`
    : render.i("счётчики недоступны");
  return {
    text: `${render.b("🛠 Messaging — пульт")}\n${head}`,
    keyboard: render.keyboard([
      [["📋 Черновики", "msg:list:0"], ["📊 Статистика", "msg:stats"]],
      [["📅 Контент-план", "msg:plan:0"], ["🎉 Календарь", "msg:cal:0"]],
      [["⏱ Кроны", "msg:cron"], ["⚙️ Настройки", "msg:set"]],
    ]),
  };
}

function statsView(stats) {
  if (!stats.ok) return errorView(stats.error);
  const c = stats.counts || {};
  const t = stats.templates || {};
  const dl = stats.deliveries_by_channel || {};
  const dlStr = Object.keys(dl).length ? Object.entries(dl).map(([k, v]) => `${k} ${v}`).join(" · ") : "—";
  const lines = [
    render.b("📊 Статистика рассылок"), "",
    render.kv("Кампании", `📝${c.draft || 0} ✅${c.active || 0} ⏳${c.scheduled || 0} ✔️${c.done || 0}`),
    render.kv("Шаблоны", `📝${t.draft || 0} ✅${t.approved || 0}`),
    render.kv("Доставки", dlStr),
    render.kv("Ближайшая", fmtDate(stats.next_scheduled) || "—"),
    "",
    render.kv("Флаг env", stats.send_enabled ? "✅ ON" : "⛔ OFF"),
    render.kv("Пауза оператора", stats.send_paused ? "⏸ да" : "▶️ нет"),
    render.kv("Итог", sendStateWord(stats)),
  ];
  return { text: lines.join("\n"), keyboard: render.keyboard([[["⚙️ Настройки", "msg:set"], ["⬅️ Меню", "msg:menu"]], [["🔄", "msg:stats"]]]) };
}

const ITEM_STATUS = { draft: "📝", active: "✅", scheduled: "⏳", paused: "⏸", done: "✔️" };

function planView(res, page) {
  if (!res.ok) return errorView(res.error);
  const items = res.items || [];
  if (!items.length) return { text: `${render.b("📅 Контент-план")}\n${render.i("Запланированных кампаний нет.")}`, keyboard: render.keyboard([[["⬅️ Меню", "msg:menu"]]]) };
  const { pageItems, page: p, pages } = paginate(items, page);
  const lines = [render.b("📅 Контент-план"), render.i(`${items.length} кампаний · стр. ${p + 1}/${pages}`), ""];
  const rows = [];
  for (const it of pageItems) {
    const occ = occasionOf(it.template_key || `seasonal_${it.occasion_key || ""}`);
    const name = occasionName(occ);
    lines.push(`${ITEM_STATUS[it.status] || "•"} ${occasionEmoji(occ)} ${render.esc(name)} — ${fmtDate(it.scheduled_at) || "—"}`);
    if (it.template_key) rows.push([[`👁 ${name}`.slice(0, 40), `msg:card:${it.template_key}:0`]]);
  }
  rows.push(pageNav("plan", p, pages));
  rows.push([["⬅️ Меню", "msg:menu"]]);
  return { text: lines.join("\n"), keyboard: render.keyboard(rows) };
}

function calendarView(res, page) {
  if (!res.ok) return errorView(res.error);
  const occ = res.occasions || [];
  if (!occ.length) return { text: `${render.b("🎉 Календарь")}\n${render.i("Ближайших поводов нет.")}`, keyboard: render.keyboard([[["⬅️ Меню", "msg:menu"]]]) };
  const { pageItems, page: p, pages } = paginate(occ, page);
  const lines = [render.b("🎉 Календарь поводов (PL)"), render.i(`${occ.length} поводов · стр. ${p + 1}/${pages}`), ""];
  const rows = [];
  for (const o of pageItems) {
    const name = occasionName(o.occasion_key);
    lines.push(`${occasionEmoji(o.occasion_key)} ${render.esc(name)} — ${render.esc(o.date)}`);
    rows.push([[`👁 ${name}`.slice(0, 40), `msg:card:seasonal_${o.occasion_key}:0`]]);
  }
  rows.push(pageNav("cal", p, pages));
  rows.push([["⬅️ Меню", "msg:menu"]]);
  return { text: lines.join("\n"), keyboard: render.keyboard(rows) };
}

function pageNav(kind, p, pages) {
  return [
    p > 0 ? ["◀", `msg:${kind}:${p - 1}`] : ["·", "msg:noop"],
    [`${p + 1}/${pages}`, "msg:noop"],
    p < pages - 1 ? ["▶", `msg:${kind}:${p + 1}`] : ["·", "msg:noop"],
  ];
}

function settingsView(stats) {
  if (!stats.ok) return errorView(stats.error);
  const lines = [
    render.b("⚙️ Настройки рассылок"), "",
    render.kv("Флаг env (MESSAGING_SEND_ENABLED)", stats.send_enabled ? "✅ ON" : "⛔ OFF"),
    render.i("Мастер-выключатель. Меняется только секретом Worker."),
    render.kv("Пауза оператора", stats.send_paused ? "⏸ включена" : "▶️ выключена"),
    render.i("Переключается здесь. Отправка = флаг ON И не на паузе."),
    "",
    render.kv("Итог", sendStateWord(stats)),
  ];
  const toggle = stats.send_paused
    ? [["▶️ Снять с паузы", "msg:setpause:0"]]
    : [["⏸ Поставить на паузу", "msg:setpause:1"]];
  return { text: lines.join("\n"), keyboard: render.keyboard([toggle, [["⬅️ Меню", "msg:menu"], ["🔄", "msg:set"]]]) };
}

function pauseConfirmView(toPaused) {
  const text = toPaused
    ? `Поставить отправку рассылок на ${render.b("паузу")}?\n${render.i("Сезонные кампании не будут уходить, пока не снимешь паузу.")}`
    : `${render.b("Снять")} паузу отправки?\n${render.i("Реальная отправка пойдёт только если флаг env тоже ON (сейчас это мастер-гейт).")}`;
  return { text, keyboard: render.keyboard([[["✅ Да", `msg:setpauseY:${toPaused ? 1 : 0}`], ["❌ Отмена", "msg:set"]]]) };
}

async function cronView() {
  let procs = [];
  try { procs = JSON.parse(await helpers.sh("pm2 jlist")); } catch { procs = []; }
  const byName = new Map((procs || []).map((p) => [p.name, p]));
  let logs = "";
  try { logs = await helpers.sh("tail -n 150 ~/automation/logs/messaging-*.log 2>/dev/null"); } catch { logs = ""; }
  const lastOutcome = (marker) => {
    const hit = String(logs).split("\n").filter((l) => l.includes(`[${marker}]`));
    return hit.length ? hit[hit.length - 1].replace(/^.*?\[/, "[").slice(0, 90) : "—";
  };
  const lines = [render.b("⏱ Кроны рассылок"), render.i("cron_restart — между запусками остановлены"), ""];
  for (const n of MSG_CRONS) {
    const p = byName.get(n);
    const dot = p && p.pm2_env && p.pm2_env.status === "online" ? "🟢" : "⚪️";
    lines.push(`${dot} ${render.b(n)}\n   ${render.esc(lastOutcome(CRON_MARKER[n]))}`);
  }
  return {
    text: lines.join("\n"),
    keyboard: render.keyboard([
      [["▶️ holidays", "do:proc:start:msg-holidays-sync"], ["▶️ plan", "do:proc:start:msg-content-plan"]],
      [["▶️ presets", "do:proc:start:msg-preset-gen"], ["▶️ health", "do:proc:start:msg-health"]],
      [["⬅️ Меню", "msg:menu"], ["🔄", "msg:cron"]],
    ]),
  };
}

// ── data ─────────────────────────────────────────────────────────────────────
const fetchStats = () => seam("GET", "stats");
const fetchPlan = () => seam("GET", `plan?days=${PLAN_DAYS}`);
const fetchCalendar = () => seam("GET", `calendar?days=${CAL_DAYS}`);

// ── /regen — refresh one occasion's copy via the generator (claude -p Sonnet) ──
async function regenCommand(arg) {
  const occ = String(arg || "").trim().replace(/^seasonal_/, "");
  if (!occ) return "Укажи повод: /regen christmas (см. /calendar)";
  if (!_internal.OCCASION[occ]) return `Неизвестный повод: ${render.code(occ)}. Доступные: ${Object.keys(_internal.OCCASION).join(", ")}`;
  // Detached single-occasion run; result lands as a NEW draft via the seam, never auto-sent.
  try {
    await helpers.sh(`cd ~/automation/messaging && nohup node preset-generator.js ${occ} >> ~/automation/logs/regen.log 2>&1 &`);
  } catch (e) {
    return `⚠️ Не удалось запустить генерацию: ${render.code(e.message || "spawn")}`;
  }
  return {
    text: `🎨 ${render.b(occasionName(occ))} — генерация запущена (Sonnet).\n${render.i("Новые тексты появятся в /drafts через 1–2 мин как черновик. Отправка не идёт.")}`,
    keyboard: render.keyboard([[["📋 К черновикам", "msg:list:0"]]]),
  };
}

// ── callback router (delegated from messaging.handleCallback) ────────────────
function edit(cq, view) {
  return tg.editMessageText(cq.message.chat.id, cq.message.message_id, view.text, { reply_markup: view.keyboard });
}

async function handleConsoleCallback(cq) {
  const [, action, ...rest] = (cq.data || "").split(":");
  await tg.answerCallbackQuery(cq.id);
  switch (action) {
    case "menu": return edit(cq, menuView(await fetchStats()));
    case "stats": return edit(cq, statsView(await fetchStats()));
    case "plan": return edit(cq, planView(await fetchPlan(), parseInt(rest[0], 10) || 0));
    case "cal": return edit(cq, calendarView(await fetchCalendar(), parseInt(rest[0], 10) || 0));
    case "set": return edit(cq, settingsView(await fetchStats()));
    case "setpause": return edit(cq, pauseConfirmView(rest[0] === "1"));
    case "setpauseY": {
      const paused = rest[0] === "1";
      const r = await seam("POST", "flag", { paused });
      if (!r.ok) return edit(cq, errorView(r.error));
      return edit(cq, settingsView(await fetchStats()));
    }
    case "cron": return edit(cq, await cronView());
    default: return;
  }
}

module.exports = {
  commands: {
    "/menu": { group: "📨 Рассылки", menu: true, description: "Пульт рассылок (хаб)", handler: async () => menuView(await fetchStats()) },
    "/stats": { group: "📨 Рассылки", menu: true, description: "Статистика рассылок", handler: async () => statsView(await fetchStats()) },
    "/plan": { group: "📨 Рассылки", description: "Контент-план", handler: async () => planView(await fetchPlan(), 0) },
    "/calendar": { group: "📨 Рассылки", description: "Календарь поводов", handler: async () => calendarView(await fetchCalendar(), 0) },
    "/settings": { group: "📨 Рассылки", description: "Настройки + пауза отправки", handler: async () => settingsView(await fetchStats()) },
    "/msgcron": { group: "📨 Рассылки", description: "Статус крон-задач рассылок", handler: async () => cronView() },
    "/regen": { group: "📨 Рассылки", description: "Перегенерировать тексты повода: /regen <повод>", handler: async (_chatId, arg) => regenCommand(arg) },
  },
  handleConsoleCallback,
  _internal: { menuView, statsView, planView, calendarView, settingsView, pauseConfirmView, cronView, regenCommand, sendStateWord },
};
