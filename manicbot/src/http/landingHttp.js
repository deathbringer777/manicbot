import { resolveLandingOrigin, isLandingPath, buildLandingFetchUrl } from '../utils/landing-pages-proxy.js';

/**
 * Bridge script injected into the landing homepage HTML by the Worker.
 *
 * Finds the existing static phone-mockup container (whatever the landing's
 * React component calls it) and replaces its content with the live
 * preview-landing chat widget.  Works for:
 *   - Elements already identified with id="mb-demo" or data-mb-demo
 *   - Common CSS class naming conventions (.phone-screen, .iphone-screen, …)
 *   - CSS-Modules hashed class names — via size/aspect-ratio heuristic
 *   - React SPAs — via MutationObserver that waits for the component to mount
 *
 * Guard: if the landing already loads demo-chat.js itself, the bridge exits
 * immediately so the widget is not double-initialised.
 */
const BRIDGE_SCRIPT = `<script>
(function () {
  if (document.querySelector('script[src*="/embed/demo-chat.js"]')) return;
  var SLUG = 'preview-landing';
  var LANG = 'ru';
  var CSS_SEL = [
    '#mb-demo','[data-mb-demo]',
    '.phone-screen','.iphone-screen','.mockup-screen','.chat-screen',
    '.bot-preview','.demo-screen','.demo-chat','.phone-content',
    '[class*="phoneScreen"],[class*="iphone_screen"],[class*="phone_screen"]',
    '[class*="chatPreview"],[class*="chatScreen"],[class*="botPreview"]',
    '[class*="demoChat"],[class*="PhoneScreen"],[class*="ChatPreview"]',
    '[class*="phone"][class*="screen"]',
  ];
  var activated = false;
  function activate(el) {
    if (activated) return; activated = true;
    el.innerHTML = '';
    if (!el.id) el.id = 'mb-demo-' + Date.now();
    var tid = '#' + el.id;
    if (typeof getComputedStyle !== 'undefined' && getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
    var s = document.createElement('script');
    s.src = '/embed/demo-chat.js';
    s.setAttribute('data-slug', SLUG);
    s.setAttribute('data-target', tid);
    s.setAttribute('data-lang', LANG);
    document.head.appendChild(s);
  }
  function findBySel() {
    for (var i = 0; i < CSS_SEL.length; i++) {
      var el = null;
      try { el = document.querySelector(CSS_SEL[i]); } catch(e) {}
      if (el) return el;
    }
    return null;
  }
  function findByShape() {
    var divs = document.querySelectorAll('div, section, article');
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      var w = el.offsetWidth, h = el.offsetHeight;
      if (w < 240 || w > 440 || h < 350 || h > 850) continue;
      var ratio = h / w;
      if (ratio < 1.4 || ratio > 2.6) continue;
      var st = getComputedStyle(el);
      var bg = st.backgroundColor;
      var isLight = bg.indexOf('255, 255, 255') !== -1 ||
                    bg === 'rgba(0, 0, 0, 0)' ||
                    bg.indexOf('248') !== -1 || bg.indexOf('250') !== -1 ||
                    bg.indexOf('252') !== -1;
      if (!isLight) continue;
      if (parseFloat(st.borderRadius) < 10) continue;
      return el;
    }
    return null;
  }
  function tryActivate() {
    var el = findBySel() || findByShape();
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
    setTimeout(function () { obs.disconnect(); }, 12000);
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

  // Inject bridge script into the homepage HTML so the live bot widget
  // activates inside the existing iPhone mockup without touching the landing repo.
  const ct = res.headers.get('content-type') || '';
  const isHomepage = url.pathname === '/' || url.pathname === '';
  if (isHomepage && res.status === 200 && ct.includes('text/html')) {
    const html = await res.text();
    const newHeaders = new Headers(res.headers);
    newHeaders.delete('content-length'); // body length changes after injection
    const injected = html.includes('</body>')
      ? html.replace('</body>', BRIDGE_SCRIPT + '</body>')
      : html + BRIDGE_SCRIPT;
    return new Response(injected, { status: 200, headers: newHeaders });
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
