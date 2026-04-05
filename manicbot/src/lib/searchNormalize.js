/**
 * Search normalization utilities for Cloudflare Workers (no external imports).
 * Used to build multi-variant search text at index time and normalize query strings.
 */

/** Polish diacritic → ASCII mapping. */
const DEACCENT_MAP = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
  'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N',
  'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
};

/**
 * Remove Polish diacritics from text.
 * "Kraków" → "Krakow", "Łódź" → "Lodz"
 */
export function deaccent(text) {
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => DEACCENT_MAP[ch] ?? ch);
}

/**
 * Latin (Polish) → Cyrillic bigram-first transliteration table.
 * Bigrams must appear before their component chars to ensure longest-match-first.
 * "Warszawa" → "варшава", "Kraków" → "краков"
 */
const LATIN_TO_CYR = [
  // Bigrams first
  ['sz', 'ш'], ['cz', 'ч'], ['rz', 'р'], ['ch', 'х'],
  ['dż', 'дж'], ['dź', 'дз'], ['dz', 'дз'],
  // Single chars with Polish diacritics
  ['ą', 'а'], ['ć', 'ч'], ['ę', 'э'], ['ł', 'л'],
  ['ń', 'н'], ['ó', 'о'], ['ś', 'ш'], ['ź', 'з'], ['ż', 'ж'],
  // Standard Latin
  ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['d', 'д'], ['e', 'е'],
  ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'й'],
  ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'],
  ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'],
  ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'и'],
  ['z', 'з'],
];

/**
 * Transliterate a Latin (Polish) string to Cyrillic phonetic equivalent.
 * Pass lowercased text for best results.
 */
export function polishToCyrillic(text) {
  const lower = text.toLowerCase();
  let result = '';
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const [lat, cyr] of LATIN_TO_CYR) {
      if (lower.startsWith(lat, i)) {
        result += cyr;
        i += lat.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += lower[i];
      i++;
    }
  }
  return result;
}

/**
 * Returns true if text contains at least one Cyrillic character.
 */
export function hasCyrillic(text) {
  return /[\u0400-\u04FF]/.test(text);
}

/**
 * Cyrillic → Latin (BGN/PCGN approximation).
 * Used on the query side so Cyrillic user input can match transliterated index content.
 * "варшава" → "varshava"
 */
const CYR_TO_LATIN = [
  // Digraphs first
  ['ж', 'zh'], ['х', 'kh'], ['ц', 'ts'], ['ч', 'ch'],
  ['ш', 'sh'], ['щ', 'shch'], ['ю', 'yu'], ['я', 'ya'],
  ['є', 'ye'], ['ї', 'yi'],
  // Single chars
  ['а', 'a'],  ['б', 'b'],  ['в', 'v'],  ['г', 'g'],  ['д', 'd'],
  ['е', 'e'],  ['ё', 'yo'], ['з', 'z'],  ['и', 'i'],  ['й', 'y'],
  ['к', 'k'],  ['л', 'l'],  ['м', 'm'],  ['н', 'n'],  ['о', 'o'],
  ['п', 'p'],  ['р', 'r'],  ['с', 's'],  ['т', 't'],  ['у', 'u'],
  ['ф', 'f'],  ['ы', 'y'],  ['э', 'e'],  ['і', 'i'],  ['ґ', 'g'],
  ['ъ', ''],   ['ь', ''],
];

export function cyrillicToLatin(text) {
  const lower = text.toLowerCase();
  let result = '';
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const [cyr, lat] of CYR_TO_LATIN) {
      if (lower.startsWith(cyr, i)) {
        result += lat;
        i += cyr.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += lower[i];
      i++;
    }
  }
  return result;
}

/**
 * Build all search index variants for a single Latin text token.
 * Returns [original_lower, deaccented_lower, cyrillic_lower].
 * Only call this for Latin text — Cyrillic tokens should be lowercased directly.
 */
export function buildSearchVariants(text) {
  const lower = text.toLowerCase();
  const deaccentedLower = deaccent(lower);
  const cyrillicLower = polishToCyrillic(deaccentedLower);
  return [lower, deaccentedLower, cyrillicLower];
}
