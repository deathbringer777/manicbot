/**
 * tg-bot command module — System & Seasonal Messaging approval surface.
 * Deployed to ~/automation/tg-bot/commands/messaging.js (auto-registered by the
 * bot's command loader). CommonJS, Node 22 global fetch. Owner-only is already
 * enforced by the bot (ALLOWED_USER_ID gate).
 *
 * Commands talk to the Worker seam (/admin/messaging/*) with the low-privilege
 * MESSAGING_TOKEN. Approving a campaign makes it deliverable, BUT real egress is
 * still globally gated by MESSAGING_SEND_ENABLED on the Worker — /msgsend only
 * approves; it cannot bypass the flag.
 *
 * Env (in ~/automation/tg-bot/.env): WORKER_URL, MESSAGING_TOKEN.
 */

const WORKER_URL = (process.env.WORKER_URL || "https://manicbot.com").replace(/\/$/, "");
const MESSAGING_TOKEN = process.env.MESSAGING_TOKEN || "";

async function seam(method, route, body) {
  if (!MESSAGING_TOKEN) return { ok: false, error: "MESSAGING_TOKEN не задан в .env" };
  try {
    const res = await fetch(`${WORKER_URL}/admin/messaging/${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${MESSAGING_TOKEN}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) return { ok: false, error: json.error || `http_${res.status}` };
    return { ok: true, ...json };
  } catch (e) {
    return { ok: false, error: e && e.name === "AbortError" ? "timeout" : (e && e.message) || "network" };
  }
}

function fmtDrafts(res) {
  if (!res.ok) return `⚠️ Ошибка: ${res.error}`;
  const camps = res.campaigns || [];
  const tpls = res.templates || [];
  if (!camps.length && !tpls.length) return "📭 Черновиков нет.";
  let out = "📋 *Черновики рассылок*\n";
  if (camps.length) {
    out += "\n🗓 Кампании:\n";
    for (const c of camps.slice(0, 20)) {
      const when = c.scheduled_at ? new Date(c.scheduled_at * 1000).toISOString().slice(0, 10) : "—";
      out += `• \`${c.id}\` — ${c.title || c.occasion_key || c.kind} (${when})\n`;
    }
  }
  if (tpls.length) {
    out += "\n📝 Шаблоны:\n";
    for (const t of tpls.slice(0, 20)) {
      out += `• \`${t.id}\` — ${t.name} [${t.template_key || "?"}/${t.locale}]\n`;
    }
  }
  out += "\n_/approve <id> — одобрить · /skip <id> — пропустить · /preview <id> — детали_";
  return out;
}

module.exports = {
  commands: {
    "/drafts": {
      group: "📨 Рассылки",
      menu: true,
      description: "Черновики системных/сезонных рассылок",
      handler: async () => fmtDrafts(await seam("GET", "drafts")),
    },
    "/preview": {
      group: "📨 Рассылки",
      description: "Детали черновика: /preview <id>",
      handler: async (_chatId, arg) => {
        const id = (arg || "").trim();
        if (!id) return "Укажи id: /preview <id> (см. /drafts)";
        const res = await seam("GET", "drafts");
        if (!res.ok) return `⚠️ ${res.error}`;
        const item =
          (res.campaigns || []).find((c) => c.id === id) ||
          (res.templates || []).find((t) => t.id === id);
        if (!item) return `Не найдено в черновиках: \`${id}\``;
        return "🔎 *Черновик*\n```json\n" + JSON.stringify(item, null, 2).slice(0, 1500) + "\n```";
      },
    },
    "/approve": {
      group: "📨 Рассылки",
      description: "Одобрить рассылку (станет активной): /approve <id>",
      handler: async (_chatId, arg) => {
        const id = (arg || "").trim();
        if (!id) return "Укажи id: /approve <id>";
        const res = await seam("POST", "approve", { id, status: "active" });
        if (!res.ok) return `⚠️ ${res.error}`;
        return `✅ Одобрено: \`${id}\` → ${res.status}\n_Реальная отправка пойдёт только при MESSAGING_SEND_ENABLED=1._`;
      },
    },
    "/skip": {
      group: "📨 Рассылки",
      description: "Пропустить рассылку (в архив): /skip <id>",
      handler: async (_chatId, arg) => {
        const id = (arg || "").trim();
        if (!id) return "Укажи id: /skip <id>";
        const res = await seam("POST", "approve", { id, status: "skipped" });
        if (!res.ok) return `⚠️ ${res.error}`;
        return `⏭ Пропущено: \`${id}\``;
      },
    },
    "/msgsend": {
      group: "📨 Рассылки",
      description: "Одобрить к отправке (нужен флаг): /msgsend <id>",
      handler: async (_chatId, arg) => {
        const id = (arg || "").trim();
        if (!id) return "Укажи id: /msgsend <id>";
        const res = await seam("POST", "approve", { id, status: "active" });
        if (!res.ok) return `⚠️ ${res.error}`;
        return `📤 Одобрено к отправке: \`${id}\`.\nЕсли MESSAGING_SEND_ENABLED=1 — уйдёт в ближайший cron-тик; иначе застейджится.`;
      },
    },
  },
};
