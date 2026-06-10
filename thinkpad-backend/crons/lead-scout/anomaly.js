'use strict';
/**
 * Crawl anomaly detection for booksy-full.
 *
 * Booksy's JSON-LD can silently change shape — the crawl then "succeeds"
 * with ~0 listings and nobody notices the lead pipeline died. This verdict
 * turns that silence into an explicit Telegram alert.
 */
const MIN_PAGES_FOR_YIELD_CHECK = 10;
const MIN_SCRAPED_PER_PAGE = 5; // normal pages carry ~20 listings

function crawlVerdict({ pagesRun, totalScraped, reachedCap }) {
  const reasons = [];
  const warnings = [];

  if (pagesRun >= MIN_PAGES_FOR_YIELD_CHECK && totalScraped < pagesRun * MIN_SCRAPED_PER_PAGE) {
    reasons.push(
      `yield collapsed: ${totalScraped} listings over ${pagesRun} pages — Booksy JSON-LD format likely changed`,
    );
  }
  if (reachedCap) {
    warnings.push('MAX_PAGES cap reached before the catalog ended — consider raising the cap');
  }

  return { anomaly: reasons.length > 0, reasons, warnings };
}

module.exports = { crawlVerdict, MIN_PAGES_FOR_YIELD_CHECK, MIN_SCRAPED_PER_PAGE };
