'use strict';
/**
 * dedup.js — pure dedup-key logic for lead-scout.
 *
 * Single source of truth for "are these two leads the same business", shared by
 * storage.js (live append during scraping) and the one-off base cleaner. Two
 * leads collide if they share ANY strong identity key:
 *
 *   - phone      → last 9 PL digits
 *   - any url    → host + path (website / booksy / maps / olx), www-stripped
 *   - instagram  → @handle, lowercased
 *
 * WHY name+district is NOT a strong key: generic salon names ("Beauty Studio",
 * "Studio Paznokci") would false-merge distinct businesses. Fuzzy name matching
 * is left to the offline quality audit, which can reason case-by-case.
 *
 * WHY this module exists: the legacy storage.js keyed only on
 * phone/booksy_url/maps_url, so two rows for the same salon that had only a
 * website or instagram (no phone) were never deduped. The website/instagram
 * keys here close that gap, and sharing the logic with the cleaner keeps the
 * live path and the offline path from drifting.
 */

/** Last 9 Polish digits, or null if too short to be a real number. */
function normalizePhone(p) {
  if (!p) return null;
  const digits = String(p)
    .replace(/[\s\-\(\)\.\+]/g, '')
    .replace(/^48/, '')
    .replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/** host+path, lowercased, leading www and trailing slashes stripped. */
function normalizeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(String(u).trim());
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return (host + path) || null;
  } catch {
    return null;
  }
}

/** Instagram handle, lowercased — from a full URL or a bare @handle. */
function normalizeInstagram(u) {
  if (!u) return null;
  const s = String(u).trim();
  const fromUrl = s.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
  if (fromUrl) {
    const handle = fromUrl[1].toLowerCase().replace(/\/$/, '');
    // Skip non-profile paths that aren't a business handle.
    return handle && !['p', 'explore', 'reel', 'reels', 'stories'].includes(handle) ? handle : null;
  }
  const bare = s.match(/^@?([a-zA-Z0-9_.]+)$/);
  return bare ? bare[1].toLowerCase() : null;
}

const URL_FIELDS = ['website', 'booksy_url', 'maps_url', 'olx_url'];

/** All strong dedup keys for a lead (prefixed by kind to avoid cross-collisions). */
function leadKeys(lead) {
  const keys = [];
  const ph = normalizePhone(lead.phone);
  if (ph) keys.push('ph:' + ph);
  for (const f of URL_FIELDS) {
    const n = normalizeUrl(lead[f]);
    if (n) keys.push('url:' + n);
  }
  const ig = normalizeInstagram(lead.instagram_url);
  if (ig) keys.push('ig:' + ig);
  return keys;
}

/** Stateful deduper: build from existing rows, then test/insert new leads. */
function createDeduper() {
  const seen = new Set();
  return {
    isDuplicate(lead) { return leadKeys(lead).some((k) => seen.has(k)); },
    add(lead) { for (const k of leadKeys(lead)) seen.add(k); },
    size() { return seen.size; },
  };
}

module.exports = {
  normalizePhone,
  normalizeUrl,
  normalizeInstagram,
  leadKeys,
  createDeduper,
  URL_FIELDS,
};
