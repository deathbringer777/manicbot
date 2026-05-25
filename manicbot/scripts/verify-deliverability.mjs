#!/usr/bin/env node
/**
 * Probe the live SPF / DKIM / DMARC posture of the sending domain.
 *
 * Usage:
 *   node scripts/verify-deliverability.mjs                       # default: manicbot.com
 *   node scripts/verify-deliverability.mjs --domain other.com
 *   node scripts/verify-deliverability.mjs --send-test ops@me.com
 *     ↑ also sends a real test email through Resend so you can inspect
 *       SPF/DKIM/DMARC headers on the recipient side.
 *
 * Exit code:
 *   0 — DMARC verdict 'pass' (policy ≥ quarantine + rua configured)
 *   1 — verdict 'warn' or 'fail' OR any required SPF include missing
 *   2 — DNS lookup error (no network, NXDOMAIN, etc.)
 *
 * Required env (only when --send-test is passed):
 *   RESEND_API_KEY, RESEND_FROM
 */

import { promises as dns } from 'node:dns';
import {
  parseDmarc,
  parseSpf,
  parseDkim,
  dmarcVerdict,
  spfIncludes,
  REQUIRED_SPF_INCLUDES,
  REQUIRED_DKIM_SELECTOR,
} from './deliverability-logic.mjs';

const args = parseArgs(process.argv.slice(2));
const DOMAIN = args.domain || 'manicbot.com';

if (args.help) {
  process.stdout.write(__usage());
  process.exit(0);
}

run().catch((e) => {
  console.error(`[deliverability] FAIL — ${e.message}`);
  process.exit(2);
});

async function run() {
  let exitCode = 0;
  console.log(`[deliverability] domain: ${DOMAIN}`);
  console.log('');

  // ── SPF ─────────────────────────────────────────────────────────────
  console.log('1) SPF — _domain TXT');
  const spfTxts = await resolveTxtFlat(DOMAIN);
  const spfTxt = spfTxts.find((t) => /^v\s*=\s*spf1\b/i.test(t));
  if (!spfTxt) {
    console.log('   ✗ no SPF record found');
    exitCode = 1;
  } else {
    const spf = parseSpf(spfTxt);
    const includes = spfIncludes(spf);
    console.log(`   record: ${spfTxt}`);
    console.log(`   includes: ${includes.join(', ') || '(none)'}`);
    console.log(`   all: ${spf.all || '(none)'}`);
    const missing = REQUIRED_SPF_INCLUDES.filter((req) => !includes.includes(req));
    if (missing.length > 0) {
      console.log(`   ✗ missing required includes: ${missing.join(', ')}`);
      exitCode = 1;
    } else {
      console.log('   ✓ all required includes present');
    }
    if (!spf.all || /^[+]all$/i.test(spf.all)) {
      console.log('   ✗ all qualifier missing or "+all" (allows anyone)');
      exitCode = 1;
    }
  }
  console.log('');

  // ── DKIM ────────────────────────────────────────────────────────────
  console.log(`2) DKIM — ${REQUIRED_DKIM_SELECTOR}.${DOMAIN}`);
  const dkimTxts = await resolveTxtFlatSafe(`${REQUIRED_DKIM_SELECTOR}.${DOMAIN}`);
  const dkimTxt = dkimTxts.find((t) => /p\s*=\s*[A-Za-z0-9+/]/i.test(t));
  const dkim = parseDkim(dkimTxt || '');
  if (!dkim.present || !dkim.hasKey) {
    console.log('   ✗ no DKIM public key under this selector');
    if (dkim.revoked) console.log('   (key revoked — p= is empty)');
    exitCode = 1;
  } else {
    console.log(`   ✓ DKIM key published (${(dkimTxt || '').length} bytes of TXT)`);
  }
  console.log('');

  // ── DMARC ───────────────────────────────────────────────────────────
  console.log(`3) DMARC — _dmarc.${DOMAIN}`);
  const dmarcTxts = await resolveTxtFlatSafe(`_dmarc.${DOMAIN}`);
  const dmarcTxt = dmarcTxts.find((t) => /^v\s*=\s*DMARC1\b/i.test(t));
  const dmarc = parseDmarc(dmarcTxt || '');
  if (!dmarc) {
    console.log('   ✗ no DMARC record published');
    exitCode = 1;
  } else {
    console.log(`   record: ${dmarcTxt}`);
    console.log(`   policy: ${dmarc.p || '(missing)'}`);
    console.log(`   rua: ${dmarc.rua || '(missing — no aggregate reports)'}`);
    const v = dmarcVerdict(dmarc);
    if (v.verdict === 'pass') {
      console.log('   ✓ DMARC verdict: PASS');
    } else if (v.verdict === 'warn') {
      console.log(`   ! DMARC verdict: WARN — ${v.reasons.join(', ')}`);
      exitCode = Math.max(exitCode, 1);
    } else {
      console.log(`   ✗ DMARC verdict: FAIL — ${v.reasons.join(', ')}`);
      exitCode = 1;
    }
  }
  console.log('');

  // ── Optional Resend test send ───────────────────────────────────────
  if (args['send-test']) {
    const to = args['send-test'];
    console.log(`4) Resend test send → ${to}`);
    const sent = await sendResendTest(to);
    if (sent.ok) {
      console.log(`   ✓ accepted by Resend, message id: ${sent.id}`);
      console.log('   (check the recipient inbox; look at Show original / View raw headers for')
      console.log('    "Authentication-Results:" — must show spf=pass, dkim=pass, dmarc=pass)');
    } else {
      console.log(`   ✗ Resend rejected: ${sent.error}`);
      exitCode = 1;
    }
    console.log('');
  }

  console.log(`[deliverability] DONE — exit ${exitCode}`);
  process.exit(exitCode);
}

async function resolveTxtFlat(host) {
  try {
    const rows = await dns.resolveTxt(host);
    return rows.map((parts) => parts.join(''));
  } catch (e) {
    throw new Error(`DNS lookup failed for ${host}: ${e.message}`);
  }
}

async function resolveTxtFlatSafe(host) {
  try {
    const rows = await dns.resolveTxt(host);
    return rows.map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

async function sendResendTest(to) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) {
    return { ok: false, error: 'RESEND_API_KEY or RESEND_FROM env var not set' };
  }
  const body = {
    from,
    to: [to],
    subject: `ManicBot deliverability test — ${new Date().toISOString()}`,
    html: `<p>This is a deliverability test email. Open headers and check Authentication-Results.</p>`,
    text: `This is a deliverability test email. Open headers and check Authentication-Results.`,
  };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id || '(no id)' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--domain') out.domain = argv[++i];
    else if (a === '--send-test') out['send-test'] = argv[++i];
  }
  return out;
}

function __usage() {
  return `Usage: node scripts/verify-deliverability.mjs [options]

  --domain <name>            Sending domain (default: manicbot.com)
  --send-test <recipient>    Send a real Resend test to inspect headers
  --help                     This text

Exit codes:
  0 — all checks pass
  1 — at least one check failed or warned
  2 — DNS lookup error

Operator runbook (RU): docs/dns/DMARC.md
`;
}
