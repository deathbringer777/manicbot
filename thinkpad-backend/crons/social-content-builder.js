#!/usr/bin/env node
'use strict';
/**
 * Daily @manicbot_com post generator → Worker.
 *
 * Generates Instagram/Facebook captions with `claude -p` (Max subscription, no
 * API key) and pushes them to the Worker via the /admin/messaging/social-draft
 * seam. The Worker autopilot then renders the image (flux), runs the Telegram
 * approval gate, and publishes to IG + FB (migration 0127).
 *
 * Ships safe BEFORE go-live: with no MESSAGING_TOKEN it logs and returns
 * cleanly (no send, no alert). Pairs with the Worker seams in
 * src/http/messagingHttp.js and docs/SOCIAL_AUTOMATION_PHASE2.md.
 */
const path = require('path');
const { BASE_DIR } = require('../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../lib/runner');
const { httpJson } = require('../lib/http');
const { askClaude } = require('../lib/claude');

const THEMES = ['inspiration', 'product', 'social_proof'];
const POST_TIMES = ['09:00', '13:00', '19:00']; // local clock; scheduled_at is unix sec

/** Build the claude prompt for one slot. */
function buildPrompt(theme, topic) {
  return [
    'You write Instagram/Facebook captions for @manicbot_com, a Polish B2B SaaS',
    'AI receptionist for nail/beauty salons. Audience: salon owners in Poland.',
    'Tone: professional, direct, empathetic, no fluff. Language: Polish.',
    `Theme: ${theme}. Topic: ${topic}.`,
    'Return ONLY a JSON object: {"headline_pl":"4-6 words","caption_pl":"80-280 words",',
    '"hashtags":["#10-15 Polish tags"],"image_prompt_visual":"1-2 EN sentences, <30 words"}.',
  ].join(' ');
}

/** Validate + normalize the claude JSON into the seam payload shape. */
function pickCaption(j) {
  if (!j || !j.caption_pl) throw new Error('caption_pl missing in model output');
  return {
    headline_pl: String(j.headline_pl || ''),
    caption_pl: String(j.caption_pl),
    hashtags: Array.isArray(j.hashtags) ? j.hashtags.map(String) : [],
    image_prompt_visual: String(j.image_prompt_visual || ''),
  };
}

/** Compute the upcoming slots (theme rotation + post times) as unix-second times. */
function slotTimes(now, days, topicFor) {
  const base = new Date(now);
  const slots = [];
  for (let d = 1; d <= days; d++) {
    for (let i = 0; i < POST_TIMES.length; i++) {
      const theme = THEMES[(d + i) % THEMES.length];
      const [hh, mm] = POST_TIMES[i].split(':').map(Number);
      const dt = new Date(base);
      dt.setDate(dt.getDate() + d);
      dt.setHours(hh, mm, 0, 0);
      slots.push({ theme, topic: topicFor(theme, d, i), scheduledAt: Math.floor(dt.getTime() / 1000) });
    }
  }
  return slots;
}

async function postDraft(http, { baseUrl, token, slot, caption }) {
  const res = await http(`${baseUrl}/admin/messaging/social-draft`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      scheduled_at: slot.scheduledAt, theme: slot.theme, topic: slot.topic,
      headline_pl: caption.headline_pl, caption_pl: caption.caption_pl,
      hashtags: caption.hashtags, image_prompt: caption.image_prompt_visual,
    },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`social-draft HTTP ${res.status}`);
  return res.data;
}

async function main(logger, deps = {}) {
  const http = deps.http || httpJson;
  const claude = deps.claude || askClaude;
  const baseUrl = deps.baseUrl || process.env.WORKER_BASE_URL || 'https://manicbot.com';
  const token = deps.token || process.env.MESSAGING_TOKEN || '';
  const days = deps.days || 1;
  const now = deps.now || Date.now();
  const topicFor = deps.topicFor || ((theme) => `auto: ${theme}`);

  if (!token) {
    logger.log('MESSAGING_TOKEN not configured — skipping');
    return { skipped: true };
  }

  const slots = slotTimes(now, days, topicFor);
  let pushed = 0, errors = 0;
  for (const slot of slots) {
    try {
      const out = await claude(buildPrompt(slot.theme, slot.topic), { json: true });
      const caption = pickCaption(out.json);
      await postDraft(http, { baseUrl, token, slot, caption });
      pushed++;
    } catch (e) {
      errors++;
      logger.log(`slot ${slot.scheduledAt} (${slot.theme}) failed: ${e.message}`);
    }
  }
  logger.log(`social-content-builder: pushed ${pushed}, errors ${errors}`);
  return { ok: true, pushed, errors };
}

module.exports = { main, buildPrompt, pickCaption, slotTimes, postDraft };

if (require.main === module) runCron('social-content-builder', main);
