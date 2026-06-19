'use strict';
/**
 * taxonomy.js — the SEED keyword universe for the SEO/GEO research cron.
 *
 * These are STARTING points, not the final list: the autocomplete collector
 * expands every seed into the real long-tail Google shows for it. Seeds are
 * tagged with audience (B2C client vs B2B owner), cluster and language so the
 * whole pipeline keeps the two funnels apart — a salon CLIENT searching to book
 * vs a salon OWNER searching for software is never the same page.
 *
 * Grounded in the 2026-06-19 inaugural research: Warsaw-district demand,
 * satellite cities, RU/UA diaspora, B2B long-tail, Booksy as the anchor.
 */

// Google Autocomplete/Trends use 'uk' for Ukrainian; the project tags it 'ua'.
const HL_BY_LANG = { pl: 'pl', ru: 'ru', ua: 'uk', en: 'en' };
function hlForLang(lang) { return HL_BY_LANG[lang] || 'pl'; }
function langForHl(hl) { return Object.keys(HL_BY_LANG).find((l) => HL_BY_LANG[l] === hl) || 'pl'; }

// Useful for expanding combos / city pages downstream (kept in sync with the
// inaugural report findings, not with popularCities.js which is intentionally 3).
const SERVICES_PL = ['manicure hybrydowy', 'paznokcie żelowe', 'pedicure', 'paznokcie french', 'manicure japoński', 'przedłużanie paznokci'];
const CITIES_PL = ['warszawa', 'gdańsk', 'wrocław', 'kraków', 'łódź', 'poznań'];
const WARSAW_DISTRICTS = ['mokotów', 'wola', 'bielany', 'bemowo', 'centrum', 'ochota', 'ursus', 'włochy', 'wawer', 'praga'];

// B2C seeds — clients looking to book.
const B2C_SEEDS_PL = [
  'paznokcie warszawa', 'salon paznokci', 'manicure hybrydowy', 'manicure cena',
  'pedicure warszawa', 'paznokcie żelowe', 'paznokcie', 'rezerwacja online paznokcie',
];
// B2B seeds — owners looking for software (the side that pays us).
const B2B_SEEDS_PL = [
  'system rezerwacji dla salonu', 'program do obsługi salonu kosmetycznego',
  'aplikacja do umawiania wizyt', 'bot do rezerwacji', 'kalendarz online dla salonu',
  'booksy alternatywa', 'asystent ai dla salonu', 'program dla salonu bez prowizji',
];
// RU/UA diaspora in Poland — searches in their own language for Warsaw services.
const DIASPORA_SEEDS = [
  { seed: 'маникюр варшава', lang: 'ru' }, { seed: 'запись на маникюр онлайн', lang: 'ru' },
  { seed: 'ногти варшава', lang: 'ru' },
  { seed: 'манікюр варшава', lang: 'ua' }, { seed: 'запис на манікюр', lang: 'ua' },
];
const EN_SEEDS = ['nail salon booking system', 'salon booking software'];

// Real prompts people type into ChatGPT/Perplexity — fuel for the GEO section,
// NOT for autocomplete. These are where ManicBot wants to be the cited answer.
const GEO_PROMPTS = [
  { prompt: 'jaki jest najlepszy system rezerwacji dla salonu paznokci w Polsce?', audience: 'B2B' },
  { prompt: 'alternatywa dla Booksy bez prowizji', audience: 'B2B' },
  { prompt: 'jak przyjmować rezerwacje przez Instagram i WhatsApp w salonie?', audience: 'B2B' },
  { prompt: 'bot do umawiania wizyt dla salonu beauty', audience: 'B2B' },
  { prompt: 'ile kosztuje system rezerwacji dla małego salonu?', audience: 'B2B' },
  { prompt: 'jak zmniejszyć liczbę no-show w salonie?', audience: 'B2B' },
  { prompt: 'gdzie zrobić paznokcie w Warszawie?', audience: 'B2C' },
  { prompt: 'ile kosztuje manicure hybrydowy w Warszawie?', audience: 'B2C' },
];

/** Coarse cluster from the seed/keyword text — drives businessFit + grouping. */
function clusterFor(text) {
  const s = String(text || '').toLowerCase();
  if (/booksy|alternatyw|bez prowizji/.test(s)) return 'competitor';
  if (/system|program|aplikacja|\bbot\b|kalendarz|asystent|software|booking system/.test(s)) return 'b2b-software';
  if (/rezerwacj|online|zapis|запись|запис|booking|umów|umaw/.test(s)) return 'booking';
  if (/cena|cennik|cost|price/.test(s)) return 'price';
  if (/paznokcie|manicure|pedicure|маникюр|манікюр|ногти|nail/.test(s)) return 'service';
  return 'general';
}
/** Product fit weight 1..3 per cluster (booking + b2b-software are what we sell). */
function businessFitFor(cluster) {
  return { booking: 3, 'b2b-software': 3, competitor: 2, price: 2, service: 1, general: 1 }[cluster] ?? 1;
}

/** Tagged seed list the autocomplete collector expands. */
function buildSeeds() {
  const seeds = [];
  const push = (seed, lang, audience) => seeds.push({ seed, lang, audience, cluster: clusterFor(seed) });
  for (const s of B2C_SEEDS_PL) push(s, 'pl', 'B2C');
  for (const s of B2B_SEEDS_PL) push(s, 'pl', 'B2B');
  for (const d of DIASPORA_SEEDS) push(d.seed, d.lang, 'B2C');
  for (const s of EN_SEEDS) push(s, 'en', 'B2B');
  for (const c of ['gdańsk', 'wrocław']) push(`paznokcie ${c}`, 'pl', 'B2C'); // autocomplete surfaces the rest
  return seeds;
}

module.exports = {
  hlForLang, langForHl, clusterFor, businessFitFor, buildSeeds,
  SERVICES_PL, CITIES_PL, WARSAW_DISTRICTS,
  B2C_SEEDS_PL, B2B_SEEDS_PL, DIASPORA_SEEDS, EN_SEEDS, GEO_PROMPTS,
};
