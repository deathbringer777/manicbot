/**
 * notify.js — lightweight TG notification helper.
 * Sends via ThinkPad bot directly (no Worker proxy needed).
 */

const https = require('https');

// Credentials come from ~/manicbot-backend/.env only. A bot token must never
// be hardcoded here: this file is versioned in a public repo.
const TG_BOT_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.CHAT_ID || process.env.TG_CHAT_ID || '';

function notifyTg(_workerUrl, _token, text) {
  if (!text || !TG_BOT_TOKEN || !TG_CHAT_ID) return Promise.resolve();
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text });
    const req = https.request(
      `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      () => resolve()
    );
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

module.exports = { notifyTg };
