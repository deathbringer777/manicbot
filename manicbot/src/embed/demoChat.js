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
  var scriptEl = document.currentScript;
  if (!scriptEl) return;
  var ORIGIN = new URL(scriptEl.src).origin;
  var SLUG = scriptEl.dataset.slug || 'preview-landing';
  var TARGET = scriptEl.dataset.target || '#mb-demo';
  var LANG = scriptEl.dataset.lang || 'ru';
  var STORAGE_KEY = 'mb.chat.' + SLUG;
  var POLL_MS = 3000;
  var HISTORY_CAP = 200;

  var root = document.querySelector(TARGET);
  if (!root) { console.warn('[mb-demo] target not found:', TARGET); return; }

  var styleTag = document.createElement('style');
  styleTag.textContent =
    '.mb-demo{display:flex;flex-direction:column;height:100%;min-height:320px;font:14px system-ui,sans-serif;color:#0f172a;overflow:hidden;background:transparent}' +
    '.mb-demo-feed{flex:1 1 auto;overflow-y:auto;padding:12px 12px 4px;display:flex;flex-direction:column;gap:8px}' +
    '.mb-bubble{max-width:82%;padding:9px 12px;border-radius:16px;line-height:1.35;word-wrap:break-word}' +
    '.mb-bubble.bot{align-self:flex-start;background:var(--mb-bubble-bot,#f1f5f9);color:var(--mb-bot-text,#0f172a);border-bottom-left-radius:6px}' +
    '.mb-bubble.user{align-self:flex-end;background:var(--mb-bubble-user,#8b5cf6);color:var(--mb-user-text,#fff);border-bottom-right-radius:6px}' +
    '.mb-bubble img{max-width:100%;border-radius:10px;margin:-2px 0 6px;display:block}' +
    '.mb-btns{display:flex;flex-direction:column;gap:6px;margin-top:8px}' +
    '.mb-btn{display:block;padding:8px 12px;text-align:center;border:1px solid var(--mb-btn-border,#e2e8f0);background:var(--mb-btn-bg,#fff);color:inherit;border-radius:12px;cursor:pointer;font:inherit;transition:background .15s;text-decoration:none}' +
    '.mb-btn:hover{background:var(--mb-btn-hover,#f8fafc)}' +
    '.mb-composer{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--mb-composer-border,rgba(15,23,42,.08));background:var(--mb-composer-bg,transparent)}' +
    '.mb-composer input{flex:1;border:1px solid var(--mb-btn-border,#e2e8f0);border-radius:999px;padding:9px 14px;font:inherit;background:var(--mb-input-bg,#fff);color:inherit;outline:none}' +
    '.mb-composer input:focus{border-color:var(--mb-bubble-user,#8b5cf6)}' +
    '.mb-composer button{border:0;background:var(--mb-bubble-user,#8b5cf6);color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:16px}' +
    '.mb-composer button:disabled{opacity:.4;cursor:not-allowed}' +
    '.mb-typing{align-self:flex-start;padding:6px 10px;border-radius:12px;background:var(--mb-bubble-bot,#f1f5f9);display:inline-flex;gap:3px}' +
    '.mb-typing span{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:mb-bounce 1s infinite}' +
    '.mb-typing span:nth-child(2){animation-delay:.15s}.mb-typing span:nth-child(3){animation-delay:.3s}' +
    '@keyframes mb-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}';
  document.head.appendChild(styleTag);

  root.classList.add('mb-demo');
  var feed = document.createElement('div');
  feed.className = 'mb-demo-feed';
  var composer = document.createElement('form');
  composer.className = 'mb-composer';
  composer.innerHTML =
    '<input type="text" placeholder="Сообщение…" autocomplete="off" />' +
    '<button type="submit" aria-label="Send">&#10148;</button>';
  root.appendChild(feed);
  root.appendChild(composer);

  var input = composer.querySelector('input');
  var sendBtn = composer.querySelector('button');

  var sessionId = null;
  var lastTs = 0;
  var bubbles = new Map();
  var messages = [];
  var sending = false;

  function loadPersisted() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !p.sessionId) return null;
      return p;
    } catch (_) { return null; }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId: sessionId, lastTs: lastTs, messages: messages.slice(-HISTORY_CAP),
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

  async function init() {
    var persisted = loadPersisted();
    if (persisted) {
      sessionId = persisted.sessionId;
      lastTs = persisted.lastTs || 0;
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
      persist();
      await sendRaw({ text: '/start', userLang: LANG });
    } catch (e) { console.error('[mb-demo] init failed:', e); }
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
      if (!res || !res.ok) { console.warn('[mb-demo] send error:', res); return; }
      (res.messages || []).forEach(function (m) {
        m.role = 'bot';
        if (m.ts > lastTs) lastTs = m.ts;
        messages.push(m);
        renderBubble(m);
      });
      persist();
    } catch (e) { hideTyping(); console.error('[mb-demo] send failed:', e); }
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
    escaped = escaped.replace(/&lt;(\\/?)(b|strong|i|em|u|s|code|pre|br|a)(\\s[^&]*)?&gt;/gi, function (m) {
      return m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    });
    return escaped.replace(/\\n/g, '<br>');
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
      if (!r.ok) return;
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
    } catch (_) {}
  }, POLL_MS);

  init();
})();
`;
