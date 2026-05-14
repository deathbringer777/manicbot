/**
 * Server-rendered legal pages required by Meta App Review:
 *   - /privacy          — Privacy Policy
 *   - /data-deletion    — User Data Deletion Instructions (Meta requires
 *                          a public URL that explains, in static HTML,
 *                          how end-users can request deletion of their data)
 *   - /terms            — Terms of Service
 *
 * These MUST be static HTML (not SPA). Meta reviewers and automated
 * crawlers don't execute JS; if they hit a SPA shell they see no content
 * and reject the App Review submission. HEAD requests must also return
 * 200 — Meta's crawler probes via HEAD before GET.
 */

const COMMON_STYLE = `<style>
:root { color-scheme: dark; }
body { font: 16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       max-width: 720px; margin: 40px auto; padding: 0 20px; color: #e4e4e7;
       background: #0a0a0a; }
h1 { font-size: 28px; margin-bottom: 8px; }
h2 { font-size: 20px; margin-top: 32px; border-bottom: 1px solid #27272a; padding-bottom: 6px; }
p, li { color: #d4d4d8; }
a { color: #a78bfa; }
.meta { color: #71717a; font-size: 14px; margin-top: 4px; }
footer { color: #71717a; font-size: 14px; margin-top: 48px; border-top: 1px solid #27272a; padding-top: 16px; }
</style>`;

function htmlResponse(title, body, request) {
  const isHead = request?.method === 'HEAD';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
<title>${title} — ManicBot</title>
${COMMON_STYLE}
</head>
<body>
${body}
<footer>
ManicBot — automated booking assistant for nail salons.
Contact: <a href="mailto:support@manicbot.com">support@manicbot.com</a> ·
<a href="/privacy">Privacy</a> ·
<a href="/data-deletion">Data deletion</a> ·
<a href="/terms">Terms</a>
</footer>
</body>
</html>`;
  return new Response(isHead ? null : html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function privacyPage(request) {
  return htmlResponse(
    'Privacy Policy',
    `<h1>Privacy Policy</h1>
<p class="meta">Effective date: 2026-05-14</p>

<h2>1. What we collect</h2>
<p>ManicBot operates an automated booking assistant on behalf of nail salons via Telegram, Instagram Direct, WhatsApp, and a web widget. When a customer interacts with a salon's bot, we process:</p>
<ul>
<li>Messaging platform identifiers (Telegram chat ID, Instagram-Scoped User ID, WhatsApp phone number)</li>
<li>The text and media of messages the user sends to the bot</li>
<li>Booking details the user explicitly provides (name, phone, requested service, time)</li>
<li>The salon's public profile data (name, address, working hours, services)</li>
</ul>
<p>We do NOT collect: passwords, payment card data (Stripe handles billing for salon owners separately), social network friend lists, or any data outside the direct conversation with the bot.</p>

<h2>2. Why we process it</h2>
<p>To deliver the core service: answer messages on behalf of the salon, look up free slots, and confirm appointments. The salon owner sees the conversation in their admin panel — this is the same as if a human receptionist read the DM.</p>

<h2>3. Legal basis</h2>
<p>Processing is based on the user's explicit action of messaging a salon that has installed ManicBot. The salon is the data controller; ManicBot Sp. is the data processor under Article 28 GDPR.</p>

<h2>4. Sharing</h2>
<p>We do not sell user data. Data is shared only with:</p>
<ul>
<li>The salon owner whose Instagram/Telegram/WhatsApp account received the message</li>
<li>Cloudflare (infrastructure provider) for processing the request</li>
<li>Anthropic / OpenAI / Cloudflare Workers AI for the LLM that drafts replies — message text is sent for generation, NOT stored on third-party servers beyond their standard non-retention policy</li>
</ul>

<h2>5. Retention</h2>
<p>Conversations are kept for 180 days after the last message. Booking records are kept for 3 years for the salon's accounting purposes. Both can be deleted earlier on request — see <a href="/data-deletion">Data Deletion Instructions</a>.</p>

<h2>6. Your rights (GDPR Article 15-22)</h2>
<p>You have the right to access, correct, delete, port, or restrict processing of your personal data. Email <a href="mailto:support@manicbot.com">support@manicbot.com</a> with your Instagram username / Telegram username / phone and we will respond within 30 days.</p>

<h2>7. Cookies</h2>
<p>The public landing page sets a single technical cookie for theme preference. The salon admin panel sets a session cookie for authentication. No tracking, no third-party advertising cookies. Cookie consent is recorded in our <code>cookie_consent_log</code> per ePrivacy Directive.</p>

<h2>8. Contact</h2>
<p><a href="mailto:support@manicbot.com">support@manicbot.com</a></p>`,
    request,
  );
}

function dataDeletionPage(request) {
  return htmlResponse(
    'Data Deletion Instructions',
    `<h1>User Data Deletion Instructions</h1>
<p class="meta">Effective date: 2026-05-14</p>

<p>This page exists to meet Meta Platform Policy requirements. It tells you exactly how to delete any personal data ManicBot holds about you.</p>

<h2>What you can delete</h2>
<ul>
<li>Your conversation history with any salon's ManicBot</li>
<li>Booking records you made through the bot</li>
<li>Your phone number, name, and any profile data the bot stored</li>
<li>Your Instagram-Scoped User ID, Telegram chat ID, or WhatsApp number</li>
</ul>

<h2>How to request deletion</h2>
<p><strong>Option 1 (recommended): direct message the bot.</strong> Open the chat with the salon's bot and send the text:</p>
<blockquote><code>/delete_my_data</code></blockquote>
<p>The bot will confirm and queue your data for deletion within 24 hours. You will receive a confirmation message when complete.</p>

<p><strong>Option 2: email us.</strong> Send a message to <a href="mailto:support@manicbot.com">support@manicbot.com</a> with the subject <em>"Data deletion request"</em>. Include any of:</p>
<ul>
<li>Your Instagram username (e.g. @yourname)</li>
<li>Your Telegram username or numeric ID</li>
<li>Your WhatsApp phone number (with country code)</li>
<li>The name of the salon you interacted with (helps us locate the records)</li>
</ul>

<h2>Response timeline</h2>
<ul>
<li>We acknowledge your request within 48 hours of receipt</li>
<li>Data is fully deleted within 30 days (GDPR Article 17)</li>
<li>We send you a confirmation by reply once deletion is complete</li>
</ul>

<h2>What gets deleted</h2>
<p>Upon request we permanently remove:</p>
<ul>
<li>Conversation history rows in our <code>conversations</code> and <code>channel_identities</code> tables</li>
<li>Booking records in our <code>appointments</code> table (except where law requires retention for accounting — those are anonymized)</li>
<li>Your phone number, name, and any profile data in our <code>users</code> table</li>
<li>Cached LLM context — purged from KV with the next memory rotation (≤1 hour)</li>
</ul>

<h2>What we cannot delete</h2>
<ul>
<li>Aggregate/anonymized analytics (no personal identifiers, cannot be linked back to you)</li>
<li>Records the salon owner is legally required to retain (tax invoices in some jurisdictions retain customer name + service for 5+ years; in that case we anonymize the record, removing your identifiers but keeping the legally required fields)</li>
<li>Messages already delivered to the salon owner through Meta/Telegram's own retention — we cannot delete from their servers; you should also <a href="https://help.instagram.com/contact/505535973176369">delete the conversation in Instagram</a> if needed</li>
</ul>

<h2>Questions?</h2>
<p><a href="mailto:support@manicbot.com">support@manicbot.com</a> — we reply within 48 hours.</p>`,
    request,
  );
}

function termsPage(request) {
  return htmlResponse(
    'Terms of Service',
    `<h1>Terms of Service</h1>
<p class="meta">Effective date: 2026-05-14</p>

<h2>1. Service</h2>
<p>ManicBot provides an automated booking assistant that nail salons install on their Telegram, Instagram, WhatsApp, and web channels. Salons subscribe on the Start (45 zł), Pro (60 zł), or Max (90 zł) monthly plans.</p>

<h2>2. Account</h2>
<p>Salons register at <a href="https://manicbot.com/register">manicbot.com/register</a> with email + password. End-customers do not register — they interact via their social account and we use only the platform-provided identifier.</p>

<h2>3. Payment</h2>
<p>Subscription billing is handled by Stripe. A 7-day free trial is offered. Failed payments enter a 7-day grace period before the bot pauses. Cancel any time — your data is retained for 90 days then deleted unless you re-subscribe.</p>

<h2>4. Acceptable use</h2>
<p>You may not use ManicBot to send spam, harass users, distribute illegal content, or violate the Terms of the platforms we integrate with (Meta, Telegram, etc.). We will suspend accounts that do.</p>

<h2>5. Liability</h2>
<p>ManicBot is provided "as is". We are not liable for missed appointments, AI mistakes in booking suggestions, or downtime of upstream services (Meta, Telegram, Cloudflare). Maximum liability is the last 12 months of subscription fees you paid us.</p>

<h2>6. Changes</h2>
<p>We may update these Terms with 30 days' email notice. Continued use after the effective date constitutes acceptance.</p>

<h2>7. Contact</h2>
<p><a href="mailto:support@manicbot.com">support@manicbot.com</a></p>`,
    request,
  );
}

/**
 * Try to handle one of the legal pages. Returns null if the path doesn't
 * match (caller falls through to next handler).
 *
 * @param {Request} request
 * @param {URL} url
 * @returns {Response|null}
 */
export function tryLegalPages(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  switch (url.pathname) {
    case '/privacy':
    case '/privacy/':
    case '/privacy.html':
      return privacyPage(request);
    case '/data-deletion':
    case '/data-deletion/':
    case '/data-deletion.html':
      return dataDeletionPage(request);
    case '/terms':
    case '/terms/':
    case '/terms.html':
      return termsPage(request);
    default:
      return null;
  }
}
