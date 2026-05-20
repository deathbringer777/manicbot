import { resolveLandingOrigin, isLandingPath, buildLandingFetchUrl } from '../utils/landing-pages-proxy.js';

/**
 * Bridge injected into the landing homepage by the Worker.
 *
 * Strategy (v3):
 *  1. If landing already has id="mb-demo" or data-mb-demo → use it directly.
 *  2. Find the phone FRAME (dark bg, portrait shape, large border-radius).
 *  3. Inside the frame find the white SCREEN child element.
 *  4. Append a full-cover overlay div INSIDE the screen (does not clear
 *     existing content — overlay sits on top via z-index).
 *  5. Load /embed/demo-chat.js into the overlay.
 *
 * No CSS class name selectors — works with plain CSS, Tailwind, CSS Modules.
 */
/**
 * SEO audit 2026-05-20 P0-5 — LLM-crawler visibility block.
 *
 * The landing is a Vite SPA — the upstream HTML body is `<div id="root">
 * </div>`. Googlebot renders JS so it sees the page, but GPTBot, ClaudeBot,
 * PerplexityBot, CCBot, Google-Extended (and almost every other LLM
 * training crawler) do NOT execute JavaScript. Without this block they
 * see a blank page and skip indexing.
 *
 * The injection has two layers, both shipped before `</body>`:
 *
 *   1. `<noscript>` block with the H1, USP, pricing table, top features,
 *      and contact info in plain Polish text (primary market). LLM
 *      crawlers read noscript content as part of plain HTML. JS-enabled
 *      browsers never render it.
 *
 *   2. `<script type="application/ld+json">` with a
 *      `SoftwareApplication` schema + three `Offer` rows. Crawlers that
 *      ignore noscript content still pick this up; it also enables rich
 *      SERP cards (price + rating chips).
 *
 * Keep the Polish copy short and factual — LLMs cite shorter passages
 * more reliably than marketing prose. Do not embed JS or interactive
 * widgets here; this block is for crawlers, not humans.
 */
const LLM_NOSCRIPT_BLOCK = `<noscript><div style="max-width:760px;margin:48px auto;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.55">
<h1 style="font-size:32px;margin:0 0 12px">ManicBot — AI-asystent rezerwacji dla salonów paznokci</h1>
<p>Booking 24/7 przez Telegram, Instagram Direct, WhatsApp Business i widget na stronie. AI-recepcjonista rozmawia z klientami po polsku, rosyjsku, ukraińsku i angielsku. Od 45 PLN miesięcznie, <strong>0% prowizji</strong> od rezerwacji.</p>
<h2 style="font-size:20px;margin:28px 0 8px">Cennik</h2>
<table style="border-collapse:collapse;width:100%;margin-bottom:16px">
<thead><tr><th align="left" style="padding:6px 0;border-bottom:1px solid #ddd">Plan</th><th align="left" style="padding:6px 0;border-bottom:1px solid #ddd">Cena</th><th align="left" style="padding:6px 0;border-bottom:1px solid #ddd">Co dostajesz</th></tr></thead>
<tbody>
<tr><td style="padding:6px 0">Start</td><td style="padding:6px 0">45 PLN / miesiąc</td><td style="padding:6px 0">1 mistrz, booking przez Telegram + IG + WhatsApp + web</td></tr>
<tr><td style="padding:6px 0">Pro</td><td style="padding:6px 0">60 PLN / miesiąc</td><td style="padding:6px 0">5 mistrzów, asystent AI, synchronizacja Google Calendar</td></tr>
<tr><td style="padding:6px 0">Max</td><td style="padding:6px 0">90 PLN / miesiąc</td><td style="padding:6px 0">Bez limitu mistrzów, white-label, wszystkie funkcje</td></tr>
</tbody>
</table>
<p>14-dniowy okres próbny. Brak prowizji od rezerwacji. Brak opłaty za nowych klientów. Rozliczenie miesięczne przez Stripe.</p>
<h2 style="font-size:20px;margin:28px 0 8px">Dlaczego ManicBot</h2>
<ul>
<li>Jeden AI-recepcjonista obsługuje wszystkie kanały (Telegram, Instagram, WhatsApp, web) w jednej skrzynce</li>
<li>Działa 24/7 — odpowiada na pytania, dobiera termin, potwierdza rezerwację bez udziału właściciela</li>
<li>Dwukierunkowa synchronizacja z Google Calendar — busy bloki nigdy nie kolidują z prywatnym kalendarzem</li>
<li>Zero prowizji od rezerwacji — Booksy bierze 30% od nowych klientów, Fresha 20%, ManicBot 0% na zawsze</li>
<li>Polski-pierwszy interfejs, GDPR-natywny, hostowany na Cloudflare w regionie EU</li>
</ul>
<h2 style="font-size:20px;margin:28px 0 8px">Najczęściej zadawane pytania</h2>
<p><strong>Czy klient musi instalować nową aplikację?</strong> Nie — klient pisze do salonu w tym samym kanale, którego już używa (Telegram, Instagram DM, WhatsApp lub czat na stronie).</p>
<p><strong>Czy AI sam potwierdza rezerwacje?</strong> Tak, jeśli właściciel włączył auto-confirm dla danego kanału. W innym przypadku rezerwacja czeka na ręczne potwierdzenie w panelu salonu.</p>
<p><strong>Czy ManicBot obsługuje master niezależnego (bez salonu)?</strong> Tak — niezależny mistrz tworzy własne osobiste konto z tymi samymi planami 45/60/90 PLN.</p>
<p><strong>Kontakt:</strong> <a href="mailto:support@manicbot.com">support@manicbot.com</a> · <a href="https://t.me/manicbot_com">t.me/manicbot_com</a></p>
</div></noscript>`;

const LLM_JSONLD_BLOCK = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://manicbot.com/#org",
      "name": "ManicBot",
      "url": "https://manicbot.com/",
      "logo": "https://manicbot.com/manicbot-mark-ui.png",
      "sameAs": ["https://t.me/manicbot_com"],
      "contactPoint": {
        "@type": "ContactPoint",
        "email": "support@manicbot.com",
        "contactType": "customer support",
        "availableLanguage": ["Polish", "Russian", "Ukrainian", "English"],
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://manicbot.com/#software",
      "name": "ManicBot",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "url": "https://manicbot.com/",
      "publisher": { "@id": "https://manicbot.com/#org" },
      "description": "AI booking platform for nail salons. Multi-channel booking via Telegram, Instagram, WhatsApp and web. 0% commission, plans from 45 PLN/month.",
      "inLanguage": ["pl", "ru", "uk", "en"],
      "offers": [
        { "@type": "Offer", "name": "Start", "price": "45", "priceCurrency": "PLN", "category": "Subscription" },
        { "@type": "Offer", "name": "Pro", "price": "60", "priceCurrency": "PLN", "category": "Subscription" },
        { "@type": "Offer", "name": "Max", "price": "90", "priceCurrency": "PLN", "category": "Subscription" },
      ],
    },
  ],
})}</script>`;

const BRIDGE_SCRIPT = `<script>
(function () {
  if (document.querySelector('script[src*="/embed/demo-chat.js"]')) return;
  if (window.__mbBridgeBooted) return;
  window.__mbBridgeBooted = true;
  var SLUG = 'preview-landing';
  // Pick up locale from the landing (?lang= → localStorage → <html lang> → 'ru').
  // Keeps the widget in sync with the Vite landing's LanguageProvider.
  var LANG = (function () {
    try {
      var q = new URLSearchParams(window.location.search).get('lang');
      if (q && /^(ru|en|ua|pl)$/.test(q)) return q;
      var s = localStorage.getItem('manicbot-locale');
      if (s && /^(ru|en|ua|pl)$/.test(s)) return s;
      var h = (document.documentElement.getAttribute('lang') || '').toLowerCase();
      if (h === 'uk') return 'ua';
      if (/^(ru|en|ua|pl)$/.test(h)) return h;
    } catch (_) {}
    return 'ru';
  })();
  var activated = false;

  function loadWidget(targetId) {
    // Set global config BEFORE appending the script so the widget IIFE can
    // read it even when document.currentScript is null (Safari dynamic script).
    window.__MB_BRIDGE__ = { title: 'Manic Bot', slug: SLUG, lang: LANG, target: '#' + targetId, showHeader: true };
    var s = document.createElement('script');
    // ?v=3 cache-busts Safari's memory/disk cache so title + lang fixes propagate immediately.
    s.src = '/embed/demo-chat.js?v=4';
    s.setAttribute('data-slug', SLUG);
    s.setAttribute('data-target', '#' + targetId);
    s.setAttribute('data-lang', LANG);
    s.setAttribute('data-show-header', '1');
    s.setAttribute('data-title', 'Manic Bot');
    document.head.appendChild(s);
  }

  function parseRgb(css) {
    var m = css && css.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function isDark(r)  { return r && r[0]<55  && r[1]<55  && r[2]<55;  }
  function isLight(r) { return r && r[0]>225 && r[1]>225 && r[2]>225; }

  function mountOnScreen(screen) {
    if (activated) return;
    activated = true;
    var h = screen.offsetHeight, w = screen.offsetWidth;
    // Clear existing static mockup content so it doesn't bleed through.
    screen.innerHTML = '';
    // Positioning context + clip so the widget stays inside the phone frame.
    if (getComputedStyle(screen).position === 'static') screen.style.position = 'relative';
    screen.style.overflow = 'hidden';
    // Guarantee height (phones with auto height collapse after React re-renders).
    if (h < 200) screen.style.height = (w>0 ? Math.round(w*1.88) : 540)+'px';

    var ov = document.createElement('div');
    ov.id = 'mb-target';
    ov.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:transparent;border-radius:inherit';
    screen.appendChild(ov);
    loadWidget('mb-target');
  }

  function mountOnFrame(frame) {
    if (activated) return;
    // Find the inner SCREEN element by geometry (theme-agnostic): the direct
    // descendant with large border-radius, overflow:hidden and dimensions
    // close to the frame minus its padding. Colour-based detection (old
    // "isLight" heuristic) missed dark-theme iPhone mockups and the overlay
    // ended up on the outer body — causing the composer to overflow the
    // phone's bottom-corner radius.
    var fw = frame.offsetWidth, fh = frame.offsetHeight;
    var best = null;
    var bestScore = -Infinity;
    var all = frame.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      var cw = c.offsetWidth, ch = c.offsetHeight;
      if (cw < 200 || ch < 260) continue;
      if (cw > fw || ch > fh) continue;
      var cs = getComputedStyle(c);
      var radius = parseFloat(cs.borderRadius) || 0;
      if (radius < 18) continue;                   // screen has big radius
      if (cs.overflow !== 'hidden' && cs.overflowX !== 'hidden' && cs.overflowY !== 'hidden') continue;
      // Prefer the element with the largest area that still fits inside the
      // frame — the actual screen bezel, not a descendant bubble.
      var score = cw * ch - Math.abs(fw - cw) * 2 - Math.abs(fh - ch) * 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) {
      mountOnScreen(best);
    } else {
      // Last-resort fallback: build our own screen inside the frame, sized
      // to the real iPhone bezel ratios (~5% sides, ~9% top for notch, ~4%
      // bottom for home bar).
      if (activated) return; activated = true;
      if (getComputedStyle(frame).position === 'static') frame.style.position = 'relative';
      var scr = document.createElement('div');
      scr.id = 'mb-target';
      scr.style.cssText = 'position:absolute;top:9%;left:5%;right:5%;bottom:4%;background:#fff;border-radius:30px;overflow:hidden;z-index:200;';
      frame.appendChild(scr);
      loadWidget('mb-target');
    }
  }

  function findPhoneFrame() {
    var explicit = document.getElementById('mb-demo') || document.querySelector('[data-mb-demo]');
    if (explicit) { mountOnScreen(explicit); return true; }

    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var w = el.offsetWidth, h = el.offsetHeight;
      if (w < 260 || w > 490 || h < 480 || h > 950) continue;
      if (h/w < 1.55 || h/w > 2.6) continue;
      var st = getComputedStyle(el);
      if (parseFloat(st.borderRadius) < 26) continue;
      var rgb = parseRgb(st.backgroundColor);
      if (!isDark(rgb)) continue;
      mountOnFrame(el);
      return true;
    }
    return false;
  }

  if (findPhoneFrame()) return;

  var obs = new MutationObserver(function () {
    if (findPhoneFrame()) obs.disconnect();
  });
  function start() {
    if (findPhoneFrame()) return;
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 15000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
<\/script>`;

/**
 * SEO audit 2026-05-20 P0-4 — HEAD support.
 *
 * Bing crawler + Meta crawler + uptime monitors (Pingdom, BetterStack,
 * UptimeRobot) probe HEAD before GET. Before this fix, `tryLanding`
 * rejected non-GET → worker.js fell through to 404 → soft-404 for crawlers
 * and flapping uptime alerts. Now HEAD is proxied upstream the same way
 * GET is, but the body is stripped so Workers don't pay egress for HEAD
 * probes and the bridge-script injection is skipped (HEAD has no body to
 * inject into).
 *
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {boolean} [force] Skip isLandingPath check (used for catch-all 404)
 * @returns {Promise<Response | null>}
 */
export async function tryLanding(request, env, url, force) {
  const isProbe = request.method === 'HEAD';
  if (request.method !== 'GET' && !isProbe) return null;
  if (!force && !isLandingPath(url.pathname)) return null;

  const landingOrigin = resolveLandingOrigin(env);
  const landingUrl = buildLandingFetchUrl(url.pathname, landingOrigin);
  const res = await fetch(landingUrl, { method: request.method, headers: request.headers });

  // SEO audit 2026-05-20 P0-7 — soft-404 guard.
  //
  // The Vite SPA serves `dist/index.html` for any unknown path, so the
  // upstream returns HTTP 200 + the landing shell for `/pricing`,
  // `/cennik`, `/cities`, `/pl/about` etc. Google treats these as
  // soft-404s and penalises the entire domain. When `force=true` AND
  // the path is NOT in the curated `isLandingPath` allowlist, override
  // the response status to 404. Body is preserved (the SPA's branded
  // 404 page still renders for humans); crawlers see 404 and stop.
  const isAllowlisted = isLandingPath(url.pathname);
  const shouldRewriteToSoft404 = force && !isAllowlisted && res.status === 200;

  // HEAD path: pass through status + headers, no body, no bridge inject.
  // Cloudflare Pages handles HEAD natively for static and SSR assets.
  if (isProbe) {
    return new Response(null, {
      status: shouldRewriteToSoft404 ? 404 : res.status,
      statusText: shouldRewriteToSoft404 ? 'Not Found' : res.statusText,
      headers: res.headers,
    });
  }

  // Inject bridge into homepage HTML.
  const ct = res.headers.get('content-type') || '';
  const isHomepage = url.pathname === '/' || url.pathname === '';
  if (isHomepage && res.status === 200 && ct.includes('text/html')) {
    const html = await res.text();
    const newHeaders = new Headers(res.headers);
    newHeaders.delete('content-length');
    // Never cache the injected HTML — bridge changes must propagate immediately.
    newHeaders.set('Cache-Control', 'no-cache');
    // P0-5: prepend LLM noscript + JSON-LD before the bridge script so
    // crawlers see SEO content even though the body is otherwise empty.
    const SEO_BLOCK = LLM_NOSCRIPT_BLOCK + LLM_JSONLD_BLOCK;
    const injected = html.includes('</body>')
      ? html.replace('</body>', SEO_BLOCK + BRIDGE_SCRIPT + '</body>')
      : html + SEO_BLOCK + BRIDGE_SCRIPT;
    return new Response(injected, { status: 200, headers: newHeaders });
  }

  return new Response(res.body, {
    status: shouldRewriteToSoft404 ? 404 : res.status,
    statusText: shouldRewriteToSoft404 ? 'Not Found' : res.statusText,
    headers: res.headers,
  });
}
