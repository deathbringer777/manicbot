/**
 * tg-bot command module — System & Seasonal Messaging approval surface.
 * Deployed to ~/automation/tg-bot/commands/messaging.js (auto-registered by the
 * bot's command loader). CommonJS, Node 22 global fetch. Owner-only is already
 * enforced by the bot (ALLOWED_USER_ID gate).
 *
 * A button-driven operator console, not a raw dump. `/drafts` groups draft
 * templates + campaigns by OCCASION (one card per occasion, en/ua/ru/pl
 * collapsed), paginates, and drives everything from inline buttons:
 *   list → 👁 card (preview + locale switch) → ✅ approve / ⏭ skip / 🕐 schedule,
 *   each behind a confirm step. ULIDs are hidden (shown only inside a card, for
 *   debugging). Every action RE-FETCHES and edits the message in place, so a
 *   duplicate Telegram callback delivery is idempotent.
 *
 * Approving makes content deliverable, BUT real egress is still gated by
 * MESSAGING_SEND_ENABLED (env master) AND the operator send-pause — nothing here
 * bypasses the flag.
 *
 * Env (~/automation/tg-bot/.env): WORKER_URL, MESSAGING_TOKEN.
 */

const render = require("../render.js");
const tg = require("../telegram.js");

const WORKER_URL = (process.env.WORKER_URL || "https://manicbot.com").replace(/\/$/, "");
const MESSAGING_TOKEN = process.env.MESSAGING_TOKEN || "";

const SEAM_TIMEOUT_MS = 15000;
const SEAM_RETRIES = 2;
const PAGE_SIZE = 6;
const LOCALES = ["ru", "ua", "pl", "en"]; // display order; 'uk' is normalized to 'ua'
const LOCALE_LABEL = { ru: "🇷🇺 RU", ua: "🇺🇦 UA", pl: "🇵🇱 PL", en: "🇬🇧 EN" };
// Sample values so a preview renders real-looking copy instead of raw {tokens}.
const SAMPLE_VARS = { salon_name: "Demo Studio", master_name: "Анна", promoCode: "WIOSNA20", expiresAt: "31.12" };

// occasion_key → [emoji, Russian name]. Mirrors messaging/thinkpad/commercial-dates.json.
const OCCASION = {
  new_year: ["🎉", "Новый год"],
  valentines: ["💝", "День святого Валентина"],
  fat_thursday: ["🍩", "Жирный четверг"],
  womens_day: ["💐", "8 Марта"],
  spring_start: ["🌷", "Начало весны"],
  mothers_day: ["👩‍👧", "День матери"],
  childrens_day: ["🧸", "День защиты детей"],
  summer_start: ["☀️", "Начало лета"],
  womens_womd: ["👦", "День парня"],
  halloween: ["🎃", "Хэллоуин"],
  black_friday: ["🛍️", "Чёрная пятница"],
  mikolajki: ["🎅", "День святого Николая"],
  christmas: ["🎄", "Сочельник"],
  new_years_eve: ["🥂", "Новогодняя ночь"],
};
const STATUS_LABEL = {
  draft: "📝 черновик", active: "✅ активна", scheduled: "⏳ запланирована",
  paused: "⏸️ пауза", done: "✔️ завершена", failed: "⚠️ ошибка",
};

// ── Worker seam (retry + timeout, 4xx terminal) ──────────────────────────────

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
      if (res.ok) return { ok: true, ...json };
      if (res.status >= 400 && res.status < 500) return { ok: false, error: json.error || `http_${res.status}` };
      lastErr = json.error || `http_${res.status}`;
    } catch (e) {
      lastErr = e && e.name === "AbortError" ? "timeout" : (e && e.message) || "network";
    }
    if (attempt < SEAM_RETRIES) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return { ok: false, error: lastErr };
}

// ── Pure transforms (unit-tested) ────────────────────────────────────────────

/** "seasonal_new_years_eve" → "new_years_eve". */
function occasionOf(templateKey) {
  return String(templateKey || "").replace(/^seasonal_/, "");
}
function occasionEmoji(occasion) {
  return (OCCASION[occasion] && OCCASION[occasion][0]) || "🗓️";
}
/** Russian occasion name; unknown keys are prettified from the slug. */
function occasionName(occasion) {
  if (OCCASION[occasion]) return OCCASION[occasion][1];
  return occasion.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Без названия";
}
function parseJson(s) {
  if (s == null) return null;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Collapse the flat {campaigns, templates} draft listing into one card per
 * occasion (keyed by template_key). Each group carries its per-locale templates,
 * the linked draft campaign (if any), name, category, emoji.
 */
function groupDrafts(res) {
  const groups = new Map();
  const ensure = (key) => {
    if (!groups.has(key)) {
      const occ = occasionOf(key);
      groups.set(key, { key, occasion: occ, emoji: occasionEmoji(occ), name: occasionName(occ), category: "seasonal", locales: {}, campaign: null });
    }
    return groups.get(key);
  };
  for (const t of res.templates || []) {
    const g = ensure(t.template_key || "unknown");
    g.locales[t.locale === "uk" ? "ua" : t.locale] = t;
    if (t.category) g.category = t.category;
  }
  for (const c of res.campaigns || []) {
    ensure(c.template_key || `seasonal_${c.occasion_key || "unknown"}`).campaign = c;
  }
  // Occasions with a scheduled campaign first (by date), then by name.
  return [...groups.values()].sort((a, b) => {
    const da = a.campaign?.scheduled_at ?? Infinity;
    const db = b.campaign?.scheduled_at ?? Infinity;
    return da !== db ? da - db : a.name.localeCompare(b.name);
  });
}

function haveLocales(group) {
  return LOCALES.filter((l) => group.locales[l]);
}
/** "🌐 RU UA PL EN" or "RU UA · нет PL EN" when some locales are missing. */
function localeReadiness(group) {
  const have = haveLocales(group).map((l) => l.toUpperCase());
  const missing = LOCALES.filter((l) => !group.locales[l]).map((l) => l.toUpperCase());
  if (!missing.length) return `🌐 ${have.join(" ")}`;
  return `${have.join(" ") || "—"} · нет ${missing.join(" ")}`;
}
/** Substitute {var} → sample value (unknown tokens left intact). */
function fillVars(text) {
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => (k in SAMPLE_VARS ? SAMPLE_VARS[k] : m));
}
/** Rendered preview body for a locale (falls back ru → en → any). */
function previewBody(group, locale) {
  const t = group.locales[locale] || group.locales.ru || group.locales.en || Object.values(group.locales)[0];
  if (!t) return null;
  const bodies = parseJson(t.bodies_json) || {};
  const raw = bodies.center || bodies.bell || Object.values(bodies)[0] || "(нет текста)";
  return { id: t.id, locale: t.locale === "uk" ? "ua" : t.locale, text: fillVars(raw) };
}
function paginate(items, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.max(0, Math.min(Number(page) || 0, pages - 1));
  return { pageItems: items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE), page: p, pages };
}
function fmtDate(epochSec) {
  if (!epochSec) return null;
  const d = new Date(epochSec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

// ── View builders → { text, keyboard } ───────────────────────────────────────

function listView(groups, page) {
  if (!groups.length) {
    return { text: `📭 ${render.b("Черновиков нет.")}\n${render.i("Всё одобрено, либо планировщик ещё не создал кампании.")}`, keyboard: render.keyboard([[["🔄 Обновить", "msg:list:0"]]]) };
  }
  const { pageItems, page: p, pages } = paginate(groups, page);
  const text = `${render.b("📨 Черновики рассылок")}\n${render.i(`Оказий: ${groups.length} · стр. ${p + 1}/${pages}`)}`;
  const rows = pageItems.map((g) => {
    const date = g.campaign ? ` · 📅${fmtDate(g.campaign.scheduled_at) || "—"}` : "";
    const label = `${g.emoji} ${g.name} · ${haveLocales(g).length}🌐${date}`;
    return [[label.slice(0, 60), `msg:card:${g.key}:${p}`]];
  });
  rows.push([
    p > 0 ? ["◀", `msg:list:${p - 1}`] : ["·", "msg:noop"],
    [`${p + 1}/${pages}`, "msg:noop"],
    p < pages - 1 ? ["▶", `msg:list:${p + 1}`] : ["·", "msg:noop"],
  ]);
  rows.push([["🔄 Обновить", `msg:list:${p}`]]);
  return { text, keyboard: render.keyboard(rows) };
}

function cardView(group, page, locale) {
  const pv = previewBody(group, locale);
  const lines = [
    `${group.emoji} ${render.b(group.name)}  ${render.i(`(${group.occasion})`)}`,
    render.kv("Локали", localeReadiness(group)),
  ];
  lines.push(group.campaign
    ? render.kv("Кампания", `${STATUS_LABEL[group.campaign.status] || group.campaign.status}${group.campaign.scheduled_at ? ` · ${fmtDate(group.campaign.scheduled_at)}` : ""}`)
    : render.kv("Кампания", "ещё не создана планировщиком"));
  lines.push("");
  if (pv) {
    lines.push(render.b(`Превью · ${pv.locale.toUpperCase()}`), render.esc(pv.text).slice(0, 1200), "", render.code(`ID: ${pv.id}`));
  } else {
    lines.push(render.i("Нет текста для превью."));
  }
  const rows = [];
  const locRow = haveLocales(group).map((l) => [LOCALE_LABEL[l], `msg:loc:${group.key}:${l}:${page}`]);
  if (locRow.length) rows.push(locRow);
  rows.push([["✅ Одобрить", `msg:appr:${group.key}:${page}`], ["⏭ Пропустить", `msg:skip:${group.key}:${page}`]]);
  if (group.campaign) rows.push([["🕐 Запланировать", `msg:sched:${group.key}:${page}`]]);
  rows.push([["⬅️ К списку", `msg:list:${page}`]]);
  return { text: lines.join("\n"), keyboard: render.keyboard(rows) };
}

function confirmView(group, page, kind) {
  const approve = kind === "appr";
  const locs = haveLocales(group).map((l) => l.toUpperCase()).join(" ") || "—";
  const text = approve
    ? `Одобрить оказию ${render.b(group.name)}?\nШаблоны: ${locs}${group.campaign ? " + кампания" : ""}.\n${render.i("Реальная отправка — только при включённом флаге.")}`
    : `Пропустить оказию ${render.b(group.name)}?\nШаблоны уйдут в архив${group.campaign ? ", кампания — в done" : ""}.`;
  const yes = `msg:${approve ? "apprY" : "skipY"}:${group.key}:${page}`;
  return { text, keyboard: render.keyboard([[["✅ Да", yes], ["❌ Отмена", `msg:card:${group.key}:${page}`]]]) };
}

function scheduleView(group, page) {
  if (!group.campaign) {
    return { text: `🕐 У оказии ${render.b(group.name)} ещё нет кампании — планировщик создаст её ближе к дате.`, keyboard: render.keyboard([[["⬅️ Назад", `msg:card:${group.key}:${page}`]]]) };
  }
  return {
    text: `🕐 ${render.b(group.name)}\nТекущая дата: ${fmtDate(group.campaign.scheduled_at) || "—"}\nСдвинуть на:`,
    keyboard: render.keyboard([
      [["+7 дней", `msg:schedY:${group.key}:7:${page}`], ["+14", `msg:schedY:${group.key}:14:${page}`], ["+30", `msg:schedY:${group.key}:30:${page}`]],
      [["⬅️ Назад", `msg:card:${group.key}:${page}`]],
    ]),
  };
}

function errorView(error) {
  return { text: `⚠️ ${render.b("Не удалось получить данные.")}\n${render.code(error)}`, keyboard: render.keyboard([[["🔄 Повторить", "msg:list:0"]]]) };
}

// ── Data (re-fetch every action → stateless, restart-safe) ───────────────────

async function fetchGroups() {
  const res = await seam("GET", "drafts");
  if (!res.ok) return { error: res.error, groups: null };
  return { error: null, groups: groupDrafts(res) };
}
function findGroup(groups, key) {
  return (groups || []).find((g) => g.key === key) || null;
}

/** Approve/skip every draft item of an occasion (templates + campaign). Idempotent. */
async function applyOccasionStatus(group, approve) {
  if (haveLocales(group).length || Object.keys(group.locales).length) {
    const r = await seam("POST", "template-status", { template_key: group.key, status: approve ? "approved" : "archived" });
    if (!r.ok) return { ok: false, error: r.error };
  }
  if (group.campaign) {
    const r = await seam("POST", "approve", { id: group.campaign.id, status: approve ? "active" : "skipped" });
    if (!r.ok) return { ok: false, error: r.error };
  }
  return { ok: true };
}

// ── Callback router (wired from callbacks.js: data.startsWith("msg:")) ────────

function edit(cq, view) {
  return tg.editMessageText(cq.message.chat.id, cq.message.message_id, view.text, { reply_markup: view.keyboard });
}

async function handleCallback(cq) {
  const [, action, ...rest] = (cq.data || "").split(":");
  await tg.answerCallbackQuery(cq.id);
  if (action === "noop") return;

  if (action === "list") {
    const { error, groups } = await fetchGroups();
    return edit(cq, error ? errorView(error) : listView(groups, parseInt(rest[0], 10) || 0));
  }

  const key = rest[0];
  const page = parseInt(rest[rest.length - 1], 10) || 0;
  const { error, groups } = await fetchGroups();
  if (error) return edit(cq, errorView(error));
  const group = findGroup(groups, key);
  if (!group) return edit(cq, listView(groups, page)); // occasion gone (already actioned)

  switch (action) {
    case "card": return edit(cq, cardView(group, page, "ru"));
    case "loc": return edit(cq, cardView(group, page, rest[1]));
    case "appr":
    case "skip": return edit(cq, confirmView(group, page, action));
    case "apprY":
    case "skipY": {
      const r = await applyOccasionStatus(group, action === "apprY");
      if (!r.ok) return edit(cq, errorView(r.error));
      const stamp = new Date().toISOString().slice(11, 16);
      const { groups: fresh } = await fetchGroups();
      const view = listView(fresh || [], page);
      view.text = `✅ ${render.b(group.name)} — ${action === "apprY" ? "одобрено" : "пропущено"} (${stamp}).\n\n${view.text}`;
      return edit(cq, view);
    }
    case "sched": return edit(cq, scheduleView(group, page));
    case "schedY": {
      if (!group.campaign) return edit(cq, cardView(group, page, "ru"));
      const ts = Math.floor(Date.now() / 1000) + (parseInt(rest[1], 10) || 0) * 86400;
      const r = await seam("POST", "reschedule", { id: group.campaign.id, scheduled_at: ts });
      if (!r.ok) return edit(cq, errorView(r.error));
      const { groups: fresh } = await fetchGroups();
      return edit(cq, cardView(findGroup(fresh, key) || group, page, "ru"));
    }
    default: return;
  }
}

// ── Slash commands ───────────────────────────────────────────────────────────

async function draftsCommand() {
  const { error, groups } = await fetchGroups();
  return error ? errorView(error) : listView(groups, 0);
}

module.exports = {
  commands: {
    "/drafts": {
      group: "📨 Рассылки",
      menu: true,
      description: "Черновики системных/сезонных рассылок",
      handler: draftsCommand,
    },
    "/preview": {
      group: "📨 Рассылки",
      description: "Карточка оказии: /preview <occasion|template_key>",
      handler: async (_chatId, arg) => {
        const q = (arg || "").trim();
        if (!q) return "Укажи оказию: /preview christmas (см. /drafts)";
        const { error, groups } = await fetchGroups();
        if (error) return errorView(error);
        const group = findGroup(groups, q) || findGroup(groups, `seasonal_${q}`) || (groups || []).find((g) => g.occasion === q);
        return group ? cardView(group, 0, "ru") : `Не найдено в черновиках: ${render.code(q)}`;
      },
    },
  },
  handleCallback,
  // exported for unit tests
  _internal: { occasionOf, occasionName, groupDrafts, localeReadiness, fillVars, previewBody, paginate, listView, cardView, confirmView, applyOccasionStatus, fetchGroups, findGroup, seam, PAGE_SIZE, OCCASION },
};
