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
const BRIDGE_SCRIPT = `<script>
(function () {
  if (document.querySelector('script[src*="/embed/demo-chat.js"]')) return;
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
    var s = document.createElement('script');
    s.src = '/embed/demo-chat.js';
    s.setAttribute('data-slug', SLUG);
    s.setAttribute('data-target', '#' + targetId);
    s.setAttribute('data-lang', LANG);
    s.setAttribute('data-show-header', '1');
    s.setAttribute('data-title', 'Preview Salon');
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
    console.log('[mb-bridge] screen element', screen.tagName, w+'x'+h, screen.id||screen.className.toString().slice(0,60));

    // Clear existing static mockup content so it doesn't bleed through.
    screen.innerHTML = '';
    // Positioning context + clip so the widget stays inside the phone frame.
    if (getComputedStyle(screen).position === 'static') screen.style.position = 'relative';
    screen.style.overflow = 'hidden';
    // Guarantee height (phones with auto height collapse after React re-renders).
    if (h < 200) screen.style.height = (w>0 ? Math.round(w*1.88) : 540)+'px';

    var ov = document.createElement('div');
    ov.id = 'mb-target';
    ov.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:#fff;border-radius:inherit';
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
      console.log('[mb-bridge] screen found', best.tagName, best.offsetWidth+'x'+best.offsetHeight, 'radius='+getComputedStyle(best).borderRadius);
      mountOnScreen(best);
    } else {
      // Last-resort fallback: build our own screen inside the frame, sized
      // to the real iPhone bezel ratios (~5% sides, ~9% top for notch, ~4%
      // bottom for home bar).
      console.log('[mb-bridge] no screen found — creating overlay inside frame');
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
      console.log('[mb-bridge] phone frame found', el.tagName, w+'x'+h, 'radius='+st.borderRadius, el.id||el.className.toString().slice(0,60));
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
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {boolean} [force] Skip isLandingPath check (used for catch-all 404)
 * @returns {Promise<Response | null>}
 */
export async function tryLanding(request, env, url, force) {
  if (request.method !== 'GET' || (!force && !isLandingPath(url.pathname))) return null;
  const landingOrigin = resolveLandingOrigin(env);
  const landingUrl = buildLandingFetchUrl(url.pathname, landingOrigin);
  const res = await fetch(landingUrl, { headers: request.headers });

  // Inject bridge into homepage HTML.
  const ct = res.headers.get('content-type') || '';
  const isHomepage = url.pathname === '/' || url.pathname === '';
  if (isHomepage && res.status === 200 && ct.includes('text/html')) {
    const html = await res.text();
    const newHeaders = new Headers(res.headers);
    newHeaders.delete('content-length');
    const injected = html.includes('</body>')
      ? html.replace('</body>', BRIDGE_SCRIPT + '</body>')
      : html + BRIDGE_SCRIPT;
    return new Response(injected, { status: 200, headers: newHeaders });
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
