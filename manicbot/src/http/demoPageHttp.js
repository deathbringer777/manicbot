/**
 * Standalone /demo page — iPhone mockup with the embedded chat widget.
 *
 * Served directly by the Worker so it works without the external marketing
 * landing SPA. The page loads /embed/demo-chat.js which talks to the
 * preview-landing tenant (auto-provisioned on first request).
 *
 * The landing SPA can also integrate the widget directly with one script tag:
 *   <div id="mb-demo"></div>
 *   <script src="https://manicbot.com/embed/demo-chat.js"
 *           data-slug="preview-landing" data-target="#mb-demo"
 *           data-lang="ru"></script>
 */

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ManicBot — Демо</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%}
    body{
      min-height:100dvh;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      background:linear-gradient(135deg,#faf5ff 0%,#ede9fe 50%,#f0f9ff 100%);
      font-family:system-ui,-apple-system,sans-serif;
      padding:32px 16px;
      gap:28px;
    }
    .brand{text-align:center}
    .brand h1{font-size:1.9rem;font-weight:800;color:#0f172a;letter-spacing:-.03em}
    .brand h1 span{color:#8b5cf6}
    .brand p{color:#64748b;margin-top:6px;font-size:1rem;line-height:1.5}

    /* iPhone 14 Pro style frame */
    .iphone{
      position:relative;
      width:300px;
      background:#18181b;
      border-radius:50px;
      padding:14px 8px 20px;
      box-shadow:
        0 0 0 2px #3f3f46,
        0 0 0 4px #18181b,
        0 40px 100px rgba(0,0,0,.4),
        inset 0 0 0 1px rgba(255,255,255,.06);
      flex-shrink:0;
    }
    /* Dynamic island */
    .iphone::before{
      content:'';
      position:absolute;
      top:16px;
      left:50%;
      transform:translateX(-50%);
      width:88px;height:26px;
      background:#18181b;
      border-radius:20px;
      z-index:20;
    }
    .iphone-screen{
      background:#fff;
      border-radius:42px;
      overflow:hidden;
      height:570px;
      display:flex;
      flex-direction:column;
    }
    /* Dynamic Island pill: top:16 + height:26 = bottom at 42px from frame top.
       iphone padding-top is 14px, so pill bottom inside screen = 28px.
       We give status-bar padding-top of max(env(safe-area-inset-top),56px)
       so desktop (where safe-area-inset-top is 0, not undefined — env fallback
       does NOT apply) still clears the pill with ~28px breathing room. */
    .status-bar{
      min-height:46px;
      background:#fff;
      display:flex;
      align-items:flex-end;
      justify-content:space-between;
      padding-top:56px;
      padding-top:max(env(safe-area-inset-top),56px);
      padding-right:22px;
      padding-bottom:8px;
      padding-left:22px;
      font-size:11px;
      font-weight:700;
      color:#0f172a;
      flex-shrink:0;
      position:relative;
      z-index:10;
    }
    .status-bar .icons{display:flex;gap:5px;align-items:center}
    .status-bar svg{width:14px;height:14px;fill:currentColor}
    /* Chat app header — extra top padding keeps content clear of status-bar below island */
    .chat-header{
      background:#fff;
      border-bottom:1px solid #f1f5f9;
      padding:10px 14px 8px 14px;
      display:flex;
      align-items:center;
      gap:10px;
      flex-shrink:0;
    }
    .chat-header .avatar{
      width:34px;height:34px;border-radius:50%;
      background:linear-gradient(135deg,#8b5cf6,#ec4899);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:16px;flex-shrink:0;
    }
    .chat-header .info{flex:1;min-width:0}
    .chat-header .info strong{display:block;font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .chat-header .info small{font-size:11px;color:#22c55e;font-weight:500}
    #mb-demo{flex:1;min-height:0;overflow:hidden}

    .note{
      text-align:center;
      max-width:300px;
      color:#64748b;
      font-size:.85rem;
      line-height:1.6;
    }
    .note strong{color:#8b5cf6}

    @media(max-width:380px){
      .iphone{width:272px}
      .brand h1{font-size:1.6rem}
    }
    @media(min-height:900px){
      .iphone-screen{height:620px}
    }

    /* Dark mode — match the system theme so the mockup doesn't look broken
       when the landing page is dark. Phone frame stays dark (same brand),
       but the iPhone screen, status bar, and chat header flip. */
    @media(prefers-color-scheme:dark){
      body{
        background:linear-gradient(135deg,#1e1b4b 0%,#1e293b 50%,#0c4a6e 100%);
      }
      .brand h1{color:#f1f5f9}
      .brand h1 span{color:#a78bfa}
      .brand p{color:#94a3b8}
      .iphone{
        background:#000;
        box-shadow:
          0 0 0 2px #27272a,
          0 0 0 4px #000,
          0 40px 100px rgba(0,0,0,.6),
          inset 0 0 0 1px rgba(255,255,255,.06);
      }
      .iphone::before{background:#000}
      .iphone-screen{background:#0a0a0a}
      .status-bar{background:#0a0a0a;color:#f1f5f9}
      .chat-header{background:#0a0a0a;border-bottom-color:#27272a}
      .chat-header .info strong{color:#f1f5f9}
      .note{color:#94a3b8}
      .note strong{color:#a78bfa}
    }
  </style>
</head>
<body>
  <div class="brand">
    <h1>Manic<span>Bot</span></h1>
    <p>Умный бот записи в салон красоты</p>
  </div>

  <div class="iphone" role="presentation" aria-label="Демо чат-бота">
    <div class="iphone-screen">
      <div class="status-bar">
        <span>9:41</span>
        <div class="icons">
          <!-- signal bars -->
          <svg viewBox="0 0 16 12"><rect x="0" y="8" width="3" height="4" rx=".5"/><rect x="4.5" y="5" width="3" height="7" rx=".5"/><rect x="9" y="2" width="3" height="10" rx=".5"/><rect x="13.5" y="0" width="2.5" height="12" rx=".5" opacity=".3"/></svg>
          <!-- wifi -->
          <svg viewBox="0 0 16 12"><path d="M8 9.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-4a6 6 0 014.24 1.76l-1.42 1.42A4 4 0 008 7.5a4 4 0 00-2.82 1.18L3.76 7.26A6 6 0 018 5.5zm0-4a10 10 0 017.07 2.93L13.65 5.85A8 8 0 008 3.5a8 8 0 00-5.65 2.35L.93 4.43A10 10 0 018 1.5z"/></svg>
          <!-- battery -->
          <svg viewBox="0 0 22 12"><rect x="0" y="1" width="18" height="10" rx="2" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="18.5" y="3.5" width="2" height="5" rx="1" fill="currentColor" opacity=".5"/><rect x="1.5" y="2.5" width="13" height="7" rx="1" fill="currentColor"/></svg>
        </div>
      </div>
      <div class="chat-header">
        <div class="avatar">💅</div>
        <div class="info">
          <strong>Preview Salon</strong>
          <small>● онлайн</small>
        </div>
      </div>
      <div id="mb-demo"></div>
    </div>
  </div>

  <p class="note">
    Живое демо — попробуйте записаться,<br>
    посмотреть каталог и прайс.<br>
    <strong>Реальные данные не сохраняются.</strong>
  </p>

  <script src="/embed/demo-chat.js"
          data-slug="preview-landing"
          data-target="#mb-demo"
          data-lang="ru"></script>
</body>
</html>`;

// #S13 — restrict resources to same origin. Inline <style> is required by the
// current HTML, so style-src allows 'unsafe-inline'. Images/logos can come from
// external CDNs (salon logos stored on R2/generic https). connect-src 'self'
// since the widget talks only to /chat/* on the script's own origin.
const DEMO_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

export function tryDemoPage(request, env, url) {
  if (url.pathname !== '/demo') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  return new Response(HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': DEMO_CSP,
      // Allow same-origin framing so the landing page can embed via <iframe>
      // without the full X-Frame-Options: DENY restriction applied to admin pages.
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
