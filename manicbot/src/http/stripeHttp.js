import { handleStripeWebhook } from '../billing/webhooks.js';
import { getStripeConfig } from '../billing/config.js';
import { envCtx } from './envCtx.js';
import { logEvent } from '../utils/events.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryStripe(request, env, url) {
  if (request.method === 'POST' && url.pathname === '/stripe/webhook') {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !env.MANICBOT) return new Response('Bad config', { status: 500 });
    const signature = request.headers.get('Stripe-Signature') || '';
    let body;
    try {
      body = await request.text();
    } catch {
      return new Response('Bad body', { status: 400 });
    }
    const ec = envCtx(env);
    // STRIPE-01: pass the price-id config so the webhook can map a portal-driven
    // price change back to the authoritative plan key (not stale metadata).
    const cfg = getStripeConfig(env);
    const result = await handleStripeWebhook(ec, body, signature, secret, cfg.ok ? cfg : null);
    if (result.ok && !result.skipped) {
      const stripeType = (() => { try { return JSON.parse(body)?.type ?? 'unknown'; } catch { return 'unknown'; } })();
      void logEvent(ec, 'stripe.event', { message: `Stripe: ${stripeType}` });
    }
    return new Response(result.skipped ? 'OK (duplicate)' : 'OK', { status: result.status });
  }

  if (request.method === 'GET' && url.pathname === '/stripe/success') {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Payment successful</title>
<style>body{font-family:system-ui;max-width:480px;margin:60px auto;padding:20px;background:#f0fdf4;color:#166534;text-align:center}
h1{font-size:1.5em}.s{background:#fff;padding:24px;border-radius:12px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}</style></head><body>
<h1>✅ Payment successful</h1>
<div class="s"><p>Your subscription is active. You can close this tab and return to the bot.</p></div>
</body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }

  return null;
}
