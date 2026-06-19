/**
 * AI-bot visibility analytics (Track E, 2026-06 GEO pass).
 *
 * Goal: see whether AI answer-engine crawlers (PerplexityBot, OAI-SearchBot,
 * Claude-SearchBot, GPTBot…) are actually crawling the site, and whether that
 * is trending up after the GEO work — for FREE, with zero external tooling.
 *
 * Storage: a single KV key per UTC day, `aibot:{YYYY-MM-DD}`, holding a
 * `{ [botName]: count }` map. The Worker increments it fire-and-forget on every
 * request carrying an AI-bot user-agent; a weekly-gated cron reads the last 7
 * days and posts a Telegram digest.
 *
 * Accuracy caveat (intentional): KV has no atomic increment, so concurrent hits
 * during a crawl burst race on the read-modify-write and some increments are
 * lost; KV also coalesces sustained same-key writes. The numbers are therefore
 * a TREND signal ("are AI bots visiting, roughly how much, going up?"), not an
 * exact count. If exact counts are ever needed, the upgrade path is a Workers
 * Analytics Engine dataset (write-only, no per-write quota). Writes are wrapped
 * in try/catch so hitting the KV free-tier write quota silently degrades to
 * under-counting and NEVER affects the request.
 */

const KEY_PREFIX = 'aibot:';
const LAST_DIGEST_KEY = 'aibot:last_digest';
const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_INTERVAL_MS = 7 * DAY_MS;
// Keep ~6 weeks of daily buckets so week-over-week deltas always have history.
const KEY_TTL_S = 42 * 24 * 60 * 60;

/** UTC day bucket key for a given epoch-ms timestamp. */
function dayKey(ms) {
  return KEY_PREFIX + new Date(ms).toISOString().slice(0, 10);
}

/**
 * Record one AI-bot hit. Fire-and-forget; best-effort; never throws.
 * @param {{ MANICBOT?: KVNamespace }} env
 * @param {string | null} botName canonical name from isAiBot()
 * @param {number} nowMs
 */
export async function recordAiBotHit(env, botName, nowMs) {
  const kv = env?.MANICBOT;
  if (!kv || !botName) return;
  const key = dayKey(nowMs);
  try {
    const cur = (await kv.get(key, 'json')) || {};
    cur[botName] = (cur[botName] || 0) + 1;
    await kv.put(key, JSON.stringify(cur), { expirationTtl: KEY_TTL_S });
  } catch {
    // Analytics is best-effort. A KV quota error must never reach the request.
  }
}

/**
 * Sum per-bot hits over `days` UTC buckets ending at `endMs` (inclusive).
 * @param {{ MANICBOT?: KVNamespace }} env
 * @param {number} endMs
 * @param {number} days
 * @returns {Promise<{ totals: Record<string, number>, grand: number }>}
 */
export async function sumAiBotHits(env, endMs, days) {
  const kv = env?.MANICBOT;
  const totals = {};
  let grand = 0;
  if (!kv) return { totals, grand };
  for (let i = 0; i < days; i++) {
    const obj = await kv.get(dayKey(endMs - i * DAY_MS), 'json');
    if (!obj) continue;
    for (const [bot, n] of Object.entries(obj)) {
      const v = Number(n) || 0;
      totals[bot] = (totals[bot] || 0) + v;
      grand += v;
    }
  }
  return { totals, grand };
}

/**
 * Format the weekly digest text (pure — easy to unit test).
 * @param {{ totals: Record<string, number>, grand: number }} cur this week
 * @param {{ totals: Record<string, number>, grand: number }} prev previous week
 */
export function buildAiBotDigestText(cur, prev) {
  const lines = ['🤖 AI-bot crawl digest — last 7 days', ''];
  const sorted = Object.entries(cur.totals).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    lines.push('No AI-bot hits recorded this week.');
  } else {
    for (const [bot, n] of sorted) {
      const p = prev.totals[bot] || 0;
      let wow = '';
      if (p === 0 && n > 0) wow = ' (new)';
      else if (n !== p) wow = ` (${n >= p ? '+' : ''}${n - p} WoW)`;
      lines.push(`• ${bot}: ${n}${wow}`);
    }
  }
  lines.push('', `Total: ${cur.grand} (prev 7d: ${prev.grand})`);
  return lines.join('\n');
}

/**
 * Send a short message to the admin Telegram chat. Mirrors the token/chat
 * resolution used by POST /admin/notify (NOTIFY_BOT_TOKEN → BOT_TOKEN,
 * NOTIFY_CHAT_ID → ADMIN_CHAT_ID). `deps.fetch` is injectable for tests.
 */
async function sendAdminTelegram(env, text, deps) {
  const f = deps?.fetch || fetch;
  const token = env.NOTIFY_BOT_TOKEN || env.BOT_TOKEN;
  const chatId = env.NOTIFY_CHAT_ID || env.ADMIN_CHAT_ID;
  if (!token || !chatId) return { ok: false, reason: 'no_token' };
  const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text, disable_web_page_preview: true }),
  });
  return { ok: !!r?.ok };
}

/**
 * Weekly-gated AI-bot digest. Seeds the timer on first ever run (no send), then
 * posts a per-bot crawl summary to Telegram every ≥7 days. Idempotent: the
 * `aibot:last_digest` timestamp gate means extra 15-min cron ticks no-op.
 *
 * @param {{ MANICBOT?: KVNamespace, NOTIFY_BOT_TOKEN?: string, BOT_TOKEN?: string, NOTIFY_CHAT_ID?: string, ADMIN_CHAT_ID?: string }} env
 * @param {number} nowMs
 * @param {{ fetch?: typeof fetch }} [deps]
 */
export async function maybeRunAiBotDigest(env, nowMs, deps) {
  const kv = env?.MANICBOT;
  if (!kv) return { skipped: 'no_kv' };
  const lastRaw = await kv.get(LAST_DIGEST_KEY);
  const last = lastRaw ? Number(lastRaw) : 0;
  // First run ever: seed the timer WITHOUT sending, so the first real digest
  // arrives a week later when there is actually a week of data to report.
  if (!last) {
    await kv.put(LAST_DIGEST_KEY, String(nowMs));
    return { seeded: true };
  }
  if (nowMs - last < DIGEST_INTERVAL_MS) return { skipped: 'not_due' };

  const cur = await sumAiBotHits(env, nowMs, 7);
  const prev = await sumAiBotHits(env, nowMs - DIGEST_INTERVAL_MS, 7);
  const text = buildAiBotDigestText(cur, prev);
  const sent = await sendAdminTelegram(env, text, deps);
  await kv.put(LAST_DIGEST_KEY, String(nowMs));
  return { sent: sent.ok, grand: cur.grand };
}
