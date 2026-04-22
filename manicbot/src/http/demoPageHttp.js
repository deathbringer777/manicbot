/**
 * Standalone /demo page — iPhone 15 Pro style mockup with the embedded chat widget.
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
      background:
        radial-gradient(1200px 600px at 20% -10%, #ede9fe 0%, transparent 60%),
        radial-gradient(1000px 500px at 100% 110%, #dbeafe 0%, transparent 55%),
        #faf7ff;
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;
      padding:40px 16px;
      gap:24px;
      color:#0f172a;
    }
    .brand{text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}
    .kicker{
      display:inline-flex;align-items:center;gap:6px;
      padding:4px 10px;border-radius:999px;
      background:rgba(139,92,246,.1);
      color:#7c3aed;
      font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
      border:1px solid rgba(139,92,246,.2);
    }
    .kicker::before{content:"";width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)}
    .brand h1{font-size:2rem;font-weight:900;color:#0f172a;letter-spacing:-.04em;line-height:1}
    .brand h1 span{color:#8b5cf6}
    .brand p{color:#64748b;margin-top:2px;font-size:.95rem;line-height:1.5}

    /* ===== iPhone 15 Pro frame ===== */
    .phone-wrap{
      position:relative;
      flex-shrink:0;
      padding:0 6px 20px;
    }
    .phone-wrap::after{
      /* Floor reflection */
      content:"";
      position:absolute;
      left:10%;right:10%;bottom:-8px;
      height:24px;
      background:radial-gradient(ellipse at center, rgba(15,23,42,.28) 0%, transparent 70%);
      filter:blur(10px);
      z-index:-1;
    }
    .iphone{
      position:relative;
      width:300px;
      padding:10px;
      border-radius:54px;
      background:linear-gradient(145deg,#4a4a4f 0%,#2a2a2e 45%,#1a1a1d 100%);
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,.08),
        inset 0 1px 2px rgba(255,255,255,.15),
        inset 0 -1px 2px rgba(0,0,0,.6),
        0 1px 0 rgba(255,255,255,.05),
        0 30px 60px -20px rgba(15,23,42,.45),
        0 15px 30px -15px rgba(15,23,42,.3);
    }
    .iphone::before{
      /* Frame gloss */
      content:"";
      position:absolute;inset:0;
      border-radius:54px;
      background:linear-gradient(145deg, rgba(255,255,255,.06), transparent 35%);
      pointer-events:none;
      z-index:1;
    }
    /* Side buttons */
    .btn-mute,.btn-vup,.btn-vdn,.btn-pwr{
      position:absolute;
      background:linear-gradient(90deg,#1a1a1d,#2a2a2e 40%,#2a2a2e 60%,#1a1a1d);
      border-radius:2px;
      z-index:0;
    }
    .btn-mute{left:-2px;top:86px;width:3px;height:22px}
    .btn-vup{left:-3px;top:122px;width:4px;height:46px}
    .btn-vdn{left:-3px;top:178px;width:4px;height:46px}
    .btn-pwr{right:-3px;top:150px;width:4px;height:68px;background:linear-gradient(270deg,#1a1a1d,#2a2a2e 40%,#2a2a2e 60%,#1a1a1d)}

    .iphone-screen{
      position:relative;
      background:#fff;
      border-radius:44px;
      overflow:hidden;
      height:600px;
      display:flex;
      flex-direction:column;
      box-shadow:
        inset 0 0 0 2px #000,
        inset 0 1px 0 rgba(255,255,255,.08);
      z-index:2;
    }

    /* Dynamic Island — overlaps the status bar like a real iPhone */
    .island{
      position:absolute;
      top:12px;
      left:50%;transform:translateX(-50%);
      width:102px;height:30px;
      background:#0a0a0a;
      border-radius:20px;
      z-index:30;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.04);
    }
    .island::after{
      /* Camera lens */
      content:"";
      position:absolute;
      top:50%;right:8px;transform:translateY(-50%);
      width:6px;height:6px;border-radius:50%;
      background:radial-gradient(circle at 30% 30%, #1e3a8a 0%, #0a0a0a 70%);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);
    }

    /* Status bar — sits behind/beside the island at the top of the screen */
    .status-bar{
      min-height:44px;
      background:transparent;
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:14px 22px 6px;
      font-size:13px;
      font-weight:600;
      color:#0f172a;
      flex-shrink:0;
      position:relative;
      z-index:10;
    }
    .status-bar .time{padding-left:4px;font-variant-numeric:tabular-nums}
    .status-bar .icons{display:flex;gap:5px;align-items:center;padding-right:4px}
    .status-bar svg{width:15px;height:12px;fill:currentColor}

    /* Chat app header */
    .chat-header{
      background:transparent;
      padding:8px 14px 10px;
      display:flex;
      align-items:center;
      gap:10px;
      flex-shrink:0;
      border-bottom:1px solid rgba(15,23,42,.06);
      position:relative;
      z-index:5;
    }
    .chat-header .avatar{
      width:36px;height:36px;border-radius:50%;
      background:linear-gradient(135deg,#8b5cf6,#ec4899);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:17px;flex-shrink:0;
      box-shadow:0 2px 6px rgba(139,92,246,.25);
      overflow:hidden;
    }
    .chat-header .info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
    .chat-header .info strong{display:block;font-size:14px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}
    .chat-header .info small{font-size:11.5px;color:#22c55e;font-weight:500;display:inline-flex;align-items:center;gap:5px}
    .chat-header .info small::before{content:"";width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.2)}

    #mb-demo{flex:1;min-height:0;overflow:hidden}

    @media(max-width:380px){
      .iphone{width:272px;border-radius:48px}
      .iphone-screen{border-radius:40px;height:548px}
      .brand h1{font-size:1.6rem}
    }
    @media(min-height:900px){
      .iphone-screen{height:640px}
    }

    /* ===== Dark mode ===== */
    @media(prefers-color-scheme:dark){
      body{
        background:
          radial-gradient(1200px 600px at 20% -10%, #312e81 0%, transparent 60%),
          radial-gradient(1000px 500px at 100% 110%, #0c4a6e 0%, transparent 55%),
          #0b0b12;
        color:#f1f5f9;
      }
      .kicker{background:rgba(167,139,250,.12);color:#c4b5fd;border-color:rgba(167,139,250,.25)}
      .brand h1{color:#f8fafc}
      .brand h1 span{color:#a78bfa}
      .brand p{color:#94a3b8}
      .iphone{
        background:linear-gradient(145deg,#3a3a3f 0%,#1a1a1e 50%,#0a0a0d 100%);
        box-shadow:
          inset 0 0 0 1px rgba(255,255,255,.05),
          inset 0 1px 2px rgba(255,255,255,.08),
          inset 0 -1px 2px rgba(0,0,0,.8),
          0 30px 70px -20px rgba(0,0,0,.7),
          0 15px 30px -15px rgba(0,0,0,.5);
      }
      .btn-mute,.btn-vup,.btn-vdn{background:linear-gradient(90deg,#0a0a0d,#1a1a1e 40%,#1a1a1e 60%,#0a0a0d)}
      .btn-pwr{background:linear-gradient(270deg,#0a0a0d,#1a1a1e 40%,#1a1a1e 60%,#0a0a0d)}
      .iphone-screen{background:#0a0a0a;box-shadow:inset 0 0 0 2px #000,inset 0 1px 0 rgba(255,255,255,.04)}
      .status-bar{color:#f1f5f9}
      .chat-header{border-bottom-color:rgba(255,255,255,.05)}
      .chat-header .info strong{color:#f1f5f9}
      .phone-wrap::after{display:none}
    }
  </style>
</head>
<body>
  <div class="brand">
    <span class="kicker">Live demo · данные не сохраняются</span>
    <h1>Manic<span>Bot</span></h1>
    <p>Умный бот записи в салон красоты</p>
  </div>

  <div class="phone-wrap">
    <div class="iphone" role="presentation" aria-label="Демо чат-бота">
      <span class="btn-mute" aria-hidden="true"></span>
      <span class="btn-vup" aria-hidden="true"></span>
      <span class="btn-vdn" aria-hidden="true"></span>
      <span class="btn-pwr" aria-hidden="true"></span>
      <div class="iphone-screen">
        <div class="island" aria-hidden="true"></div>
        <div class="status-bar">
          <span class="time">9:41</span>
          <div class="icons" aria-hidden="true">
            <!-- signal bars -->
            <svg viewBox="0 0 16 12"><rect x="0" y="8" width="3" height="4" rx=".5"/><rect x="4.5" y="5" width="3" height="7" rx=".5"/><rect x="9" y="2" width="3" height="10" rx=".5"/><rect x="13.5" y="0" width="2.5" height="12" rx=".5"/></svg>
            <!-- wifi -->
            <svg viewBox="0 0 16 12"><path d="M8 9.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-4a6 6 0 014.24 1.76l-1.42 1.42A4 4 0 008 7.5a4 4 0 00-2.82 1.18L3.76 7.26A6 6 0 018 5.5zm0-4a10 10 0 017.07 2.93L13.65 5.85A8 8 0 008 3.5a8 8 0 00-5.65 2.35L.93 4.43A10 10 0 018 1.5z"/></svg>
            <!-- battery -->
            <svg viewBox="0 0 24 12"><rect x="0" y="1" width="20" height="10" rx="2.5" stroke="currentColor" stroke-width="1" fill="none" opacity=".5"/><rect x="20.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".5"/><rect x="2" y="3" width="16" height="6" rx="1.2" fill="currentColor"/></svg>
          </div>
        </div>
        <div class="chat-header">
          <div class="avatar">💅</div>
          <div class="info">
            <strong>Preview Salon</strong>
            <small>онлайн</small>
          </div>
        </div>
        <div id="mb-demo"></div>
      </div>
    </div>
  </div>

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
