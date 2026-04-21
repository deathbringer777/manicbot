/**
 * @fileoverview Embeddable demo-chat widget — HTTP routes.
 *
 * Serves a single self-contained script at `/embed/demo-chat.js` that the
 * marketing landing can include with one `<script>` tag:
 *
 *   <div id="mb-demo"></div>
 *   <script src="https://manicbot.com/embed/demo-chat.js"
 *           data-slug="preview-landing" data-target="#mb-demo"></script>
 *
 * The script body lives in `src/embed/demoChat.js` as a plain string — it is
 * handed to the browser as `application/javascript` with long cache.
 */

import { DEMO_CHAT_SRC } from '../embed/demoChat.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function tryEmbed(request, env, url) {
  if (!url.pathname.startsWith('/embed/')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' } });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, OPTIONS' } });
  }

  if (url.pathname === '/embed/demo-chat.js') {
    return new Response(DEMO_CHAT_SRC, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        // 5 minute cache at the edge / in the browser; source changes ride the
        // next Worker deploy so a short window keeps it reasonably fresh.
        'Cache-Control': 'public, max-age=300',
        // #S13 — defense-in-depth. CSP on JS responses is not enforced by the
        // browser (applies to HTML docs), but it documents intent and is
        // harmless. The real enforcement lives on the hosting page.
        'Content-Security-Policy': "default-src 'self'; script-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        ...CORS_HEADERS,
      },
    });
  }

  return new Response('Not Found', { status: 404 });
}
