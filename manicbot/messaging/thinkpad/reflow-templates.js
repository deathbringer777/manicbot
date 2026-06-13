#!/usr/bin/env node
/**
 * reflow-templates — one-shot: re-paragraph the EXISTING seasonal draft
 * templates so their bodies carry `\n\n` paragraph breaks (fixes the legacy
 * single-paragraph "wall of text" copy without re-running the LLM).
 *
 * Seam-only (never writes D1 directly): GET /admin/messaging/drafts → reflow
 * each `seasonal_*` template's channel bodies via `reflowToParagraphs` → POST
 * /admin/messaging/template-draft (upsert by template_key+locale; `clean()`
 * preserves the newlines; status stays `draft`, gated by MESSAGING_SEND_ENABLED).
 *
 * Idempotent: bodies that already contain a paragraph break are skipped.
 *
 * IMPORTANT: GET drafts does not return channels_json, and the upsert defaults a
 * missing `channels` to ['center'] — which would drop the 'bell' channel. We
 * therefore pass channels = the body keys (e.g. ['center','bell']) to preserve it.
 *
 * Run: node reflow-templates.js          (push)
 *      REFLOW_DRY_RUN=1 node reflow-templates.js   (preview only, no writes)
 */

import { api } from './lib/api.js';
import { reflowToParagraphs } from './lib/format.js';

const SEASONAL_PREFIX = 'seasonal_';

/** Reflow every string channel body; report whether anything changed. */
function reflowBodies(bodiesJson) {
  let parsed;
  try { parsed = JSON.parse(bodiesJson || '{}'); } catch { parsed = {}; }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  const out = {};
  let changed = false;
  for (const [channel, val] of Object.entries(parsed)) {
    if (typeof val === 'string') {
      const reflowed = reflowToParagraphs(val);
      if (reflowed !== val) changed = true;
      out[channel] = reflowed;
    } else {
      out[channel] = val; // non-string channel (e.g. email object) — leave as-is
    }
  }
  return { bodies: out, changed };
}

async function main() {
  const dryRun = process.env.REFLOW_DRY_RUN === '1';
  const res = await api.listDrafts();
  if (!res.ok) { console.error(`[reflow] listDrafts failed: ${res.error}`); process.exitCode = 1; return; }

  const seasonal = (res.templates || []).filter(
    (t) => typeof t.template_key === 'string' && t.template_key.startsWith(SEASONAL_PREFIX),
  );
  if (!seasonal.length) { console.log('[reflow] no seasonal draft templates found'); return; }

  let pushed = 0, skipped = 0, failed = 0;
  for (const t of seasonal) {
    const { bodies, changed } = reflowBodies(t.bodies_json);
    if (!changed) { skipped += 1; continue; }
    if (dryRun) { pushed += 1; console.log(`[reflow] WOULD push ${t.template_key}/${t.locale}`); continue; }

    let variables = ['salon_name'];
    try { const v = JSON.parse(t.variables_json || '[]'); if (Array.isArray(v) && v.length) variables = v; } catch { /* keep default */ }

    const push = await api.templateDraft({
      template_key: t.template_key,
      locale: t.locale,
      name: t.name || t.template_key,
      category: t.category || 'seasonal',
      channels: Object.keys(bodies), // preserve bell etc. (see header note)
      bodies,
      variables,
    });
    if (push.ok) pushed += 1;
    else { failed += 1; console.error(`[reflow] push ${t.template_key}/${t.locale} ${push.error}`); }
  }
  console.log(`[reflow]${dryRun ? ' DRY-RUN' : ''} templates=${seasonal.length} pushed=${pushed} skipped=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main();
