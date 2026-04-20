import { resolveLandingOrigin, isLandingPath, buildLandingFetchUrl } from '../utils/landing-pages-proxy.js';

/**
 * Bridge script injected into the landing homepage HTML by the Worker.
 *
 * Strategy: find the phone FRAME (dark casing, large border-radius, portrait
 * size) then look for the white SCREEN inside it. This works for any class
 * naming convention — including hashed CSS Modules — because it relies only
 * on computed styles, not class names.
 *
 * Explicit escape hatch: add id="mb-demo" or data-mb-demo to the screen
 * element in the landing page and the bridge will use it directly.
 */
const BRIDGE_SCRIPT = `<script>
(function () {
  if (document.querySelector('script[src*="/embed/demo-chat.js"]')) return;
  var SLUG = 'preview-landing';
  var LANG = 'ru';
  var activated = false;

  function activate(el) {
    if (activated) return;
    activated = true;
    console.log('[mb-bridge] found container:', el.tagName, el.id || el.className.toString().slice(0,80));
    el.innerHTML = '';
    if (!el.id) el.id = 'mb-target';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    if (el.offsetHeight < 200) {
      el.style.height = (el.offsetWidth > 0 ? Math.round(el.offsetWidth * 1.85) : 520) + 'px';
    }
    var s = document.createElement('script');
    s.src = '/embed/demo-chat.js';
    s.setAttribute('data-slug', SLUG);
    s.setAttribute('data-target', '#' + el.id);
    s.setAttribute('data-lang', LANG);
    document.head.appendChild(s);
  }

  function parseRgb(css) {
    var m = css && css.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function isDark(rgb)  { return rgb && rgb[0] < 55 && rgb[1] < 55 && rgb[2] < 55; }
  function isLight(rgb) { return rgb && rgb[0] > 228 && rgb[1] > 228 && rgb[2] > 228; }

  function findScreen() {
    // Explicit marker wins every time.
    var explicit = document.getElementById('mb-demo') || document.querySelector('[data-mb-demo]');
    if (explicit) return explicit;

    // Find the phone frame: portrait shape, dark background, heavily rounded.
    var all = document.querySelectorAll('*');
    var frame = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var w = el.offsetWidth, h = el.offsetHeight;
      if (w < 260 || w > 480 || h < 480 || h > 940) continue;
      if (h / w < 1.6 || h / w > 2.55) continue;
      var st = getComputedStyle(el);
      if (parseFloat(st.borderRadius) < 28) continue;
      if (!isDark(parseRgb(st.backgroundColor))) continue;
      frame = el;
      break;
    }
    if (!frame) { console.log('[mb-bridge] phone frame not found yet'); return null; }
    console.log('[mb-bridge] phone frame:', frame.tagName, frame.offsetWidth + 'x' + frame.offsetHeight);

    // Inside the frame find the white screen (rounded white/near-white child).
    var kids = frame.querySelectorAll('*');
    for (var j = 0; j < kids.length; j++) {
      var c = kids[j];
      if (c.offsetWidth < 220 || c.offsetHeight < 280) continue;
      var cs = getComputedStyle(c);
      if (!isLight(parseRgb(cs.backgroundColor))) continue;
      if (parseFloat(cs.borderRadius) < 8) continue;
      return c;
    }
    // No white screen found — use the frame itself.
    return frame;
  }

  function tryActivate() {
    var el = findScreen();
    if (el) { activate(el); return true; }
    return false;
  }

  if (tryActivate()) return;

  var obs = new MutationObserver(function () {
    if (tryActivate()) obs.disconnect();
  });
  function start() {
    if (tryActivate()) return;
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

  // Inject bridge into homepage HTML so the live widget activates inside the
  // existing iPhone mockup without touching the landing-pages repo.
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
