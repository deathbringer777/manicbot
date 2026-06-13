// commands/messaging.js — System & Seasonal Messaging approval surface.
//
// Human-friendly view over the Worker seam (/admin/messaging/*). Replaces the
// old raw-ULID + technical-tag dump with: occasions named in Russian + locale
// flags, short #N refs instead of ULIDs, inline approve/skip/approve-occasion
// buttons, and a readable preview card. Owner-only is enforced by the bot.
//
// Env (~/automation/tg-bot/.env): WORKER_URL, MESSAGING_TOKEN.

const render = require("../render.js");

const WORKER_URL = (process.env.WORKER_URL || "https://manicbot.com").replace(/\/$/, "");
const MESSAGING_TOKEN = process.env.MESSAGING_TOKEN || "";

const SEAM_TIMEOUT_MS = 15000;
const SEAM_RETRIES = 2;

// ── Humanization (pure) ──────────────────────────────────────────────────────

// occasion_key → [emoji, Russian name]. Mirrors messaging/thinkpad/commercial-dates.json.
const OCCASION = {
  new_year: ["🎉", "Новый год"],
  valentines: ["💝", "День святого Валентина"],
  fat_thursday: ["🍩", "Тлустый четверг"],
  womens_day: ["💐", "8 Марта"],
  spring_start: ["🌷", "Начало весны"],
  mothers_day: ["👩‍👧", "День матери"],
  childrens_day: ["🧸", "День защиты детей"],
  summer_start: ["☀️", "Начало лета"],
  womens_womd: ["🧔", "День парня"],
  halloween: ["🎃", "Хэллоуин"],
  black_friday: ["🛍️", "Чёрная пятница"],
  mikolajki: ["🎅", "Микołajki"],
  christmas: ["🎄", "Сочельник"],
  new_years_eve: ["🥂", "Новогодняя ночь"],
};
const LOCALE_FLAG = { ru: "🇷🇺", ua: "🇺🇦", uk: "🇺🇦", en: "🇬🇧", pl: "🇵🇱" };
const STATUS_BADGE = {
  draft: "📝 черновик",
  active: "✅ активна",
  scheduled: "⏳ запланирована",
  paused: "⏸️ пауза",
  done: "✔️ завершена",
  failed: "⚠️ ошибка",
};

/** occasion_key (or 'seasonal_<key>') → "💐 8 Марта"; unknown → prettified. */
function humanizeOccasion(key) {
  const occ = String(key || "").replace(/^seasonal_/, "");
  const m = OCCASION[occ];
  if (m) return `${m[0]} ${m[1]}`;
  const pretty = occ.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `🗓️ ${pretty || "Без названия"}`;
}
/** Just the name part (no leading emoji) — for compact button labels. */
function occasionName(key) {
  return humanizeOccasion(key).replace(/^\S+\s/, "");
}
function flagOf(loc) {
  return LOCALE_FLAG[loc] || `·${loc}`;
}
function shortDate(epochSec) {
  if (!epochSec) return "без даты";
  const d = new Date(epochSec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

// ── PURE view builders (unit-tested) ─────────────────────────────────────────

/**
 * Build the /drafts view from seam data.
 * @returns {{text:string, keyboard?:object, refs:Record<number,string>}}
 */
function buildDraftsView({ campaigns = [], templates = [] } = {}) {
  const byKey = new Map();
  for (const t of templates) {
    const k = t.template_key || "?";
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }

  if (!campaigns.length && !byKey.size) {
    return {
      text: `📭 ${render.i("Черновиков нет.")}\n${render.i("Сезонные генерируются по расписанию, биллинговые — по событиям Stripe.")}`,
      refs: {},
    };
  }

  const lines = [render.b("📨 Черновики рассылок")];
  const rows = [];
  const refs = {};

  if (campaigns.length) {
    lines.push("", render.b("🗓️ Кампании"));
    campaigns.slice(0, 15).forEach((c, idx) => {
      const ref = idx + 1;
      refs[ref] = c.id;
      const name = c.occasion_key
        ? humanizeOccasion(c.template_key || `seasonal_${c.occasion_key}`)
        : (c.title || c.kind || "Кампания");
      const badge = STATUS_BADGE[c.status] || c.status;
      lines.push(`${render.b("#" + ref)}  ${render.esc(name)}\n     ${shortDate(c.scheduled_at)} · ${badge}`);
      rows.push([
        [`✅ Одобрить #${ref}`, `msg:approve:${c.id}`],
        [`⏭️ Пропустить #${ref}`, `msg:skip:${c.id}`],
      ]);
    });
  }

  if (byKey.size) {
    lines.push("", render.b("📚 Шаблоны по поводам"));
    [...byKey.entries()].slice(0, 20).forEach(([key, arr]) => {
      const flags = arr.map((t) => flagOf(t.locale)).join(" ");
      lines.push(`• ${render.esc(humanizeOccasion(key))} — ${flags}  ${render.i(`(${arr.length} яз.)`)}`);
      rows.push([[`✅ Одобрить: ${occasionName(key)}`.slice(0, 60), `msg:tpl:${key}`]]);
    });
  }

  rows.push([["🔄 Обновить", "msg:refresh"]]);
  lines.push("", render.i("Кнопки одобряют/пропускают. Подробнее: /preview #N"));
  return { text: lines.join("\n"), keyboard: render.keyboard(rows), refs };
}

/** Build a human preview card for one draft item (campaign or template). */
function buildPreviewCard(item) {
  if (!item) return null;
  const isCampaign = "scheduled_at" in item || "occasion_key" in item;
  const lines = [];
  if (isCampaign) {
    const name = item.occasion_key
      ? humanizeOccasion(item.template_key || `seasonal_${item.occasion_key}`)
      : (item.title || item.kind || "Кампания");
    lines.push(render.b(`🔎 ${name}`));
    lines.push(render.kv("Когда", shortDate(item.scheduled_at)));
    lines.push(render.kv("Статус", STATUS_BADGE[item.status] || item.status));
    if (item.template_key) lines.push(render.kv("Шаблон", occasionName(item.template_key)));
  } else {
    lines.push(render.b(`🔎 ${humanizeOccasion(item.template_key)}`));
    lines.push(render.kv("Язык", flagOf(item.locale)));
    lines.push(render.kv("Статус", STATUS_BADGE[item.status] || item.status));
    const body = (() => {
      try { return JSON.parse(item.bodies_json || "{}").center || ""; } catch { return ""; }
    })();
    if (body) lines.push("", render.i(body.slice(0, 600)));
  }
  return lines.join("\n");
}

// ── Seam client (retry + timeout) ────────────────────────────────────────────

async function seam(method, route, body) {
  if (!MESSAGING_TOKEN) return { ok: false, error: "MESSAGING_TOKEN не задан в .env" };
  let lastErr = "network";
  for (let attempt = 0; attempt <= SEAM_RETRIES; attempt++) {
    try {
      const res = await fetch(`${WORKER_URL}/admin/messaging/${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${MESSAGING_TOKEN}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(SEAM_TIMEOUT_MS),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      // 4xx is terminal — don't retry a bad request.
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) return { ok: false, error: json.error || `http_${res.status}` };
        lastErr = json.error || `http_${res.status}`;
      } else {
        return { ok: true, ...json };
      }
    } catch (e) {
      lastErr = e && e.name === "AbortError" ? "timeout" : (e && e.message) || "network";
    }
    if (attempt < SEAM_RETRIES) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return { ok: false, error: lastErr };
}

// ── Per-chat #N → id ref store (populated by /drafts, used by typed commands) ──

const refStore = new Map(); // chatId → { [ref]: id }

function resolveRef(chatId, arg) {
  const raw = String(arg || "").trim().replace(/^#/, "");
  const refs = refStore.get(chatId) || {};
  if (/^\d+$/.test(raw) && refs[raw]) return refs[raw];
  return raw; // assume a full id was pasted
}

async function fetchDrafts() {
  return seam("GET", "drafts");
}

async function renderDrafts(chatId) {
  const res = await fetchDrafts();
  if (!res.ok) return { text: `⚠️ ${render.esc(res.error)}` };
  const view = buildDraftsView(res);
  if (view.refs) refStore.set(chatId, view.refs);
  return { text: view.text, keyboard: view.keyboard };
}

// ── Command handlers ─────────────────────────────────────────────────────────

module.exports = {
  // pure exports for tests
  buildDraftsView,
  buildPreviewCard,
  humanizeOccasion,

  commands: {
    "/drafts": {
      group: "📨 Рассылки",
      menu: true,
      description: "Черновики системных/сезонных рассылок",
      handler: async (chatId) => renderDrafts(chatId),
    },
    "/preview": {
      group: "📨 Рассылки",
      description: "Подробнее о черновике: /preview #N",
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи номер: /preview #1 (см. /drafts)";
        const id = resolveRef(chatId, arg);
        const res = await fetchDrafts();
        if (!res.ok) return { text: `⚠️ ${render.esc(res.error)}` };
        const item =
          (res.campaigns || []).find((c) => c.id === id) ||
          (res.templates || []).find((t) => t.id === id);
        if (!item) return `Не найдено: ${render.code(arg)}. Открой /drafts и используй #N.`;
        return { text: buildPreviewCard(item) };
      },
    },
    "/approve": {
      group: "📨 Рассылки",
      description: "Одобрить кампанию: /approve #N",
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи номер: /approve #1";
        const res = await seam("POST", "approve", { id: resolveRef(chatId, arg), status: "active" });
        if (!res.ok) return { text: `⚠️ ${render.esc(res.error)}` };
        return { text: `✅ Одобрено → <b>${render.esc(res.status)}</b>\n${render.i("Реальная отправка пойдёт при MESSAGING_SEND_ENABLED=1.")}` };
      },
    },
    "/skip": {
      group: "📨 Рассылки",
      description: "Пропустить кампанию: /skip #N",
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи номер: /skip #1";
        const res = await seam("POST", "approve", { id: resolveRef(chatId, arg), status: "skipped" });
        if (!res.ok) return { text: `⚠️ ${render.esc(res.error)}` };
        return { text: "⏭️ Пропущено." };
      },
    },
    "/msgsend": {
      group: "📨 Рассылки",
      description: "Одобрить к отправке: /msgsend #N",
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи номер: /msgsend #1";
        const res = await seam("POST", "approve", { id: resolveRef(chatId, arg), status: "active" });
        if (!res.ok) return { text: `⚠️ ${render.esc(res.error)}` };
        return { text: `📤 Одобрено к отправке.\n${render.i("Если MESSAGING_SEND_ENABLED=1 — уйдёт в ближайший cron-тик, иначе застейджится.")}` };
      },
    },
  },

  // Inline-button router (msg:*) — wired from callbacks.js.
  async handleCallback(cq) {
    const tg = require("../telegram.js");
    const data = cq.data || "";
    const chatId = cq.message.chat.id;
    const [, action, ...rest] = data.split(":");
    const arg = rest.join(":");

    if (action === "refresh") {
      await tg.answerCallbackQuery(cq.id, "обновляю…");
      const out = await renderDrafts(chatId);
      return tg.editMessageText(chatId, cq.message.message_id, out.text, out.keyboard ? { reply_markup: out.keyboard } : {});
    }
    if (action === "approve" || action === "skip") {
      const status = action === "approve" ? "active" : "skipped";
      const res = await seam("POST", "approve", { id: arg, status });
      await tg.answerCallbackQuery(cq.id, res.ok ? (action === "approve" ? "одобрено" : "пропущено") : "ошибка");
      const out = await renderDrafts(chatId);
      return tg.editMessageText(chatId, cq.message.message_id, out.text, out.keyboard ? { reply_markup: out.keyboard } : {});
    }
    if (action === "tpl") {
      const res = await seam("POST", "template-approve", { template_key: arg });
      await tg.answerCallbackQuery(cq.id, res.ok ? `одобрено: ${res.approved || 0}` : "ошибка");
      const out = await renderDrafts(chatId);
      return tg.editMessageText(chatId, cq.message.message_id, out.text, out.keyboard ? { reply_markup: out.keyboard } : {});
    }
    return tg.answerCallbackQuery(cq.id, "—");
  },
};
