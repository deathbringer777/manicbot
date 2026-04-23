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

    /* ===== iPhone 15 frame =====
       Design notes:
       - The frame is a single flat gradient with ONE outer drop shadow. No white
         inset highlights — those render as visible light stripes on any dark
         body background (the previous version's dark-mode bug).
       - Light mode frame is titanium silver (~#d4d4d8 → #a1a1aa), dark mode is
         matte space-black (#2a2a2e → #0e0e10). Both colors sit naturally against
         the body background for their theme.
       - The black bezel between frame and screen glass is a 1px inset on the
         screen (intentional — matches the real OLED edge). */
    .phone-wrap{
      position:relative;
      flex-shrink:0;
      padding:0 6px 20px;
    }
    .phone-wrap::after{
      /* Floor reflection — light mode only */
      content:"";
      position:absolute;
      left:10%;right:10%;bottom:-8px;
      height:24px;
      background:radial-gradient(ellipse at center, rgba(15,23,42,.25) 0%, transparent 70%);
      filter:blur(10px);
      z-index:-1;
    }
    .iphone{
      position:relative;
      width:300px;
      padding:10px;
      border-radius:54px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.05) 0%, rgba(0,0,0,.08) 100%),
        linear-gradient(145deg, #d4d4d8 0%, #b4b4b9 45%, #8a8a90 100%);
      box-shadow:
        0 30px 60px -20px rgba(15,23,42,.35),
        0 15px 30px -15px rgba(15,23,42,.2);
    }
    .btn-mute,.btn-vup,.btn-vdn,.btn-pwr{display:none}

    .iphone-screen{
      position:relative;
      background:#fff;
      border-radius:44px;
      overflow:hidden;
      height:600px;
      display:flex;
      flex-direction:column;
      /* 1px black OLED bezel — the only inset.  No white highlight stripe. */
      box-shadow:inset 0 0 0 1px #000;
      z-index:2;
    }

    /* Dynamic Island — a true capsule (radius:20px on a 102×30 pill), centered
       at the top of the screen and stacked above the status bar so the two
       overlap the way they do on a real iPhone 15 Pro. */
    .island{
      position:absolute;
      top:12px;
      left:50%;transform:translateX(-50%);
      width:102px;height:30px;
      background:#050505;
      border-radius:20px;
      z-index:30;
    }
    .island::after{
      /* Camera lens — small, glassy, off-center right */
      content:"";
      position:absolute;
      top:50%;right:9px;transform:translateY(-50%);
      width:7px;height:7px;border-radius:50%;
      background:
        radial-gradient(circle at 30% 30%, rgba(96,165,250,.35) 0%, transparent 45%),
        radial-gradient(circle at 70% 70%, rgba(0,0,0,1) 0%, #0a0a0a 60%);
    }

    /* Status bar — sits at the top, wraps around the Dynamic Island.
       The Dynamic Island overlaps; padding-top:56px (or the real safe-area
       inset when embedded on device) reserves enough height for the island. */
    .status-bar{
      min-height:46px;
      background:transparent;
      display:flex;
      align-items:flex-end;
      justify-content:space-between;
      padding-top:56px;
      padding-top:max(env(safe-area-inset-top),56px);
      padding-right:22px;
      padding-bottom:8px;
      padding-left:22px;
      font-size:15px;
      font-weight:600;
      color:#0f172a;
      flex-shrink:0;
      position:relative;
      z-index:10;
      letter-spacing:-.2px;
    }
    .status-bar .time{
      font-variant-numeric:tabular-nums;
      line-height:1;
    }
    .status-bar .icons{
      display:flex;
      gap:5px;
      align-items:center;
    }
    .status-bar svg{
      display:block;
      fill:currentColor;
      height:11px;
    }
    .status-bar .ico-signal{width:17px}

    /* Chat app header — title + avatar strip directly under the status bar */
    .chat-header{
      background:transparent;
      padding:6px 14px 10px;
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

    /* ===== Dark mode =====
       Frame flips to matte space-black; still no white insets so the silhouette
       blends cleanly against the dark body background. */
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
        background:
          linear-gradient(180deg, rgba(255,255,255,.03) 0%, rgba(0,0,0,.25) 100%),
          linear-gradient(145deg, #2a2a2e 0%, #1a1a1d 50%, #0e0e10 100%);
        box-shadow:
          0 30px 70px -20px rgba(0,0,0,.75),
          0 15px 30px -15px rgba(0,0,0,.5);
      }
      .iphone-screen{background:#0a0a0a;box-shadow:inset 0 0 0 1px #000}
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
            <!-- Cellular signal: 4 bars, increasing height, all filled (strong signal) -->
            <svg class="ico-signal" viewBox="0 0 17 11" aria-hidden="true">
              <rect x="0"  y="7.5" width="3" height="3.5" rx=".7"/>
              <rect x="4.7" y="5"   width="3" height="6"   rx=".7"/>
              <rect x="9.4" y="2.5" width="3" height="8.5" rx=".7"/>
              <rect x="14.1" y="0"  width="3" height="11"  rx=".7"/>
            </svg>
          </div>
        </div>
        <div class="chat-header">
          <div class="avatar">💅</div>
          <div class="info">
            <strong>Manic Bot</strong>
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
