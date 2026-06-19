#!/usr/bin/env node
/**
 * check-ai-bots.mjs — verify that AI crawlers are NOT blocked at the network
 * layer (e.g. by Cloudflare's "AI Crawl Control" / "Block AI bots" toggle).
 *
 * robots.txt allowing a bot is necessary but NOT sufficient: Cloudflare can
 * block AI user-agents BEFORE the request ever reaches the Worker. If a
 * citation bot (PerplexityBot, OAI-SearchBot, Claude-SearchBot…) gets a 403,
 * the site cannot be cited in that answer engine no matter how good the content
 * is. This script probes prod with each AI-bot user-agent and reports the
 * status, so the gotcha is caught explicitly.
 *
 * Usage:
 *   node scripts/check-ai-bots.mjs                       # checks https://manicbot.com
 *   node scripts/check-ai-bots.mjs https://staging.host  # custom origin
 *
 * Exit code: 1 if any CITATION bot is blocked (non-2xx/3xx), else 0.
 * Safe to run in CI or a cron and alert on a non-zero exit.
 */
import { AI_BOTS } from '../src/utils/aiBots.js';

const origin = (process.argv[2] || process.env.AI_CHECK_ORIGIN || 'https://manicbot.com').replace(/\/$/, '');
const PATHS = ['/', '/robots.txt', '/ai'];
const TIMEOUT_MS = 15000;

/** Probe one path with one user-agent; return the HTTP status (or 0 on error). */
async function probe(path, ua) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(origin + path, {
      method: 'HEAD',
      headers: { 'User-Agent': ua },
      redirect: 'manual',
      signal: ctrl.signal,
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** A status counts as "reachable" when it is a 2xx or 3xx (not blocked). */
const reachable = (code) => code >= 200 && code < 400;

async function main() {
  console.log(`\nAI-bot reachability check → ${origin}\n`);
  // Build the probe matrix: a human control first, then every AI bot.
  const subjects = [
    { name: 'human (control)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1', kind: 'control' },
    ...AI_BOTS.map((b) => ({ name: b.name, ua: `${b.name}/1.0 (+https://manicbot.com)`, kind: b.kind })),
  ];

  const rows = [];
  for (const s of subjects) {
    const codes = {};
    for (const p of PATHS) codes[p] = await probe(p, s.ua);
    rows.push({ ...s, codes });
  }

  // Render a simple aligned table.
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`  ${pad('bot', 20)}${pad('kind', 10)}${PATHS.map((p) => pad(p, 14)).join('')}`);
  console.log(`  ${'-'.repeat(20 + 10 + PATHS.length * 14)}`);
  for (const r of rows) {
    const cells = PATHS.map((p) => {
      const c = r.codes[p];
      const mark = c === 0 ? 'ERR' : reachable(c) ? 'ok' : 'BLOCK';
      return pad(`${c || '-'} ${mark}`, 14);
    }).join('');
    console.log(`  ${pad(r.name, 20)}${pad(r.kind, 10)}${cells}`);
  }

  // A citation bot blocked on / or /robots.txt is the failure we care about.
  const blockedCitation = rows.filter(
    (r) => r.kind === 'citation' && (!reachable(r.codes['/']) || !reachable(r.codes['/robots.txt'])),
  );

  console.log('');
  if (blockedCitation.length > 0) {
    console.log('❌ BLOCKED citation bots (fix Cloudflare → Security → Bots → AI Crawl Control):');
    for (const r of blockedCitation) console.log(`   - ${r.name}: / = ${r.codes['/']}, /robots.txt = ${r.codes['/robots.txt']}`);
    process.exit(1);
  }
  console.log('✅ All citation bots reachable — AI crawlers are not blocked at the network layer.');
}

main().catch((e) => {
  console.error('check-ai-bots failed:', e?.message || e);
  process.exit(2);
});
