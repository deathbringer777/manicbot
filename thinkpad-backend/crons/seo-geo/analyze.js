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
function bucket(score) { return score >= 45 ? 'High' : score >= 25 ? 'Med' : 'Low'; }

/** Attach score+priority to every keyword from its signals, sorted high→low. */
function prioritize(keywords) {
  return (keywords || [])
    .map((k) => {
      const signals = {
        autocompleteDepth: k.autocompleteDepth || 0,
        gscImpressions: k.gscImpressions || 0,
        gscPosition: k.gscPosition || 0,
        trendsRising: !!k.rising,
        businessFit: businessFitFor(k.cluster || 'general'),
        question: k.intent === 'question' || /\?\s*$/.test(k.keyword || ''),
      };
      const score = scoreKeyword(signals);
      return { ...k, score, priority: bucket(score) };
    })
    .sort((a, b) => b.score - a.score);
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
    'Be concrete and Poland-specific. Map clusters to real routes: /, /salons/{city}, /salons/warszawa/{district}, /salon/{slug}, /comparisons/manicbot-vs-booksy, /blog. Keep FAQ answers extractable (front-load the answer in the first sentence). Differentiator over Booksy/competitors is conversational AI inside the client\'s messenger, not just 0% commission (every competitor claims that).',
    '\n## KEYWORDS\n' + sample,
    '\n## GSC STRIKING DISTANCE\n' + (sd || '(none — GSC off)'),
    '\n## GEO PROMPTS\n' + gp,
  ].join('\n');
}

async function analyzeWithClaude(input, { ask = askClaude, timeoutMs = 12 * 60 * 1000, logger } = {}) {
  try {
    const out = await ask(buildAnalysisPrompt(input), { json: true, model: 'sonnet', effort: 'high', timeoutMs });
    return out?.json || null;
  } catch (e) {
    logger?.log?.(`Claude analysis degraded to heuristic clusters: ${e.message}`);
    return null;
  }
}

/** Deterministic fallback when Claude is unavailable: group by audience+cluster. */
function heuristicClusters(keywords) {
  const map = new Map();
  for (const k of keywords || []) {
    const key = `${k.audience || '?'} · ${k.cluster || 'general'}`;
    if (!map.has(key)) map.set(key, { name: key, audience: k.audience, intent: k.cluster, keywords: [] });
    map.get(key).keywords.push(k.keyword);
  }
  return { clusters: Array.from(map.values()), geo: null, quick_wins: [], new_pages: [] };
}

module.exports = { scoreKeyword, bucket, prioritize, buildAnalysisPrompt, analyzeWithClaude, heuristicClusters };
