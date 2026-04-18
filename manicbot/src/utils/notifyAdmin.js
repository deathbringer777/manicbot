/**
 * Fire-and-forget Telegram notification to the platform admin.
 * Uses env.BOT_TOKEN (legacy platform bot) + env.ADMIN_CHAT_ID.
 * Silently skips if either is missing so public HTTP endpoints never fail.
 */

const TG_TIMEOUT_MS = 5000;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

async function sendToAdmin(env, text) {
  // Prefer dedicated notification bot (e.g. @manic_preview_bot) when set.
  // Falls back to the legacy platform BOT_TOKEN.
  const token = env.NOTIFY_BOT_TOKEN || env.BOT_TOKEN;
  const chatId = env.NOTIFY_CHAT_ID || env.ADMIN_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[notifyAdmin] missing NOTIFY_BOT_TOKEN/BOT_TOKEN or chat id — skip');
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TG_TIMEOUT_MS),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[notifyAdmin] TG error', r.status, body.slice(0, 200));
    }
  } catch (e) {
    console.error('[notifyAdmin] fetch failed:', e?.message || e);
  }
}

export async function notifyAdminNewLead(env, lead) {
  const lines = [
    '🆕 <b>Новая заявка</b>',
    `👤 ${escapeHtml(lead.name)}`,
    `📞 ${escapeHtml(lead.phone)}`,
    `✉️ ${escapeHtml(lead.email)}`,
    `🏷 ${escapeHtml(lead.salon_type || '—')} · мастеров: ${lead.masters_count ?? '—'}`,
    `💬 ${escapeHtml(lead.note || '—')}`,
    `🌐 ${escapeHtml(lead.source || '')} · ${escapeHtml(lead.ip || '')}`,
  ];
  await sendToAdmin(env, lines.join('\n'));
}
