/**
 * Browser-side demo chat widget, exported as a string so the Worker can serve
 * it verbatim via `/embed/demo-chat.js` (see `src/http/embedHttp.js`).
 *
 * The inner IIFE runs in the browser, not in the Worker. Keep it ES2020, no
 * dependencies, no template literals that would collide with the surrounding
 * backtick string.
 *
 * Usage on the landing:
 *   <div id="mb-demo"></div>
 *   <script src="https://manicbot.com/embed/demo-chat.js"
 *           data-slug="preview-landing"
 *           data-target="#mb-demo"
 *           data-lang="ru"></script>
 *
 * Talks to `/chat/init`, `/chat/send`, `/chat/poll` on the script's origin.
 * Shape of the bubble messages is documented in `LANDING_DEMO_INTEGRATION.md`.
 */
export const DEMO_CHAT_SRC = `
(function () {
  // document.currentScript is null for async/defer scripts — fall back to
  // finding any <script> whose src contains our known path segment.
  var scriptEl = document.currentScript ||
    (function () {
      var scripts = document.querySelectorAll('script[src]');
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src.indexOf('/embed/demo-chat.js') !== -1) return scripts[i];
      }
      return null;
    })();
  if (!scriptEl) return;
  var ORIGIN = new URL(scriptEl.src).origin;
  // __MB_BRIDGE__ is set by the landing bridge script before injecting this
  // script tag — provides reliable config even when document.currentScript is
  // null (Safari with dynamically-appended scripts).
  var _BR = window.__MB_BRIDGE__ || {};
  var SLUG = _BR.slug || (scriptEl && scriptEl.dataset.slug) || 'preview-landing';
  var TARGET = _BR.target || (scriptEl && scriptEl.dataset.target) || '#mb-demo';
  var LANG = _BR.lang || (scriptEl && scriptEl.dataset.lang) || 'ru';
  var TITLE = _BR.title || (scriptEl && scriptEl.dataset.title) || 'Manic Bot';
  var SHOW_HEADER = _BR.showHeader || (scriptEl && scriptEl.dataset.showHeader === '1');
  var I18N = {
    ru: { placeholder: 'Сообщение…', online: 'онлайн', send: 'Отправить',
          typing: 'печатает…',
          offline: 'нет связи', reconnecting: 'подключение…',
          initFailed: 'Не удалось подключиться. Повторная попытка…',
          sendError: 'Ошибка отправки. Попробуйте ещё раз.',
          netError: 'Нет соединения. Проверьте интернет.' },
    ua: { placeholder: 'Повідомлення…', online: 'онлайн', send: 'Надіслати',
          typing: 'друкує…',
          offline: "немає зв'язку", reconnecting: 'підключення…',
          initFailed: 'Не вдалося підключитися. Повторна спроба…',
          sendError: 'Помилка відправки. Спробуйте ще раз.',
          netError: "Немає з'єднання. Перевірте інтернет." },
    en: { placeholder: 'Message…', online: 'online', send: 'Send',
          typing: 'typing…',
          offline: 'offline', reconnecting: 'reconnecting…',
          initFailed: 'Connection failed. Retrying…',
          sendError: 'Send failed. Please try again.',
          netError: 'No connection. Check your internet.' },
    pl: { placeholder: 'Wiadomość…', online: 'online', send: 'Wyślij',
          typing: 'pisze…',
          offline: 'brak połączenia', reconnecting: 'łączenie…',
          initFailed: 'Błąd połączenia. Ponowna próba…',
          sendError: 'Błąd wysyłania. Spróbuj ponownie.',
          netError: 'Brak połączenia. Sprawdź internet.' },
  };
  var T = I18N[LANG] || I18N.ru;
  function escAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  // Include lang in the storage key so switching languages starts a fresh
  // session instead of continuing the old one in the wrong language.
  var STORAGE_KEY = 'mb.chat.' + SLUG + '.' + LANG;
  var SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  var POLL_MS = 3000;
  var HISTORY_CAP = 200;

  var root = document.querySelector(TARGET);
  if (!root) { console.warn('[mb-demo] target not found:', TARGET); return; }

  var styleTag = document.createElement('style');
  styleTag.textContent =
    // position:absolute fills the parent container precisely, so the widget
    // is always fully contained in the iPhone frame regardless of whether the
    // landing page sets an explicit height on the target div.
    // CSS variables drive light/dark theming. --mb-island-clear reserves space
    // at the top of the widget so the statusbar sits BELOW the host phone
    // mockup's Dynamic Island SVG (which sits above the screen with higher
    // z-index on the landing mockup).
    // Light theme is the default palette (declared on .mb-demo). Dark theme
    // overrides the same variables when .mb-dark is applied. Every visual
    // surface/text/border colour resolves through a variable — no stray
    // hardcoded #fff / #000 / slate tokens inside the widget chrome.
    // translate3d forces a single GPU compositing context for the whole widget.
    // Without it, iOS Safari promotes the scrollable feed to a separate GPU
    // layer and renders a 1px seam at the layer boundaries (header/composer)
    // that flickers during scroll. One shared context = no seam.
    '.mb-demo{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;font:12px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;overflow:hidden;-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0);' +
      '--mb-island-clear:0px;' +
      '--mb-bg:#ffffff;' +
      '--mb-fg:#1a1a1a;' +
      '--mb-muted:#64748b;' +
      '--mb-surface:#f5f5f5;' +
      '--mb-border:#e0e0e0;' +
      '--mb-statusbar-bg:#ffffff;' +
      '--mb-statusbar-fg:#1a1a1a;' +
      '--mb-header-bg:#ffffff;' +
      '--mb-bubble-bot:#e8ebf2;' +
      '--mb-bot-text:#1a1a1a;' +
      '--mb-bubble-user:#8b5cf6;' +
      '--mb-user-text:#ffffff;' +
      '--mb-btn-bg:#ffffff;' +
      '--mb-btn-text:#0f172a;' +
      '--mb-btn-border:rgba(15,23,42,0.10);' +
      '--mb-btn-hover:#f8fafc;' +
      '--mb-btn-hover-border:rgba(15,23,42,0.22);' +
      '--mb-input-bg:#f5f5f5;' +
      '--mb-input-text:#1a1a1a;' +
      '--mb-input-placeholder:#999999;' +
      '--mb-composer-border:#e0e0e0;' +
      'color:var(--mb-fg);background:var(--mb-bg)}' +
    // Dark theme — applied when the HOST page has <html class="dark"> (or the
    // visitor's OS prefers dark AND the host hasn't opted into light). The
    // landing script already reconciles OS pref into html.dark, so mirroring
    // html.dark alone is sufficient and never contradicts the visible page.
    '.mb-demo.mb-dark{' +
      '--mb-bg:#1c1c1e;' +
      '--mb-fg:#ffffff;' +
      '--mb-muted:#8e8e93;' +
      '--mb-surface:#2c2c2e;' +
      '--mb-border:#1c1c1e;' +
      // Statusbar bg matches the feed surface (not pure black) so the landing's
      // Dynamic Island pill (true black) stays visibly distinct in dark mode.
      '--mb-statusbar-bg:#1c1c1e;' +
      '--mb-statusbar-fg:#ffffff;' +
      '--mb-header-bg:#1c1c1e;' +
      '--mb-bubble-bot:#2c2c2e;' +
      '--mb-bot-text:#ffffff;' +
      '--mb-btn-bg:rgba(255,255,255,0.04);' +
      '--mb-btn-text:#ffffff;' +
      '--mb-btn-border:rgba(255,255,255,0.10);' +
      '--mb-btn-hover:rgba(255,255,255,0.07);' +
      '--mb-btn-hover-border:rgba(255,255,255,0.22);' +
      '--mb-input-bg:#2c2c2e;' +
      '--mb-input-text:#ffffff;' +
      '--mb-input-placeholder:#8e8e93;' +
      '--mb-composer-border:#1c1c1e}' +
    // The host landing mockup draws a Dynamic Island pill at top:12px, h:30px
    // (bottom edge ~42px, center at y~27px). Statusbar uses min-height + align
    // center so the time sits on the SAME row as the island (left side), icons
    // on the right side — exactly like a real iPhone. Chat-header then starts
    // at y~54, safely below the island bottom at 42.
    '.mb-demo.mb-with-header .mb-statusbar{min-height:54px;align-items:center;padding:0 22px}' +
    '.mb-statusbar{display:flex;align-items:flex-end;justify-content:space-between;padding:14px 20px 6px;font-size:13px;font-weight:600;color:var(--mb-statusbar-fg);flex-shrink:0;background:var(--mb-statusbar-bg);position:relative;z-index:3;font-variant-numeric:tabular-nums;letter-spacing:.01em}' +
    '.mb-statusbar .icons{display:inline-flex;gap:5px;align-items:center}' +
    '.mb-statusbar svg{width:15px;height:12px;display:block;fill:currentColor}' +
    // Header — bigger avatar + tidy status line for landing embed mode.
    '.mb-header{display:flex;align-items:center;gap:10px;padding:6px 14px 10px;border-bottom:1px solid var(--mb-border);background:var(--mb-header-bg);flex-shrink:0;position:relative;z-index:2}' +
    '.mb-header-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#ec4899);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:16px;font-weight:700;flex-shrink:0;overflow:hidden;box-shadow:0 2px 6px rgba(139,92,246,.25)}' +
    '.mb-header-meta{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}' +
    '.mb-header-name{font-size:13.5px;font-weight:600;color:var(--mb-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;letter-spacing:-.01em}' +
    // Status dot uses currentColor so toggling .mb-offline changes both text and dot in one step.
    '.mb-header-status{font-size:11.5px;color:#22c55e;font-weight:500;line-height:1.2;display:inline-flex;align-items:center;gap:5px;transition:color .3s}' +
    '.mb-header-status::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;box-shadow:0 0 0 2px rgba(34,197,94,.2)}' +
    '.mb-header-status.mb-offline{color:var(--mb-muted)}' +
    // Feed + bubbles (tighter spacing to fit inside iPhone screen)
    '.mb-demo-feed{flex:1 1 auto;overflow-y:auto;padding:8px 10px 6px;display:flex;flex-direction:column;gap:5px;background:var(--mb-bg)}' +
    '.mb-demo-feed::-webkit-scrollbar{width:0;height:0}' +
    '.mb-bubble{max-width:86%;padding:7px 11px;border-radius:16px;line-height:1.4;word-wrap:break-word;font-size:12.5px}' +
    '.mb-bubble.bot{align-self:flex-start;background:var(--mb-bubble-bot);color:var(--mb-bot-text);border-bottom-left-radius:4px}' +
    '.mb-bubble.user{align-self:flex-end;background:var(--mb-bubble-user);color:var(--mb-user-text);border-bottom-right-radius:4px}' +
    '.mb-bubble img{max-width:100%;border-radius:8px;margin:-1px 0 4px;display:block}' +
    // Buttons — web-native chip layout. Rows mirror the bot groupings:
    //   • Multi-button rows (◀ 2/2 ▶) → inline-flex, chips share row evenly.
    //   • Solo rows (1 chip) → row, content-sized chip.
    //   • Runs of consecutive solo rows (8 dates) → coalesced server-side
    //     into .mb-btn-row-grid, rendered as a CSS Grid (4 cols on the
    //     iPhone bezel width) so the date list reads as a calendar grid.
    '.mb-btns{display:flex;flex-direction:column;gap:6px;margin-top:8px}' +
    '.mb-btn-row{display:flex;flex-wrap:wrap;gap:5px}' +
    '.mb-btn-row-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(54px,1fr));gap:5px}' +
    '.mb-btn-row-grid .mb-btn{width:100%;min-width:0;padding:8px 6px;font-variant-numeric:tabular-nums}' +
    // Buttons use explicit --mb-btn-text (not color:inherit) so the label
    // stays readable regardless of the surrounding bubble's text colour.
    '.mb-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6.5px 11px;border:1px solid var(--mb-btn-border);background:var(--mb-btn-bg);color:var(--mb-btn-text);border-radius:9px;cursor:pointer;font:inherit;font-size:12px;font-weight:500;letter-spacing:-.005em;transition:border-color .15s ease,background .15s ease,transform .12s ease,box-shadow .15s ease;text-decoration:none;box-shadow:0 1px 0 rgba(15,23,42,.02);white-space:nowrap}' +
    '.mb-btn:active{transform:translateY(1px);box-shadow:none}' +
    '.mb-btn:hover{border-color:var(--mb-btn-hover-border);background:var(--mb-btn-hover);box-shadow:0 2px 6px rgba(15,23,42,.06)}' +
    // Multi-button rows (nav arrows, pagination): chips share row evenly.
    '.mb-btn-row:not(.mb-btn-row-solo):not(.mb-btn-row-grid) .mb-btn{flex:1 1 auto;min-width:38px}' +
    // Composer — compact, fits nicely at the bottom of the iPhone screen
    '.mb-composer{display:flex;gap:6px;padding:6px 10px 14px;border-top:1px solid var(--mb-composer-border);background:var(--mb-bg);flex-shrink:0}' +
    '.mb-composer input{flex:1;min-width:0;border:1px solid var(--mb-btn-border);border-radius:999px;padding:7px 12px;font:inherit;font-size:11.5px;background:var(--mb-input-bg);color:var(--mb-input-text);outline:none}' +
    '.mb-composer input::placeholder{color:var(--mb-input-placeholder)}' +
    '.mb-composer input:focus{border-color:var(--mb-bubble-user)}' +
    '.mb-composer button{flex-shrink:0;border:0;background:var(--mb-bubble-user);color:var(--mb-user-text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(139,92,246,.35);transition:transform .1s}' +
    '.mb-composer button:active{transform:scale(.94)}' +
    '.mb-composer button:disabled{opacity:.4;cursor:not-allowed}' +
    '.mb-typing{align-self:flex-start;padding:5px 9px;border-radius:12px;background:var(--mb-bubble-bot);display:inline-flex;gap:3px}' +
    '.mb-typing span{width:5px;height:5px;border-radius:50%;background:var(--mb-muted);animation:mb-bounce 1s infinite}' +
    '.mb-typing span:nth-child(2){animation-delay:.15s}.mb-typing span:nth-child(3){animation-delay:.3s}' +
    '@keyframes mb-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}' +
    '@media(prefers-reduced-motion:reduce){.mb-typing span{animation:none}}' +
    // Dark mode: remove borders entirely — on OLED screens even a 1px border
    // matching the background flickers during GPU-composited scroll animations.
    '.mb-demo.mb-dark .mb-header{border-bottom:none}' +
    '.mb-demo.mb-dark .mb-composer{border-top:none}' +
    // ─── "Living chat" entrance animations ───────────────────────────────────
    // The first time the widget is loaded (no persisted session), the welcome
    // message arrives in 2-3 staged bubbles with a typing indicator between
    // them — like a real conversation. After the welcome flow, every fresh
    // bot or user bubble still gets a subtle fade+slide-up entrance.
    //
    // Standard easing: cubic-bezier(0.16, 1, 0.3, 1) — Apple's "ease-out-expo"
    // approximation. Snappy in, settles smoothly. Used app-wide for entrances.
    '@keyframes mb-bubble-in{0%{opacity:0;transform:translateY(10px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}' +
    '.mb-bubble.mb-anim-in{animation:mb-bubble-in .42s cubic-bezier(.16,1,.3,1) both;transform-origin:bottom left}' +
    '.mb-bubble.user.mb-anim-in{transform-origin:bottom right}' +
    // Buttons in the welcome bubble stagger in one after another (~80ms each)
    // so the CTA reveal feels deliberate, not a slab dropping in.
    '@keyframes mb-btn-in{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}' +
    '.mb-btns.mb-stagger > *{opacity:0;animation:mb-btn-in .34s cubic-bezier(.16,1,.3,1) forwards}' +
    '.mb-btns.mb-stagger > *:nth-child(1){animation-delay:.06s}' +
    '.mb-btns.mb-stagger > *:nth-child(2){animation-delay:.16s}' +
    '.mb-btns.mb-stagger > *:nth-child(3){animation-delay:.26s}' +
    '.mb-btns.mb-stagger > *:nth-child(4){animation-delay:.36s}' +
    '.mb-btns.mb-stagger > *:nth-child(5){animation-delay:.46s}' +
    '.mb-btns.mb-stagger > *:nth-child(6){animation-delay:.56s}' +
    // Typing dots-bubble fades in (entrance) the same way as a regular bubble.
    '@keyframes mb-typing-in{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:translateY(0)}}' +
    '.mb-typing{animation:mb-typing-in .22s cubic-bezier(.16,1,.3,1) both}' +
    // Chrome (statusbar + header) fades in on first paint.
    '@keyframes mb-chrome-in{0%{opacity:0;transform:translateY(-4px)}100%{opacity:1;transform:translateY(0)}}' +
    '.mb-statusbar{animation:mb-chrome-in .4s cubic-bezier(.16,1,.3,1) both}' +
    '.mb-header{animation:mb-chrome-in .4s cubic-bezier(.16,1,.3,1) .08s both}' +
    // Header status — when the bot is "typing" during the welcome flow, the
    // green online dot becomes a soft pulsing purple dot + label "печатает…".
    '@keyframes mb-pulse-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.55}}' +
    '.mb-header-status.mb-typing-state{color:var(--mb-bubble-user)}' +
    '.mb-header-status.mb-typing-state::before{background:currentColor;box-shadow:0 0 0 2px rgba(139,92,246,.18);animation:mb-pulse-dot 1.2s ease-in-out infinite}' +
    // Composer is hidden during the welcome flow and fades in once the last
    // bubble + buttons have settled. Already-persisted sessions never enter
    // the .mb-init-pending state, so the composer is visible immediately.
    '.mb-composer{transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .5s cubic-bezier(.16,1,.3,1)}' +
    '.mb-demo.mb-init-pending .mb-composer{pointer-events:none}' +
    // Respect user preference for reduced motion: kill every entrance keyframe
    // and present the chat fully assembled. The widget still works; it just
    // skips the staged animation.
    '@media(prefers-reduced-motion:reduce){' +
      '.mb-bubble.mb-anim-in,.mb-btns.mb-stagger>*,.mb-typing,.mb-statusbar,.mb-header,.mb-header-status.mb-typing-state::before,.mb-composer,.mb-demo.mb-init-pending .mb-composer{animation:none !important;transition:none !important}' +
      '.mb-btns.mb-stagger>*,.mb-demo.mb-init-pending .mb-composer{opacity:1;transform:none;pointer-events:auto}' +
    '}';
  document.head.appendChild(styleTag);

  // Ensure the container is a positioning context so position:absolute children
  // (the feed + composer flex layout) stay inside the iPhone frame.
  if (typeof getComputedStyle !== 'undefined') {
    var pos = getComputedStyle(root).position;
    if (pos === 'static') root.style.position = 'relative';
  } else {
    root.style.position = 'relative';
  }
  root.classList.add('mb-demo');
  if (SHOW_HEADER) root.classList.add('mb-with-header');
  // Mirror the HOST page's explicit theme (html.dark). The landing's inline
  // script already reconciles OS preference into html.dark on boot and keeps
  // it in sync with the user's light/dark toggle, so we never contradict the
  // visible page — a light landing always yields a light widget even when
  // the visitor's OS prefers dark. prefers-color-scheme is ONLY consulted as
  // a fallback when the host clearly doesn't manage theme itself (no theme
  // signal at all on <html> and no landing/bridge wiring).
  function hostManagesTheme() {
    // Landing injects the bridge via /embed/demo-chat.js which sets
    // data-show-header="1"; /demo standalone page does not. SHOW_HEADER is
    // a reliable proxy for "embedded in a theme-managed host".
    return SHOW_HEADER || document.documentElement.hasAttribute('class');
  }
  function applyTheme() {
    var hostDark = document.documentElement.classList.contains('dark');
    var dark = hostDark;
    if (!hostManagesTheme()) {
      try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) dark = true;
      } catch (_) {}
    }
    if (dark) root.classList.add('mb-dark');
    else root.classList.remove('mb-dark');
  }
  applyTheme();
  try {
    if (!hostManagesTheme() && window.matchMedia) {
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (mql.addEventListener) mql.addEventListener('change', applyTheme);
    }
    // Watch for host toggling html.dark at runtime (theme switch on landing).
    var themeObs = new MutationObserver(applyTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } catch (_) {}

  // Lang change watcher: the Vite LanguageProvider switches language SPA-style
  // (history.replaceState ?lang= + localStorage). No event fires, no <html lang>
  // change, and same-tab localStorage writes don't fire 'storage'. Poll URL +
  // localStorage; on change, drop the old session and full-reload so the
  // bridge re-fires fresh with the new LANG.
  function detectLangChange() {
    try {
      var q = new URLSearchParams(window.location.search).get('lang');
      if (q && /^(ru|en|ua|pl)$/.test(q)) {
        // URL is authoritative when present. Do NOT consult localStorage —
        // a stale "manicbot-locale" (set by the landing on a previous visit)
        // could otherwise disagree with the URL and trigger an infinite
        // reload loop (URL=ru, LS=pl → reload → URL still ru, LS still pl
        // → reload again …). Sync LS to URL so the next no-?lang visit
        // sticks to the choice the user just made.
        if (q !== LANG) return q;
        try {
          var cur = localStorage.getItem('manicbot-locale');
          if (cur !== LANG) localStorage.setItem('manicbot-locale', LANG);
        } catch (_) {}
        return null;
      }
      var s = localStorage.getItem('manicbot-locale');
      if (s && /^(ru|en|ua|pl)$/.test(s) && s !== LANG) return s;
    } catch (_) {}
    return null;
  }
  function maybeReinit() {
    var newLang = detectLangChange();
    if (!newLang) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    // Sync the locale store BEFORE reload so the post-reload pass doesn't
    // immediately re-trigger this branch and refresh forever.
    try { localStorage.setItem('manicbot-locale', newLang); } catch (_) {}
    location.reload();
  }
  setInterval(maybeReinit, 1000);
  window.addEventListener('storage', maybeReinit);
  window.addEventListener('popstate', maybeReinit);

  // Refs to header sub-elements — populated below if SHOW_HEADER is true.
  var headerAvEl = null;
  var headerNameEl = null;
  var headerStatusEl = null;

  if (SHOW_HEADER) {
    // iPhone-style status bar — current time + signal/wifi/battery glyphs.
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var statusbar = document.createElement('div');
    statusbar.className = 'mb-statusbar';
    statusbar.innerHTML =
      '<span>' + hh + ':' + mm + '</span>' +
      '<span class="icons">' +
        // signal bars only — no wifi, no battery
        '<svg viewBox="0 0 18 10" fill="currentColor"><rect x="0"  y="7" width="3" height="3" rx=".5"/><rect x="5"  y="5" width="3" height="5" rx=".5"/><rect x="10" y="2" width="3" height="8" rx=".5"/><rect x="15" y="0" width="3" height="10" rx=".5"/></svg>' +
      '</span>';
    root.appendChild(statusbar);

    var header = document.createElement('div');
    header.className = 'mb-header';
    var initial = (TITLE.charAt(0) || 'P').toUpperCase();
    header.innerHTML =
      '<div class="mb-header-av">' + escAttr(initial) + '</div>' +
      '<div class="mb-header-meta">' +
        '<span class="mb-header-name">' + escAttr(TITLE) + '</span>' +
        '<span class="mb-header-status">' + escAttr(T.online) + '</span>' +
      '</div>';
    headerAvEl = header.querySelector('.mb-header-av');
    headerNameEl = header.querySelector('.mb-header-name');
    headerStatusEl = header.querySelector('.mb-header-status');
    root.appendChild(header);
  }

  var feed = document.createElement('div');
  feed.className = 'mb-demo-feed';
  feed.setAttribute('role', 'log');
  feed.setAttribute('aria-live', 'polite');
  var composer = document.createElement('form');
  composer.className = 'mb-composer';
  composer.innerHTML =
    '<input type="text" placeholder="' + escAttr(T.placeholder) + '" autocomplete="off" />' +
    '<button type="submit" aria-label="' + escAttr(T.send) + '">&#10148;</button>';
  root.appendChild(feed);
  root.appendChild(composer);

  var input = composer.querySelector('input');
  var sendBtn = composer.querySelector('button');

  var sessionId = null;
  var lastTs = 0;
  var bubbles = new Map();
  var messages = [];
  var sending = false;
  var currentBranding = null;
  var _pollFails = 0;

  // Toggle the header status dot + text between online (green) and offline (grey).
  // Uses a CSS class that switches color via currentColor on the ::before dot.
  function setStatus(text, isOnline) {
    if (!headerStatusEl) return;
    headerStatusEl.textContent = text;
    if (isOnline) {
      headerStatusEl.classList.remove('mb-offline');
    } else {
      headerStatusEl.classList.add('mb-offline');
    }
  }

  // Apply salon branding from /chat/init response: update avatar logo + display name.
  // Safe to call multiple times; persisted branding is restored on page reload.
  function applyBranding(salon) {
    if (!salon) return;
    currentBranding = salon;
    // Bridge-supplied title wins over the server's salon.name. Lets us keep
    // the brand label ("Manic Bot") stable in the demo widget regardless of
    // what the preview tenant is renamed to in D1 down the line.
    if (headerNameEl && salon.name && !_BR.title) {
      headerNameEl.textContent = salon.name;
    }
    if (headerAvEl && salon.logo) {
      var img = document.createElement('img');
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
      img.onerror = function () {
        headerAvEl.innerHTML = '';
        headerAvEl.textContent = (salon.name || TITLE).charAt(0).toUpperCase();
      };
      headerAvEl.innerHTML = '';
      headerAvEl.appendChild(img);
      // Set src after appending so onerror fires on the DOM-attached element.
      img.src = salon.logo;
    }
  }

  function loadPersisted() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !p.sessionId) return null;
      // Discard sessions older than SESSION_TTL_MS so visitors start fresh.
      if (p.savedAt && (Date.now() - p.savedAt) > SESSION_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return p;
    } catch (_) { return null; }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId: sessionId, lastTs: lastTs,
        messages: messages.slice(-HISTORY_CAP),
        branding: currentBranding,
        savedAt: Date.now(),
      }));
    } catch (_) {}
  }

  async function postJson(path, body) {
    var r = await fetch(ORIGIN + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, retryAfter: r.headers.get('Retry-After'), data: data };
  }

  function showErrorBubble(text) {
    var div = document.createElement('div');
    div.className = 'mb-bubble bot';
    div.style.cssText = 'color:#ef4444;background:#fef2f2;border:1px solid #fecaca';
    div.textContent = text;
    feed.appendChild(div);
    scrollToBottom();
  }

  // ─── "Living chat" welcome animation ──────────────────────────────────────
  // Goal: a 2.5–3s scripted reveal that feels like a real conversation, not
  // a slab of text dropping in at once. Plays only on a fresh session (no
  // localStorage). Gated by prefers-reduced-motion.

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) { return false; }
  }

  // Toggle the header subtitle between "online" (green dot) and "typing…"
  // (purple pulsing dot) without rebuilding the DOM. Reuses the existing
  // .mb-header-status element + its ::before dot.
  function setHeaderTypingState(on) {
    if (!headerStatusEl) return;
    if (on) {
      headerStatusEl.textContent = T.typing || T.online;
      headerStatusEl.classList.add('mb-typing-state');
      headerStatusEl.classList.remove('mb-offline');
    } else {
      headerStatusEl.textContent = T.online;
      headerStatusEl.classList.remove('mb-typing-state');
      headerStatusEl.classList.remove('mb-offline');
    }
  }

  // Split the welcome message into at most 3 staged bubbles so we keep the
  // 3-second budget. Bot replies are typically 4–6 paragraphs separated by
  // blank lines; we group greeting (first 2) + middle + CTA (last) so the
  // last bubble carries the buttons.
  function splitWelcomeForStaging(text) {
    if (!text) return [''];
    var paragraphs = String(text).split(/\\n\\s*\\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (paragraphs.length <= 1) return [text];
    if (paragraphs.length <= 3) return paragraphs;
    var first = paragraphs.slice(0, 2).join('\\n\\n');
    var last = paragraphs[paragraphs.length - 1];
    var middle = paragraphs.slice(2, paragraphs.length - 1).join('\\n\\n');
    if (!middle) return [first, last];
    return [first, middle, last];
  }

  // Render bot welcome messages as a staged sequence:
  //   typing 600ms → bubble 1 (animated) → 380ms pause → typing 420ms →
  //   bubble 2 → pause → typing → bubble 3 (with stagger-animated buttons)
  // Persists chat state at the end so a refresh restores the conversation
  // without replaying the animation.
  async function renderWelcomeFlow(botMessages) {
    if (prefersReducedMotion()) {
      botMessages.forEach(function (m) {
        if (m.ts > lastTs) lastTs = m.ts;
        messages.push(m);
        renderBubble(m);
      });
      persist();
      return;
    }

    // Flatten messages → staged chunks (with metadata about which is last).
    var allChunks = [];
    for (var mi = 0; mi < botMessages.length; mi++) {
      var m = botMessages[mi];
      var chunks = splitWelcomeForStaging(m.text || '');
      for (var ci = 0; ci < chunks.length; ci++) {
        var isLastOfMsg = (ci === chunks.length - 1);
        var isLastOverall = isLastOfMsg && (mi === botMessages.length - 1);
        allChunks.push({
          src: m, text: chunks[ci], idx: ci, isLastOfMsg: isLastOfMsg, isLastOverall: isLastOverall,
        });
      }
    }

    // Initial typing while user "registers" the chrome (~700ms feels right).
    showTyping();
    await sleep(700);
    hideTyping();

    for (var i = 0; i < allChunks.length; i++) {
      var ch = allChunks[i];
      var chunkMsg = {
        role: 'bot',
        id: ch.src.id + '-c' + ch.idx,
        ts: ch.src.ts,
        text: ch.text,
        parseMode: ch.src.parseMode || 'HTML',
        // Buttons + photo only ride along on the chunk that is logically
        // "last" within the source message — keeps the welcome CTA intact.
        buttons: ch.isLastOfMsg ? ch.src.buttons : null,
        photo: ch.idx === 0 ? ch.src.photo : null,
        editMessageId: null,
      };
      // Persist the source ts so polling doesn't re-deliver this chunk.
      if (ch.src.ts > lastTs) lastTs = ch.src.ts;
      messages.push(chunkMsg);
      renderBubble(chunkMsg, { animate: true, staggerButtons: ch.isLastOfMsg && !!ch.src.buttons });

      if (!ch.isLastOverall) {
        // Brief settle, then typing for the next chunk.
        await sleep(380);
        showTyping();
        await sleep(420);
        hideTyping();
      } else if (ch.src.buttons && ch.src.buttons.length) {
        // Last bubble has buttons — wait for them to finish staggering in
        // before we end the welcome flow + reveal the composer.
        var totalBtns = ch.src.buttons.reduce(function (n, row) { return n + (row ? row.length : 0); }, 0);
        await sleep(Math.min(120 + totalBtns * 100, 700));
      }
    }

    persist();
  }

  var _initRetries = 0;
  var _initRetryTimer = null;
  var _initInFlight = false;
  var _initStopped = false;
  var _visibilityRetryPending = false;
  var MAX_INIT_RETRIES = 3;

  function scheduleInitRetry(delayMs) {
    if (_initRetryTimer) { clearTimeout(_initRetryTimer); _initRetryTimer = null; }
    // Background-tab guard: if hidden, defer until the tab is visible again
    // so we don't burn the rate-limit budget while the user isn't looking.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (!_visibilityRetryPending) {
        _visibilityRetryPending = true;
        var onVis = function () {
          if (document.visibilityState !== 'visible') return;
          document.removeEventListener('visibilitychange', onVis);
          _visibilityRetryPending = false;
          if (!_initStopped) init();
        };
        document.addEventListener('visibilitychange', onVis);
      }
      return;
    }
    _initRetryTimer = setTimeout(function () {
      _initRetryTimer = null;
      if (!_initStopped) init();
    }, delayMs);
  }

  async function init() {
    if (_initInFlight || _initStopped) return;
    var persisted = loadPersisted();
    if (persisted) {
      sessionId = persisted.sessionId;
      lastTs = persisted.lastTs || 0;
      // Restore salon branding so the avatar/name are correct without a network call.
      if (persisted.branding) applyBranding(persisted.branding);
      (persisted.messages || []).forEach(function (m) {
        messages.push(m);
        renderBubble(m);
      });
      return;
    }
    _initInFlight = true;
    // Fresh session — play the staged "living chat" welcome animation.
    root.classList.add('mb-init-pending');
    setHeaderTypingState(true);
    try {
      var initResp = await postJson('/chat/init', { slug: SLUG });
      var res = initResp && initResp.data;
      if (!res || !res.ok) {
        var err = new Error((res && res.error) || 'init failed');
        err.status = initResp && initResp.status;
        err.retryAfterHeader = initResp && initResp.retryAfter;
        err.retryAfterBody = res && res.retryAfter;
        err.errorCode = res && res.error;
        throw err;
      }
      sessionId = res.sessionId;
      if (res.salon) applyBranding(res.salon);
      _initRetries = 0;
      if (_initRetryTimer) { clearTimeout(_initRetryTimer); _initRetryTimer = null; }
      persist();

      // Issue /start and let the staged renderer take over the response.
      // We bypass sendRaw() so the messages aren't rendered immediately.
      var startResp = await postJson('/chat/send', {
        slug: SLUG, sessionId: sessionId, userLang: LANG, text: '/start',
      });
      var startRes = startResp && startResp.data;
      if (!startRes || !startRes.ok) {
        var serr = new Error((startRes && startRes.error) || 'start failed');
        serr.status = startResp && startResp.status;
        serr.retryAfterHeader = startResp && startResp.retryAfter;
        serr.retryAfterBody = startRes && startRes.retryAfter;
        serr.errorCode = startRes && startRes.error;
        throw serr;
      }
      var botMessages = (startRes.messages || []).map(function (m) {
        m.role = 'bot';
        return m;
      });
      await renderWelcomeFlow(botMessages);

      setHeaderTypingState(false);
      root.classList.remove('mb-init-pending');
      persist();
    } catch (e) {
      // Init failed — drop the welcome chrome state so the user isn't stuck
      // on a "typing…" header forever, and reveal the composer for a manual
      // retry after the showErrorBubble.
      setHeaderTypingState(false);
      root.classList.remove('mb-init-pending');
      hideTyping();
      console.error('[mb-demo] init failed:', e);

      var status = e && e.status;
      var isRateLimited = status === 429 || (e && e.errorCode === 'rate_limited');
      var isPermanent = status === 400 || status === 404 || status === 410;
      _initRetries++;

      if (_initRetries === 1) showErrorBubble(T.initFailed);

      if (isPermanent || _initRetries > MAX_INIT_RETRIES) {
        // Stop retrying. Composer stays usable for manual retry.
        _initStopped = true;
        if (_initRetryTimer) { clearTimeout(_initRetryTimer); _initRetryTimer = null; }
        return;
      }

      var backoff = Math.min(2000 * Math.pow(2, _initRetries - 1), 30000);
      var delay = backoff;
      if (isRateLimited) {
        var raBody = Number(e && e.retryAfterBody) || 0;
        var raHdr = Number(e && e.retryAfterHeader) || 0;
        // Server gives seconds; convert to ms. Cap at 60s.
        var raMs = Math.max(raBody, raHdr) * 1000;
        delay = Math.min(60000, Math.max(backoff, raMs));
      }
      scheduleInitRetry(delay);
    } finally {
      _initInFlight = false;
    }
  }

  function showTyping() {
    hideTyping();
    var el = document.createElement('div');
    el.className = 'mb-typing';
    el.id = 'mb-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    feed.appendChild(el);
    scrollToBottom();
  }
  function hideTyping() {
    var t = document.getElementById('mb-typing');
    if (t) t.remove();
  }

  async function sendRaw(payload) {
    if (sending || !sessionId) return;
    sending = true;
    sendBtn.disabled = true;
    showTyping();
    try {
      var resp = await postJson('/chat/send', Object.assign({
        slug: SLUG, sessionId: sessionId, userLang: LANG,
      }, payload));
      var res = resp && resp.data;
      hideTyping();
      if (!res || !res.ok) {
        console.warn('[mb-demo] send error:', res);
        showErrorBubble(T.sendError);
        return;
      }
      (res.messages || []).forEach(function (m) {
        m.role = 'bot';
        if (m.ts > lastTs) lastTs = m.ts;
        messages.push(m);
        // Fresh bot reply — fade+slide-up entrance for that "alive" feel.
        renderBubble(m, { animate: true });
      });
      persist();
    } catch (e) {
      hideTyping();
      console.error('[mb-demo] send failed:', e);
      showErrorBubble(T.netError);
    }
    finally { sending = false; sendBtn.disabled = false; input.focus(); }
  }

  function renderUserEcho(text) {
    var msg = {
      role: 'user',
      id: 'local-' + Date.now(),
      ts: Math.floor(Date.now() / 1000),
      text: escapeHtml(text),
      parseMode: 'HTML',
      buttons: null, photo: null, editMessageId: null,
    };
    messages.push(msg);
    renderBubble(msg, { animate: true });
    persist();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function sanitizeBotHtml(html, parseMode) {
    if (parseMode !== 'HTML') return escapeHtml(html).replace(/\\n/g, '<br>');
    var escaped = escapeHtml(html);
    // #S14 — use character class [/] instead of \\/ to avoid the template
    // literal → regex-literal escape ambiguity. Allow HTML entities (&amp;
    // &quot; etc.) inside tag attributes so that <a href="...?a=1&amp;b=2">
    // is correctly un-escaped rather than shown raw.
    escaped = escaped.replace(/&lt;([/]?)(b|strong|i|em|u|s|code|pre|br|a)(\\s(?:[^&]|&(?:amp|quot|lt|gt|apos|#\\d+);)*)?&gt;/gi, function (m) {
      var unescaped = m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      // #S-15 — anchor sanitization runs in two passes so that pathological
      // hrefs containing inner ">" (e.g. data:text/html,<script>...) cannot
      // hide unsafe protocols inside a non-greedy tag split. Pass 1 rewrites
      // any unsafe href value to "#" across the whole string. Pass 2 finds
      // the opening <a tag and adds rel/target if absent.
      unescaped = unescaped.replace(/\\bhref\\s*=\\s*("([^"]*)"|'([^']*)')/gi, function (full, _quoted, dq, sq) {
        var v = (dq != null ? dq : (sq || '')).trim();
        return /^(https?:\\/\\/|mailto:|tel:)/i.test(v) ? full : 'href="#"';
      });
      unescaped = unescaped.replace(/(<a\\b[^>]*?)(\\s*\\/?>)/i, function (_full, head, tail) {
        var extra = '';
        if (!/\\brel\\s*=/i.test(head)) extra += ' rel="noopener noreferrer nofollow"';
        if (!/\\btarget\\s*=/i.test(head)) extra += ' target="_blank"';
        return head + extra + tail;
      });
      return unescaped;
    });
    return escaped.replace(/\\n/g, '<br>');
  }

  function isEmptyMessage(m) {
    // The bot sometimes emits a zero-width-space placeholder for layout
    // reasons; rendering it as a bubble leaves a tiny grey pill in the feed.
    var hasText = m && m.text && String(m.text).replace(/[\\s\\u200b-\\u200f\\ufeff]/g, '').length > 0;
    var hasPhoto = !!(m && m.photo);
    var hasButtons = m && m.buttons && m.buttons.some(function (row) { return row && row.length > 0; });
    return !hasText && !hasPhoto && !hasButtons;
  }

  function renderBubble(m, opts) {
    if (m.editMessageId && bubbles.has(m.editMessageId)) {
      var old = bubbles.get(m.editMessageId);
      var fresh = buildBubbleNode(m, opts);
      old.replaceWith(fresh);
      bubbles.set(m.id, fresh);
      if (m.id !== m.editMessageId) bubbles.delete(m.editMessageId);
      scrollToBottom();
      return;
    }
    if (bubbles.has(m.id)) return;
    if (isEmptyMessage(m)) return;
    var node = buildBubbleNode(m, opts);
    if (opts && opts.animate) node.classList.add('mb-anim-in');
    bubbles.set(m.id, node);
    feed.appendChild(node);
    scrollToBottom();
  }

  function buildBubbleNode(m, opts) {
    var div = document.createElement('div');
    div.className = 'mb-bubble ' + (m.role === 'user' ? 'user' : 'bot');
    div.dataset.id = m.id;
    if (m.photo) {
      var img = document.createElement('img');
      img.src = m.photo; img.alt = ''; img.loading = 'lazy';
      div.appendChild(img);
    }
    if (m.text) {
      var textWrap = document.createElement('div');
      textWrap.innerHTML = m.role === 'user' ? escapeHtml(m.text) : sanitizeBotHtml(m.text, m.parseMode);
      div.appendChild(textWrap);
    }
    if (m.buttons && m.buttons.length) {
      var btnWrap = document.createElement('div');
      btnWrap.className = 'mb-btns' + (opts && opts.staggerButtons ? ' mb-stagger' : '');
      // Map Telegram-row groupings to web-native chip layout:
      //   • Multi-button rows (◀ 2/2 ▶) → one .mb-btn-row (inline flex).
      //   • Runs of consecutive single-button rows (8 date pickers from
      //     the bot) → coalesced into ONE .mb-btn-row.mb-btn-row-grid that
      //     wraps. That makes a date list read as a calendar grid
      //     instead of a stack of Telegram inline-keyboard pills.
      var i = 0;
      var rows = m.buttons;
      function makeBtn(b) {
        var btn;
        if (b.url) {
          btn = document.createElement('a');
          btn.href = b.url; btn.target = '_blank'; btn.rel = 'noopener noreferrer';
        } else {
          btn = document.createElement('button');
          btn.type = 'button';
        }
        btn.className = 'mb-btn';
        btn.textContent = b.text;
        if (b.callback_data) {
          btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            sendRaw({ callbackData: b.callback_data, messageId: m.id });
          });
        }
        return btn;
      }
      while (i < rows.length) {
        var row = rows[i];
        if (!row || !row.length) { i++; continue; }
        // Coalesce a run of single-button rows into one wrap-grid (≥2 in a row).
        if (row.length === 1 && i + 1 < rows.length && rows[i + 1] && rows[i + 1].length === 1) {
          var grid = document.createElement('div');
          grid.className = 'mb-btn-row mb-btn-row-grid';
          while (i < rows.length && rows[i] && rows[i].length === 1) {
            grid.appendChild(makeBtn(rows[i][0]));
            i++;
          }
          btnWrap.appendChild(grid);
          continue;
        }
        // Otherwise: one row = one inline-flex container.
        var rowEl = document.createElement('div');
        rowEl.className = 'mb-btn-row';
        if (row.length === 1) rowEl.classList.add('mb-btn-row-solo');
        row.forEach(function (b) { rowEl.appendChild(makeBtn(b)); });
        btnWrap.appendChild(rowEl);
        i++;
      }
      div.appendChild(btnWrap);
    }
    return div;
  }

  function scrollToBottom() { feed.scrollTop = feed.scrollHeight; }

  composer.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    renderUserEcho(text);
    sendRaw({ text: text });
  });

  setInterval(async function () {
    if (document.hidden || !sessionId) return;
    try {
      var r = await fetch(
        ORIGIN + '/chat/poll?slug=' + encodeURIComponent(SLUG) +
          '&sessionId=' + encodeURIComponent(sessionId) +
          '&since=' + lastTs,
      );
      if (!r.ok) {
        _pollFails++;
        // Show offline indicator after 5 consecutive failures (~15s).
        if (_pollFails === 5) setStatus(T.offline, false);
        return;
      }
      // Recover from offline state on next successful poll.
      if (_pollFails >= 5) setStatus(T.online, true);
      _pollFails = 0;
      var d = await r.json();
      if (d && d.ok && d.messages && d.messages.length) {
        d.messages.forEach(function (m) {
          m.role = 'bot';
          if (m.ts > lastTs) lastTs = m.ts;
          messages.push(m);
          renderBubble(m, { animate: true });
        });
        persist();
      }
    } catch (_) {
      _pollFails++;
      if (_pollFails === 5) setStatus(T.offline, false);
    }
  }, POLL_MS);

  init();
})();
`;
