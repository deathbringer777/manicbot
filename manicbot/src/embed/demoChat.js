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
  var SLUG = scriptEl.dataset.slug || 'preview-landing';
  var TARGET = scriptEl.dataset.target || '#mb-demo';
  var LANG = scriptEl.dataset.lang || 'ru';
  var TITLE = scriptEl.dataset.title || 'Preview Salon';
  var SHOW_HEADER = scriptEl.dataset.showHeader === '1';
  var I18N = {
    ru: { placeholder: 'Сообщение…', online: 'онлайн', send: 'Отправить',
          offline: 'нет связи', reconnecting: 'подключение…',
          initFailed: 'Не удалось подключиться. Повторная попытка…',
          sendError: 'Ошибка отправки. Попробуйте ещё раз.',
          netError: 'Нет соединения. Проверьте интернет.' },
    ua: { placeholder: 'Повідомлення…', online: 'онлайн', send: 'Надіслати',
          offline: "немає зв'язку", reconnecting: 'підключення…',
          initFailed: 'Не вдалося підключитися. Повторна спроба…',
          sendError: 'Помилка відправки. Спробуйте ще раз.',
          netError: "Немає з'єднання. Перевірте інтернет." },
    en: { placeholder: 'Message…', online: 'online', send: 'Send',
          offline: 'offline', reconnecting: 'reconnecting…',
          initFailed: 'Connection failed. Retrying…',
          sendError: 'Send failed. Please try again.',
          netError: 'No connection. Check your internet.' },
    pl: { placeholder: 'Wiadomość…', online: 'online', send: 'Wyślij',
          offline: 'brak połączenia', reconnecting: 'łączenie…',
          initFailed: 'Błąd połączenia. Ponowna próba…',
          sendError: 'Błąd wysyłania. Spróbuj ponownie.',
          netError: 'Brak połączenia. Sprawdź internet.' },
  };
  var T = I18N[LANG] || I18N.ru;
  function escAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  var STORAGE_KEY = 'mb.chat.' + SLUG;
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
    '.mb-demo{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;font:12px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;overflow:hidden;' +
      '--mb-island-clear:0px;' +
      '--mb-bg:#ffffff;' +
      '--mb-fg:#1a1a1a;' +
      '--mb-muted:#64748b;' +
      '--mb-surface:#f5f5f5;' +
      '--mb-border:#e0e0e0;' +
      '--mb-statusbar-bg:#ffffff;' +
      '--mb-statusbar-fg:#1a1a1a;' +
      '--mb-header-bg:#ffffff;' +
      '--mb-bubble-bot:#f1f5f9;' +
      '--mb-bot-text:#1a1a1a;' +
      '--mb-bubble-user:#8b5cf6;' +
      '--mb-user-text:#ffffff;' +
      '--mb-btn-bg:#ffffff;' +
      '--mb-btn-text:#1a1a1a;' +
      '--mb-btn-border:#d0d0d0;' +
      '--mb-btn-hover:#f5f5f5;' +
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
      '--mb-border:#3a3a3c;' +
      '--mb-statusbar-bg:#000000;' +
      '--mb-statusbar-fg:#ffffff;' +
      '--mb-header-bg:#1c1c1e;' +
      '--mb-bubble-bot:#2c2c2e;' +
      '--mb-bot-text:#ffffff;' +
      '--mb-btn-bg:#2c2c2e;' +
      '--mb-btn-text:#ffffff;' +
      '--mb-btn-border:#48484a;' +
      '--mb-btn-hover:#3a3a3c;' +
      '--mb-input-bg:#2c2c2e;' +
      '--mb-input-text:#ffffff;' +
      '--mb-input-placeholder:#8e8e93;' +
      '--mb-composer-border:#3a3a3c}' +
    // SHOW_HEADER widgets sit inside an iPhone mockup whose Dynamic Island
    // pill overlaps the screen's top ~32-40px. Push statusbar down to clear it.
    '.mb-demo.mb-with-header{--mb-island-clear:38px}' +
    // iPhone-style status bar (time + signal/battery)
    '.mb-statusbar{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--mb-island-clear) + 6px) 14px 2px;font-size:10.5px;font-weight:600;color:var(--mb-statusbar-fg);flex-shrink:0;background:var(--mb-statusbar-bg);position:relative;z-index:3}' +
    '.mb-statusbar .icons{display:inline-flex;gap:4px;align-items:center;opacity:.88}' +
    '.mb-statusbar svg{width:14px;height:10px;display:block}' +
    // Header — slightly taller avatar (32px) for logo images to read well
    '.mb-header{display:flex;align-items:center;gap:8px;padding:4px 12px 8px;border-bottom:1px solid var(--mb-border);background:var(--mb-header-bg);flex-shrink:0;position:relative;z-index:2}' +
    '.mb-header-av{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#ec4899);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:14px;font-weight:700;flex-shrink:0;overflow:hidden}' +
    '.mb-header-meta{display:flex;flex-direction:column;min-width:0;flex:1}' +
    '.mb-header-name{font-size:12px;font-weight:600;color:var(--mb-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}' +
    // Status dot uses currentColor so toggling .mb-offline changes both text and dot in one step.
    '.mb-header-status{font-size:10px;color:#22c55e;font-weight:500;line-height:1.2;display:inline-flex;align-items:center;gap:3px;transition:color .3s}' +
    '.mb-header-status::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}' +
    '.mb-header-status.mb-offline{color:var(--mb-muted)}' +
    // Feed + bubbles (tighter spacing to fit inside iPhone screen)
    '.mb-demo-feed{flex:1 1 auto;overflow-y:auto;padding:8px 10px 4px;display:flex;flex-direction:column;gap:5px;-webkit-overflow-scrolling:touch;background:var(--mb-bg)}' +
    '.mb-demo-feed::-webkit-scrollbar{width:0;height:0}' +
    '.mb-bubble{max-width:86%;padding:6px 10px;border-radius:14px;line-height:1.35;word-wrap:break-word;font-size:11.5px}' +
    '.mb-bubble.bot{align-self:flex-start;background:var(--mb-bubble-bot);color:var(--mb-bot-text);border-bottom-left-radius:4px}' +
    '.mb-bubble.user{align-self:flex-end;background:var(--mb-bubble-user);color:var(--mb-user-text);border-bottom-right-radius:4px}' +
    '.mb-bubble img{max-width:100%;border-radius:8px;margin:-1px 0 4px;display:block}' +
    '.mb-btns{display:flex;flex-direction:column;gap:4px;margin-top:5px}' +
    // Buttons use explicit --mb-btn-text (not color:inherit) so the label
    // stays readable regardless of the surrounding bubble's text colour.
    '.mb-btn{display:block;padding:6px 10px;text-align:center;border:1px solid var(--mb-btn-border);background:var(--mb-btn-bg);color:var(--mb-btn-text);border-radius:10px;cursor:pointer;font:inherit;font-size:11px;transition:background .15s;text-decoration:none}' +
    '.mb-btn:hover{background:var(--mb-btn-hover)}' +
    // Composer — compact, fits nicely at the bottom of the iPhone screen
    '.mb-composer{display:flex;gap:6px;padding:6px 8px 8px;border-top:1px solid var(--mb-composer-border);background:var(--mb-bg);flex-shrink:0}' +
    '.mb-composer input{flex:1;min-width:0;border:1px solid var(--mb-btn-border);border-radius:999px;padding:7px 12px;font:inherit;font-size:11.5px;background:var(--mb-input-bg);color:var(--mb-input-text);outline:none}' +
    '.mb-composer input::placeholder{color:var(--mb-input-placeholder)}' +
    '.mb-composer input:focus{border-color:var(--mb-bubble-user)}' +
    '.mb-composer button{flex-shrink:0;border:0;background:var(--mb-bubble-user);color:var(--mb-user-text);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center}' +
    '.mb-composer button:disabled{opacity:.4;cursor:not-allowed}' +
    '.mb-typing{align-self:flex-start;padding:5px 9px;border-radius:12px;background:var(--mb-bubble-bot);display:inline-flex;gap:3px}' +
    '.mb-typing span{width:5px;height:5px;border-radius:50%;background:var(--mb-muted);animation:mb-bounce 1s infinite}' +
    '.mb-typing span:nth-child(2){animation-delay:.15s}.mb-typing span:nth-child(3){animation-delay:.3s}' +
    '@keyframes mb-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}';
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
        // signal bars
        '<svg viewBox="0 0 18 10" fill="currentColor"><rect x="0"  y="7" width="3" height="3" rx=".5"/><rect x="5"  y="5" width="3" height="5" rx=".5"/><rect x="10" y="2" width="3" height="8" rx=".5"/><rect x="15" y="0" width="3" height="10" rx=".5"/></svg>' +
        // wifi
        '<svg viewBox="0 0 14 10" fill="currentColor"><path d="M7 10a1.3 1.3 0 1 0 0-2.6A1.3 1.3 0 0 0 7 10Zm-3.2-3.1 1.1 1.1A3 3 0 0 1 7 7a3 3 0 0 1 2.1.8l1.1-1.1a4.6 4.6 0 0 0-6.4 0ZM1 4l1.1 1.1a7 7 0 0 1 9.8 0L13 4A8.6 8.6 0 0 0 1 4Z"/></svg>' +
        // battery
        '<svg viewBox="0 0 22 10" fill="none" stroke="currentColor" stroke-width="1"><rect x=".5" y=".5" width="18" height="9" rx="2"/><rect x="2" y="2" width="14" height="6" rx="1" fill="currentColor" stroke="none"/><rect x="19.5" y="3.5" width="1.5" height="3" rx=".5" fill="currentColor" stroke="none"/></svg>' +
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
    if (headerNameEl && salon.name) {
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
    return r.json();
  }

  function showErrorBubble(text) {
    var div = document.createElement('div');
    div.className = 'mb-bubble bot';
    div.style.cssText = 'color:#ef4444;background:#fef2f2;border:1px solid #fecaca';
    div.textContent = text;
    feed.appendChild(div);
    scrollToBottom();
  }

  var _initRetries = 0;
  var _initRetryTimer = null;

  async function init() {
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
    try {
      var res = await postJson('/chat/init', { slug: SLUG });
      if (!res || !res.ok) throw new Error((res && res.error) || 'init failed');
      sessionId = res.sessionId;
      // Update header with real salon name + logo from the server response.
      if (res.salon) applyBranding(res.salon);
      _initRetries = 0;
      persist();
      await sendRaw({ text: '/start', userLang: LANG });
    } catch (e) {
      console.error('[mb-demo] init failed:', e);
      _initRetries++;
      var delay = Math.min(2000 * Math.pow(2, _initRetries - 1), 30000);
      if (_initRetries === 1) {
        showErrorBubble(T.initFailed);
      }
      _initRetryTimer = setTimeout(function () {
        _initRetryTimer = null;
        init();
      }, delay);
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
      var res = await postJson('/chat/send', Object.assign({
        slug: SLUG, sessionId: sessionId, userLang: LANG,
      }, payload));
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
        renderBubble(m);
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
    renderBubble(msg);
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
      return m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
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

  function renderBubble(m) {
    if (m.editMessageId && bubbles.has(m.editMessageId)) {
      var old = bubbles.get(m.editMessageId);
      var fresh = buildBubbleNode(m);
      old.replaceWith(fresh);
      bubbles.set(m.id, fresh);
      if (m.id !== m.editMessageId) bubbles.delete(m.editMessageId);
      scrollToBottom();
      return;
    }
    if (bubbles.has(m.id)) return;
    if (isEmptyMessage(m)) return;
    var node = buildBubbleNode(m);
    bubbles.set(m.id, node);
    feed.appendChild(node);
    scrollToBottom();
  }

  function buildBubbleNode(m) {
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
      btnWrap.className = 'mb-btns';
      m.buttons.forEach(function (row) {
        row.forEach(function (b) {
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
          btnWrap.appendChild(btn);
        });
      });
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
          renderBubble(m);
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
