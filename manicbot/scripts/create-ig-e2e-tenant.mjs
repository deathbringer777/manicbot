#!/usr/bin/env node
/**
 * Creates a Pro/trialing tenant + binds an existing Telegram bot + grants tenant_owner.
 * Use before binding Instagram in Mini App → Channels (see META_CHANNELS_SETUP.md § E2E).
 *
 * Prerequisites:
 *   - wrangler logged in; run from repo root: cd manicbot
 *   - BOT_ID = numeric id from bot token (part before ":")
 *   - OWNER = your Telegram user id (integer) for Mini App / Salon dashboard
 *
 * Usage:
 *   node scripts/create-ig-e2e-tenant.mjs --owner=123456789 --bot-id=987654321
 *   node scripts/create-ig-e2e-tenant.mjs --owner=123 --bot-id=456 --local
 *   node scripts/create-ig-e2e-tenant.mjs --owner=123 --bot-id=456 --dry-run
 *
 * If the bot row already exists, only tenant_id is updated (webhook_secret preserved).
 * New bot rows get empty webhook_secret — register the token via normal /admin flow or provision.
 * KV bottoken:{botId} must exist for Telegram features; IG-only tests may still run with null TG.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MANICBOT_ROOT = join(__dirname, '..');
const D1_NAME = 'manicbot-db';

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { local: false, dryRun: false, owner: null, botId: null };
  for (const x of a) {
    if (x === '--local') out.local = true;
    else if (x === '--dry-run') out.dryRun = true;
    else if (x.startsWith('--owner=')) out.owner = x.slice(8);
    else if (x.startsWith('--bot-id=')) out.botId = x.slice(9);
  }
  return out;
}

function escSql(s) {
  return String(s).replace(/'/g, "''");
}

function main() {
  const args = parseArgs();
  if (!args.owner || !args.botId) {
    console.error('Usage: node scripts/create-ig-e2e-tenant.mjs --owner=TELEGRAM_USER_ID --bot-id=BOT_NUMERIC_ID [--local] [--dry-run]');
    process.exit(1);
  }
  const ownerNum = Number(args.owner);
  const botId = String(args.botId).trim();
  if (!Number.isFinite(ownerNum) || ownerNum <= 0) {
    console.error('--owner must be a positive integer (Telegram user id)');
    process.exit(1);
  }
  if (!/^\d+$/.test(botId)) {
    console.error('--bot-id must be the numeric bot id (token prefix before :)');
    process.exit(1);
  }

  const tenantId = `t_igtest_${randomBytes(3).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);
  const trialEnds = now + 30 * 24 * 3600;
  const salonJson = JSON.stringify({
    name: 'IG E2E Test Salon',
    address: '',
    phone: '',
    timezone: 'Europe/Warsaw',
    workHours: { from: 9, to: 21 },
    currency: 'PLN',
  });

  const sql = `-- IG E2E fixture tenant (Pro / trialing)
INSERT INTO tenants (id, name, active, salon, photos, about_photos, maps_url, instagram_url, plan, billing_status, subscription_status, trial_ends_at, grace_ends_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, next_payment_date, billing_email, cancel_at_period_end, created_at, updated_at)
VALUES ('${escSql(tenantId)}', 'IG E2E Test', 1, '${escSql(salonJson)}', NULL, NULL, NULL, NULL, 'pro', 'trialing', NULL, ${trialEnds}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, ${now}, ${now});

UPDATE bots SET tenant_id = '${escSql(tenantId)}', updated_at = ${now} WHERE bot_id = '${escSql(botId)}';

INSERT INTO bots (bot_id, tenant_id, bot_username, webhook_secret, active, created_at, updated_at)
SELECT '${escSql(botId)}', '${escSql(tenantId)}', 'ig_e2e_bot', '', 1, ${now}, ${now}
WHERE NOT EXISTS (SELECT 1 FROM bots WHERE bot_id = '${escSql(botId)}');

INSERT OR REPLACE INTO tenant_roles (tenant_id, chat_id, role, created_at)
VALUES ('${escSql(tenantId)}', ${ownerNum}, 'tenant_owner', ${now});
`;

  console.log('Tenant id:', tenantId);
  console.log('Plan: pro, billing_status: trialing, trial_ends_at:', trialEnds, `(${new Date(trialEnds * 1000).toISOString()})`);

  if (args.dryRun) {
    console.log('\n--- SQL (dry run) ---\n');
    console.log(sql);
    console.log('\nNext: Mini App → Salon → Channels → Instagram; Worker secrets per META_CHANNELS_SETUP.md § E2E.');
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'ig-e2e-'));
  const file = join(dir, 'e2e.sql');
  writeFileSync(file, sql, 'utf8');
  const remoteArgs = ['wrangler', 'd1', 'execute', D1_NAME, '--file', file];
  if (args.local) remoteArgs.push('--local');
  else remoteArgs.push('--remote');

  const r = spawnSync('npx', remoteArgs, { cwd: MANICBOT_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  try {
    unlinkSync(file);
  } catch { /* ignore */ }

  if (r.status !== 0) {
    console.error('wrangler d1 execute failed. If bot_id already exists on another tenant, pick another bot or adjust D1 manually.');
    process.exit(r.status ?? 1);
  }
  console.log('\nDone. Open Mini App as this Telegram user, select tenant', tenantId, '→ Channels → connect Instagram.');
}

main();
