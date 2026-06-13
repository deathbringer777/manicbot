#!/usr/bin/env node
/**
 * preset-generator — generate the seasonal message preset library with Claude
 * Code (Sonnet, via the founder's subscription — `claude -p`, NO API key) and
 * push each as a DRAFT, per-locale template through the Worker seam.
 *
 * For every curated occasion × 4 locales (RU/UA/EN/PL) it asks Claude for a warm,
 * on-brand salon-owner greeting (optionally an offer), grounded ONLY in the
 * approved-facts docs (_shared/PRODUCT.md + BRAND.md). Output is strict JSON so
 * nothing free-form reaches the database. Drafts are inert until approved.
 *
 * Copy structure: each body is 2–3 short, scannable paragraphs separated by a
 * blank line (`\n\n`) — greeting / value / call-to-action — so the
 * `whitespace-pre-wrap` announcement renderer shows paragraphs, not a wall of
 * text. The prompt asks the model for this; `normalizeBody` tidies the result
 * and `reflowToParagraphs` is a fallback if the model returns a single block.
 *
 * Idempotency: template-draft upserts by (template_key, locale), so re-running
 * refreshes copy in place rather than duplicating. Safe to run weekly/on-demand.
 *
 * Run: node preset-generator.js [occasion_key ...]   (no args = all occasions)
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { api } from './lib/api.js';
import { normalizeBody, reflowToParagraphs } from './lib/format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = process.env.MESSAGING_SHARED_DIR || join(__dirname, '_shared');
const LOCALES = ['ru', 'ua', 'en', 'pl'];
const LOCALE_NAME = { ru: 'Russian', ua: 'Ukrainian', en: 'English', pl: 'Polish' };

function readFacts() {
  const product = existsSync(join(SHARED_DIR, 'PRODUCT.md')) ? readFileSync(join(SHARED_DIR, 'PRODUCT.md'), 'utf8') : '';
  const brand = existsSync(join(SHARED_DIR, 'BRAND.md')) ? readFileSync(join(SHARED_DIR, 'BRAND.md'), 'utf8') : '';
  return { product, brand };
}

/** Build the strict-JSON prompt for one occasion+locale. Pure (exported for tests). */
export function buildPrompt(occasion, locale, facts) {
  return [
    'You write short in-app messages from the ManicBot platform to SALON OWNERS (B2B).',
    'Audience: nail/beauty salon owners in Poland. Channel: the in-app "News & Announcements" center.',
    '',
    'STRICT RULES:',
    '- Use ONLY facts from the PRODUCT and BRAND docs below. Never invent features, prices, or promises.',
    '- Warm, professional, no corporate fluff. 2–4 sentences total. One emoji max.',
    `- Write in ${LOCALE_NAME[locale]}.`,
    '- Structure the message as 2–3 short, scannable paragraphs: a warm greeting, the value/news,',
    '  then a short call-to-action. Separate paragraphs with a blank line — in the JSON string put a',
    '  literal \\n\\n between them (e.g. "Hi {salon_name}!\\n\\n…\\n\\n…"). No single wall of text.',
    '- You MAY use the placeholder {salon_name} (it is substituted at delivery). Use no other placeholders.',
    '- Output STRICT JSON only: {"center":"<message>"}. No markdown, no commentary.',
    '',
    `OCCASION: ${occasion.name_en} (${occasion.occasion_key}), a ${occasion.type} date for a beauty salon.`,
    '',
    '=== PRODUCT.md ===', facts.product.slice(0, 4000),
    '=== BRAND.md ===', facts.brand.slice(0, 4000),
  ].join('\n');
}

/** Default runner: spawn the Claude CLI (no shell — argv array, prompt is one element). */
function runClaudeCli(prompt) {
  return execFileSync('claude', ['-p', '--model', 'sonnet', prompt], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
  });
}

/**
 * One Claude Code call → strict JSON {center} for one occasion+locale.
 * The runner is injectable so tests never spawn the CLI or hit the network.
 * Output is normalized; if the model returned a single block it is reflowed into
 * paragraphs so structure is guaranteed regardless of model compliance.
 */
export function generateOne(occasion, locale, facts, { runClaude = runClaudeCli } = {}) {
  const prompt = buildPrompt(occasion, locale, facts);

  let out;
  try {
    out = runClaude(prompt);
  } catch (e) {
    return { ok: false, error: e?.message?.slice(0, 120) || 'claude_failed' };
  }
  // Extract the first {...} JSON object from the model output.
  const match = typeof out === 'string' ? out.match(/\{[\s\S]*\}/) : null;
  if (!match) return { ok: false, error: 'no_json' };
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.center !== 'string' || parsed.center.length < 5) return { ok: false, error: 'empty_center' };
    let center = normalizeBody(parsed.center);
    if (!/\n\n/.test(center)) center = reflowToParagraphs(center);
    if (center.length < 5) return { ok: false, error: 'empty_center' };
    return { ok: true, center };
  } catch {
    return { ok: false, error: 'bad_json' };
  }
}

async function main() {
  const facts = readFacts();
  if (!facts.product || !facts.brand) {
    console.error(`[preset-gen] approved-facts missing in ${SHARED_DIR} — scp PRODUCT.md + BRAND.md there first`);
    process.exitCode = 1;
    return;
  }
  const { occasions } = JSON.parse(readFileSync(join(__dirname, 'commercial-dates.json'), 'utf8'));
  const wanted = process.argv.slice(2);
  const targets = wanted.length ? occasions.filter((o) => wanted.includes(o.occasion_key)) : occasions;

  const stamp = new Date().toISOString();
  let pushed = 0, failed = 0;
  for (const occ of targets) {
    for (const locale of LOCALES) {
      const gen = generateOne(occ, locale, facts);
      if (!gen.ok) { failed += 1; console.error(`[preset-gen] ${occ.occasion_key}/${locale} ${gen.error}`); continue; }
      const res = await api.templateDraft({
        template_key: `seasonal_${occ.occasion_key}`,
        locale,
        name: `${occ.name_en} (${locale})`,
        category: 'seasonal',
        channels: ['center', 'bell'],
        bodies: { center: gen.center, bell: gen.center },
        variables: ['salon_name'],
      });
      if (res.ok) pushed += 1;
      else { failed += 1; console.error(`[preset-gen] push ${occ.occasion_key}/${locale} ${res.error}`); }
    }
  }
  console.log(`[preset-gen] ${stamp} occasions=${targets.length} pushed=${pushed} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

// Only auto-run when executed directly (`node preset-generator.js`), so importing
// this module in tests does not spawn the Claude CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
