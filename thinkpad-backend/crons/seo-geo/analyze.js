'use strict';
/**
 * analyze.js — turn collected signals into a prioritized, clustered universe
 * and a GEO/AEO plan.
 *
 * Priority is a TRANSPARENT deterministic score — we have NO search-volume API,
 * so we never invent volume. Clustering and the GEO recommendations are done by
 * Claude (via the headless `claude -p` adapter); if Claude is unavailable the
 * run degrades to deterministic cluster-by-(audience,cluster) grouping.
 */
const { askClaude } = require('../../lib/claude');
const { businessFitFor } = require('./taxonomy');

/** Transparent priority score from the signals we actually have. */
function scoreKeyword(signals = {}) {
  let score = 0;
  score += Math.min(signals.autocompleteDepth || 0, 10) * 2;          // breadth of real long-tail (≤20)
  score += Math.log10((signals.gscImpressions || 0) + 1) * 12;        // first-party demand
  if (signals.gscPosition) score += Math.max(0, 21 - signals.gscPosition); // striking-distance bonus
  if (signals.trendsRising) score += 15;                              // momentum
  score += (signals.businessFit ?? 1) * 8;                            // fit to product (1..3)
  if (signals.question) score += 6;                                   // GEO/FAQ value
  return Math.round(score);
}
/**
 * Attach score, sort high→low, then bucket by RELATIVE rank (top 25% High,
 * middle 50% Med, bottom 25% Low). Percentile — not a fixed threshold — so the
 * report always has a populated "High" focus group even before GSC volume data
 * exists (absolute scores are necessarily low without it). Real GSC winners rise
 * to the top 25% naturally once the service account is connected.
 */
function prioritize(keywords) {
  const scored = (keywords || [])
    .map((k) => {
      const signals = {
        autocompleteDepth: k.autocompleteDepth || 0,
        gscImpressions: k.gscImpressions || 0,
        gscPosition: k.gscPosition || 0,
        trendsRising: !!k.rising,
        businessFit: businessFitFor(k.cluster || 'general'),
        question: k.intent === 'question' || /\?\s*$/.test(k.keyword || ''),
      };
      return { ...k, score: scoreKeyword(signals) };
    })
    .sort((a, b) => b.score - a.score);
  const n = scored.length;
  return scored.map((k, i) => {
    const pct = n > 1 ? i / (n - 1) : 0; // 0 = top-ranked
    return { ...k, priority: pct <= 0.25 ? 'High' : pct <= 0.75 ? 'Med' : 'Low' };
  });
}

function buildAnalysisPrompt({ keywords = [], striking = [], geoPrompts = [] }) {
  const sample = keywords.slice(0, 180)
    .map((k) => `${k.priority}\t${k.lang}\t${k.audience || '?'}\t${k.cluster || '?'}\t${k.keyword}`).join('\n');
  const sd = striking.slice(0, 30).map((r) => `${r.keyword} (pos ${Number(r.position).toFixed(1)}, ${r.impressions} impr)`).join('\n');
  const gp = geoPrompts.map((p) => `- [${p.audience}] ${p.prompt}`).join('\n');
  return [
    'You are an SEO+GEO strategist for ManicBot — an AI booking assistant (Telegram/Instagram/WhatsApp/web) for nail & beauty salons in Poland. 0% commission, from 45 PLN/mo, languages pl/ru/ua/en. TWO audiences: B2C (salon clients booking a service) and B2B (salon owners buying software) — never mix them on one page.',
    'Given the collected keywords (priority\\tlang\\taudience\\tcluster\\tkeyword), the GSC striking-distance queries, and the GEO prompts, return STRICT JSON only:',
    '{ "clusters": [ {"name","audience","intent","keywords":[..],"target_page","suggested_title","suggested_meta"} ], "geo": { "faq": [ {"q","a"} ], "citable_facts": [".."], "llms_txt_additions": [".."], "schema_recommendations": [".."] }, "quick_wins": [".."], "new_pages": [".."] }',
    'LANGUAGE — the report is read by a Russian-speaking founder, so write all STRATEGY in RUSSIAN: cluster "name" must be a short human-readable Russian label (e.g. "B2B · Система записи / альтернатива Booksy") and NEVER a machine slug like "b2b-pl-system-rezerwacji"; "quick_wins" and "new_pages" in Russian. Keep SITE-READY copy in its target language: "suggested_title", "suggested_meta", every "faq" {q,a}, "citable_facts" and "llms_txt_additions" in POLISH (or the cluster\'s own language for the RU/UA/EN clusters). In "schema_recommendations" write the explanation in Russian but keep JSON-LD type/property names in English.',
    'Be concrete and Poland-specific. Map clusters to real routes: /, /salons/{city}, /salons/warszawa/{district}, /salon/{slug}, /comparisons/manicbot-vs-booksy, /blog. Keep FAQ answers extractable (front-load the answer in the first sentence). Differentiator over Booksy/competitors is conversational AI inside the client\'s messenger, not just 0% commission (every competitor claims that).',
    '\n## KEYWORDS\n' + sample,
    '\n## GSC STRIKING DISTANCE\n' + (sd || '(none — GSC off)'),
    '\n## GEO PROMPTS\n' + gp,
  ].join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cluster + GEO plan via Claude, with retries. A long high-effort call can fail
 * transiently (a ~7min request hitting a network blip); `effort:'medium'` keeps
 * the call shorter/sturdier and we retry once before degrading. Returns null
 * only after all attempts fail — the caller then uses heuristicClusters().
 */
async function analyzeWithClaude(input, { ask = askClaude, timeoutMs = 10 * 60 * 1000, attempts = 2, logger } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const out = await ask(buildAnalysisPrompt(input), { json: true, model: 'sonnet', effort: 'medium', timeoutMs });
      if (out?.json) return out.json;
      logger?.log?.(`Claude analysis attempt ${i}/${attempts}: no JSON extracted`);
    } catch (e) {
      logger?.log?.(`Claude analysis attempt ${i}/${attempts} failed: ${e.message}`);
    }
    if (i < attempts) await sleep(4000);
  }
  logger?.log?.('Claude analysis degraded to heuristic clusters after retries');
  return null;
}

// Readable RU labels + a sensible target page per cluster, so the heuristic
// fallback report is presentable (not a slug dump) when Claude is unavailable.
const CLUSTER_LABEL = {
  booking: 'Запись / онлайн-бронирование', 'b2b-software': 'B2B · софт для салона',
  competitor: 'B2B · альтернатива Booksy', price: 'Цены услуг', service: 'Услуги (салон/город)',
  gsc: 'Из Search Console', general: 'Прочее',
};
const CLUSTER_PAGE = {
  booking: '/salon/{slug}/chat', 'b2b-software': '/', competitor: '/comparisons/manicbot-vs-booksy',
  price: '/blog', service: '/salons/{city}', gsc: '—', general: '—',
};

/** Deterministic fallback when Claude is unavailable: readable groups by audience+cluster. */
function heuristicClusters(keywords) {
  const map = new Map();
  for (const k of keywords || []) {
    const cl = k.cluster || 'general';
    const key = `${k.audience || '?'}/${cl}`;
    if (!map.has(key)) {
      map.set(key, {
        name: `${CLUSTER_LABEL[cl] || cl}`,
        audience: k.audience, intent: cl,
        target_page: CLUSTER_PAGE[cl] || '—',
        keywords: [],
      });
    }
    map.get(key).keywords.push(k.keyword);
  }
  return {
    clusters: Array.from(map.values()).sort((a, b) => b.keywords.length - a.keywords.length),
    geo: null, quick_wins: [], new_pages: [],
  };
}

module.exports = { scoreKeyword, prioritize, buildAnalysisPrompt, analyzeWithClaude, heuristicClusters };
