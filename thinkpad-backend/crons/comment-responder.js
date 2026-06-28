#!/usr/bin/env node
'use strict';
/**
 * @manicbot_com IG/FB comment responder → Worker.
 *
 * Pulls new comments from the Worker (/admin/messaging/comments-pending),
 * classifies + drafts a reply with `claude -p` (Max subscription, no API key),
 * and pushes the decision back (/admin/messaging/comment-reply). The Worker
 * posts approved replies, gated by SOCIAL_COMMENTS_AUTOREPLY_ENABLED + a 30/hour
 * rate limit (migration 0127).
 *
 * Safety: risky comments (complaint/negative/legal/medical) are escalated — the
 * Worker pings the owner and never auto-replies; spam is skipped; only
 * benign/praise/lead get a drafted reply. Ships safe with no MESSAGING_TOKEN.
 */
const path = require('path');
const { BASE_DIR } = require('../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../lib/runner');
const { httpJson } = require('../lib/http');
const { askClaude } = require('../lib/claude');

const REPLY_CLASSES = new Set(['benign', 'praise', 'lead']);
const ESCALATE_CLASSES = new Set(['complaint', 'negative', 'legal', 'medical']);

function buildPrompt(comment) {
  return [
    'You moderate comments for @manicbot_com (Polish B2B SaaS for beauty salons).',
    'Classify the comment and, if safe, draft a short friendly reply IN THE SAME',
    'LANGUAGE as the comment. Classes: benign, praise, lead, complaint, negative,',
    'legal, medical, spam. Reply ONLY for benign/praise/lead; otherwise empty reply.',
    `Comment from @${comment.from_username || 'user'}: "${String(comment.text || '').slice(0, 500)}"`,
    'Return ONLY JSON: {"classification":"<class>","reply":"<text or empty>"}.',
  ].join(' ');
}

/** Map a claude verdict → a comment-reply seam action. */
function decide(verdict) {
  const cls = String(verdict?.classification || '').toLowerCase();
  const reply = String(verdict?.reply || '').trim();
  if (ESCALATE_CLASSES.has(cls)) return { action: 'escalate', classification: cls };
  if (cls === 'spam') return { action: 'skip', classification: cls };
  if (REPLY_CLASSES.has(cls) && reply) return { action: 'draft', classification: cls, reply_text: reply };
  return { action: 'skip', classification: cls || 'unknown' };
}

async function main(logger, deps = {}) {
  const http = deps.http || httpJson;
  const claude = deps.claude || askClaude;
  const baseUrl = deps.baseUrl || process.env.WORKER_BASE_URL || 'https://manicbot.com';
  const token = deps.token || process.env.MESSAGING_TOKEN || '';
  const limit = deps.limit || 25;

  if (!token) {
    logger.log('MESSAGING_TOKEN not configured — skipping');
    return { skipped: true };
  }

  const auth = { Authorization: `Bearer ${token}` };
  const pending = await http(`${baseUrl}/admin/messaging/comments-pending?limit=${limit}`, { headers: auth });
  if (pending.status < 200 || pending.status >= 300) throw new Error(`comments-pending HTTP ${pending.status}`);
  const comments = pending.data?.comments || [];

  const out = { drafted: 0, escalated: 0, skipped: 0, errors: 0 };
  for (const c of comments) {
    try {
      const verdict = await claude(buildPrompt(c), { json: true });
      const decision = decide(verdict.json);
      const r = await http(`${baseUrl}/admin/messaging/comment-reply`, {
        method: 'POST', headers: auth, body: { comment_id: c.comment_id, ...decision },
      });
      if (r.status < 200 || r.status >= 300) throw new Error(`comment-reply HTTP ${r.status}`);
      out[decision.action === 'draft' ? 'drafted' : decision.action === 'escalate' ? 'escalated' : 'skipped']++;
    } catch (e) {
      out.errors++;
      logger.log(`comment ${c.comment_id} failed: ${e.message}`);
    }
  }
  logger.log(`comment-responder: drafted ${out.drafted}, escalated ${out.escalated}, skipped ${out.skipped}, errors ${out.errors}`);
  return { ok: true, ...out };
}

module.exports = { main, buildPrompt, decide, REPLY_CLASSES, ESCALATE_CLASSES };

if (require.main === module) runCron('comment-responder', main);
