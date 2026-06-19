/**
 * Canonical registry of AI crawler user-agents, split by purpose.
 *
 * Two kinds matter for GEO/AEO (AI-search visibility):
 *  - `training` — crawls to build long-term model datasets (GPTBot, ClaudeBot,
 *                 Google-Extended, CCBot…). Allowing them keeps the ManicBot
 *                 brand present in model weights.
 *  - `citation` — real-time retrieval that powers live answers and the source
 *                 links shown to users (OAI-SearchBot, Claude-SearchBot,
 *                 PerplexityBot…). These MUST be allowed to be eligible for
 *                 citation in answer engines.
 *
 * Policy (decided 2026-06): allow ALL of them — maximum visibility. `robots:true`
 * marks the bots we list explicitly in robots.txt as a public "paper trail";
 * the rest are still allowed via the `User-agent: *` default and are counted by
 * the AI-bot analytics counter (Track E).
 *
 * `ua` is the lowercase substring matched against the request User-Agent. The
 * substrings are deliberately full and distinct (`perplexitybot` vs
 * `perplexity-user`, `claudebot` vs `claude-searchbot`) so a live citation bot
 * is never collapsed into the same label as its training crawler.
 *
 * NOTE: `Google-Extended` / `Applebot-Extended` are robots.txt *control tokens*,
 * not real request UAs — they never match live traffic (so they are never
 * counted), which is correct: they exist only to express crawl policy.
 *
 * @typedef {{ name: string, ua: string, kind: 'training' | 'citation', robots: boolean }} AiBot
 * @type {AiBot[]}
 */
export const AI_BOTS = [
  // ── Training crawlers (model datasets) ──────────────────────────────────
  { name: 'GPTBot',             ua: 'gptbot',             kind: 'training', robots: true },
  { name: 'ClaudeBot',          ua: 'claudebot',          kind: 'training', robots: true },
  { name: 'Google-Extended',    ua: 'google-extended',    kind: 'training', robots: true },
  { name: 'CCBot',              ua: 'ccbot',              kind: 'training', robots: true },
  { name: 'Applebot-Extended',  ua: 'applebot-extended',  kind: 'training', robots: false },
  { name: 'Bytespider',         ua: 'bytespider',         kind: 'training', robots: false },
  { name: 'Meta-ExternalAgent', ua: 'meta-externalagent', kind: 'training', robots: false },
  { name: 'Amazonbot',          ua: 'amazonbot',          kind: 'training', robots: false },
  // ── Citation / live-retrieval crawlers (answer-engine sources) ──────────
  { name: 'OAI-SearchBot',      ua: 'oai-searchbot',      kind: 'citation', robots: true },
  { name: 'ChatGPT-User',       ua: 'chatgpt-user',       kind: 'citation', robots: true },
  { name: 'Claude-SearchBot',   ua: 'claude-searchbot',   kind: 'citation', robots: true },
  { name: 'Claude-User',        ua: 'claude-user',        kind: 'citation', robots: true },
  { name: 'PerplexityBot',      ua: 'perplexitybot',      kind: 'citation', robots: true },
  { name: 'Perplexity-User',    ua: 'perplexity-user',    kind: 'citation', robots: true },
  { name: 'anthropic-ai',       ua: 'anthropic-ai',       kind: 'citation', robots: false },
];

/**
 * Match a request User-Agent against the AI-bot registry. Used both to drive
 * the robots.txt allow-list intent and to count AI-bot hits (Track E).
 *
 * @param {string | null | undefined} userAgent
 * @returns {string | null} canonical bot name, or null if not a known AI bot
 */
export function isAiBot(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return null;
  const ua = userAgent.toLowerCase();
  for (const bot of AI_BOTS) {
    if (ua.includes(bot.ua)) return bot.name;
  }
  return null;
}

/**
 * The AI bots we list explicitly in robots.txt (the public "paper trail").
 * @returns {AiBot[]}
 */
export function robotsAiBots() {
  return AI_BOTS.filter((b) => b.robots);
}
