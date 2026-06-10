/**
 * google-maps.js — Playwright headless scraper for Google Maps.
 *
 * Searches for nail/beauty salons in a Warsaw district, extracts up to MAX_RESULTS
 * business cards. Low-and-slow: random delays, real user-agent, accepts cookies.
 *
 * Returns: Array<Lead> (may be empty on error or bot-detection)
 *
 * MAINTENANCE NOTE: Google Maps A/B tests new CSS classes constantly.
 * If this returns 0 results, open https://maps.google.com in a browser,
 * run the same search, inspect the DOM and update the selectors below.
 */

const MAX_RESULTS = 15;       // Don't be greedy — stay under radar
const SCROLL_TIMES = 4;       // How many times to scroll the results panel
const CLICK_DELAY_MIN = 1800; // ms
const CLICK_DELAY_MAX = 3500; // ms

// Realistic Chrome User-Agents (rotate per run)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function randomDelay(min, max) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function scrape(query, district) {
  let browser = null;
  const leads = [];

  try {
    const { chromium } = require('playwright');

    // Prefer the Playwright-bundled Chromium; fall back to system Chrome if not installed.
    // Playwright's bundled browser may not be available on Ubuntu 26.04 (not yet supported).
    const systemChromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    const fs = require('fs');
    let executablePath;
    try {
      const bundledPath = chromium.executablePath();
      executablePath = fs.existsSync(bundledPath) ? bundledPath : null;
    } catch { executablePath = null; }
    if (!executablePath) {
      executablePath = systemChromePaths.find(p => { try { return fs.existsSync(p); } catch { return false; } });
    }
    if (!executablePath) throw new Error('No Chromium/Chrome binary found. Install google-chrome or run: npx playwright install chromium');

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });

    const context = await browser.newContext({
      userAgent: pickUserAgent(),
      viewport: { width: 1280, height: 800 },
      locale: 'pl-PL',
      timezoneId: 'Europe/Warsaw',
    });

    const page = await context.newPage();

    // Remove webdriver fingerprint
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=pl`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Accept cookies if shown
    try {
      const acceptBtn = page.locator('button[aria-label*="Accept"], button[jsname="b3VHJd"], form[action*="consent"] button').first();
      if (await acceptBtn.isVisible({ timeout: 4000 })) {
        await acceptBtn.click();
        await randomDelay(1000, 2000);
      }
    } catch { /* no consent dialog */ }

    // Wait for results feed
    // Google Maps results: feed container or individual result items
    const feedSelector = '[role="feed"], div.m6QErb[aria-label]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 12000 });
    } catch {
      return leads; // no results loaded (possible bot-detection or no results)
    }

    // Scroll the results panel to load more
    for (let i = 0; i < SCROLL_TIMES; i++) {
      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) feed.scrollBy(0, 600);
      });
      await randomDelay(1200, 2500);
    }

    // Collect result cards
    // Primary selector: .Nv2PK (current as of 2026)
    // Fallback: any div with role="article" inside the feed
    const cardHandles = await page.$$('.Nv2PK, [role="feed"] [role="article"]');
    const cards = cardHandles.slice(0, MAX_RESULTS);

    for (let i = 0; i < cards.length; i++) {
      try {
        // Re-fetch card by index (DOM can change after clicks)
        const freshCards = await page.$$('.Nv2PK, [role="feed"] [role="article"]');
        const card = freshCards[i];
        if (!card) break;

        await card.click();
        await randomDelay(CLICK_DELAY_MIN, CLICK_DELAY_MAX);

        // Wait for the place detail panel h1 to appear.
        // Google Maps always has an h1 "Wyniki" (Results) in the search context;
        // the PLACE name is in h1.DUwDvf or a data-attrid title element.
        await page.waitForSelector('h1.DUwDvf, [data-attrid="title"] .PZPZlf, h1', { timeout: 10000 });
        // Extra wait to ensure the detail panel fully renders (not just the first h1)
        await randomDelay(800, 1200);

        const lead = await page.evaluate(() => {
          const getText = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
          const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) ?? null;

          // Name — prefer the place-specific h1 (class DUwDvf is Google's current place title)
          // over the generic h1 (which can be "Wyniki" = the search results header)
          const name =
            getText('h1.DUwDvf') ||
            getText('[data-attrid="title"] .PZPZlf') ||
            getText('[aria-label][role="main"] h1') ||
            (() => {
              // Last resort: any h1 that isn't the results header
              const all = [...document.querySelectorAll('h1')];
              const clean = all.find(el => el.textContent.trim() && el.textContent.trim() !== 'Wyniki');
              return clean ? clean.textContent.trim() : null;
            })();

          // Phone — look for tel: link or tooltip
          const phoneLink = document.querySelector('a[href^="tel:"]');
          const phone = phoneLink
            ? phoneLink.href.replace('tel:', '').trim()
            : (() => {
                // fallback: find button with phone-like tooltip
                const btns = [...document.querySelectorAll('button[aria-label]')];
                const btn = btns.find(b => /^\+?[\d\s\-\(\)]{9,}$/.test(b.getAttribute('aria-label')));
                return btn ? btn.getAttribute('aria-label').trim() : null;
              })();

          // Website
          const websiteLink = document.querySelector('a[data-value="Witryna"], a[data-item-id="authority"], a[aria-label*="Witryna"], a[aria-label*="website"]');
          const website = websiteLink ? websiteLink.href : null;

          // Address — look for button with aria-label containing address pattern
          const addrBtn = document.querySelector('button[data-item-id="address"], [data-tooltip*="adres"], button[aria-label*=","]');
          const address = addrBtn ? (addrBtn.textContent || addrBtn.getAttribute('aria-label') || '').trim() : null;

          // Rating
          const ratingEl = document.querySelector('span.MW4etd, div.F7nice span[aria-hidden="true"]');
          const rating = ratingEl ? ratingEl.textContent.trim() : null;

          // Reviews count
          const reviewsEl = document.querySelector('span.UY7F9, button[jsaction*="reviewChart"]');
          const reviews_count = reviewsEl
            ? reviewsEl.textContent.replace(/[^\d]/g, '') || null
            : null;

          // Maps URL
          const maps_url = window.location.href;

          return { name, phone, website, address, rating, reviews_count, maps_url };
        });

        if (lead.name) {
          leads.push({
            source: 'google_maps',
            district,
            ...lead,
          });
        }

        // Go back to results list
        await page.goBack({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
        await randomDelay(1000, 2000);

      } catch (cardErr) {
        // Per-card error — skip and continue
        try { await page.goBack({ timeout: 8000 }).catch(() => {}); } catch {}
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return leads;
}

module.exports = { scrape };
