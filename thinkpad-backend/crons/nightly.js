#!/usr/bin/env node
/**
 * Nightly cron — runs at 01:00 daily via PM2.
 * 1. Sync tenant list from Worker → marketing/clients.csv
 * 2. Full D1 backup → backups/d1-YYYY-MM-DD.sql (keeps 30 days)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');
require('dotenv').config({ path: path.join(BASE_DIR, '.env') });
const LOG_FILE = path.join(BASE_DIR, 'logs', 'nightly.log');

const WORKER_URL = process.env.WORKER_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const NOTIFY_TOKEN = process.env.NOTIFY_TOKEN;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID;

function timestamp() {
  return new Date().toISOString();
}

function log(msg) {
  const line = `[${timestamp()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { timeout: 30000, ...options }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function notifyTg(text) {
  if (!NOTIFY_TOKEN || !WORKER_URL) return;
  try {
    await fetchJson(`${WORKER_URL}/admin/notify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    log(`TG notify failed: ${e.message}`);
  }
}

// ── Step 1: Sync tenant list ──────────────────────────────────────────────────

async function syncClients() {
  log('--- Step 1: Sync clients ---');
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !D1_DATABASE_ID) {
    log('SKIP: CF credentials not set in .env');
    return 0;
  }

  // Pull the tenant directory straight from D1 via the SAME scoped Cloudflare API
  // token used for the backup below — not the Worker /admin/tenants-export route.
  // That route is now ADMIN_KEY-only; reading the roster through the CF token keeps
  // the low-priv NOTIFY_TOKEN out of every customer-PII path and means the ThinkPad
  // never has to carry the master ADMIN_KEY.
  let tenants;
  try {
    tenants = await d1Query(
      `SELECT id, name, salon, billing_email AS email, '' AS phone,
              plan, billing_status, created_at
       FROM tenants ORDER BY created_at DESC`,
    );
  } catch (e) {
    log(`ERROR: tenant query failed: ${e.message}`);
    return 0;
  }
  if (!Array.isArray(tenants)) {
    log('ERROR: tenant query returned a non-array result');
    return 0;
  }

  const csvDir = path.join(BASE_DIR, 'marketing');
  fs.mkdirSync(csvDir, { recursive: true });

  const header = 'id,name,salon,email,phone,plan,billing_status,created_at\n';
  const rows = tenants.map(t =>
    [t.id, t.name, t.salon, t.email, t.phone, t.plan, t.billing_status, t.created_at]
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');

  fs.writeFileSync(path.join(csvDir, 'clients.csv'), header + rows + '\n');
  log(`Wrote ${tenants.length} tenants to marketing/clients.csv`);
  return tenants.length;
}

// ── Step 2: D1 Backup ─────────────────────────────────────────────────────────
// Uses D1 Query API (POST .../query) — works with D1:Read permission.
// Dumps all tables as INSERT OR REPLACE statements.

async function d1Query(sql, params = []) {
  const res = await fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  if (res.status !== 200 || !res.data?.success) {
    throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(res.data?.errors || res.data)}`);
  }
  return res.data.result?.[0]?.results ?? [];
}

async function backupD1() {
  log('--- Step 2: D1 Backup ---');
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !D1_DATABASE_ID) {
    log('SKIP: CF credentials not set in .env');
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  const backupDir = path.join(BASE_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  // Full-DB dumps are crown-jewel data — keep the dir + files owner-only (700/600)
  // so a future home-dir perm slip or an added local account can't read every tenant.
  try { fs.chmodSync(backupDir, 0o700); } catch {}
  const outFile = path.join(backupDir, `d1-${today}.sql`);

  // D1 blocks sqlite_master and PRAGMA for API tokens — use hardcoded table list from schema.sql.
  // Update this list when migrations add/drop tables (run: grep 'CREATE TABLE' schema.sql | awk '{print $5}').
  const TABLE_NAMES = [
    'ai_usage','album_photos','analytics_events','appointment_blocks','appointments',
    'audit_log','blocked_users','blog_posts','bots','channel_configs','channel_identities',
    'conversations','cookie_consent_log','d1_backup_log','email_subscribers',
    'email_suppressions','error_events','error_log','global_otp_codes','google_busy_blocks',
    'google_integrations','google_prefill_consumed','human_requests','industry_configs',
    'leads','local_tickets','marketing_automations','marketing_campaigns',
    'marketing_consent_log','marketing_contacts','marketing_content_plan',
    'marketing_providers','marketing_publish_queue','marketing_segment_members',
    'marketing_segments','marketing_sends','marketing_templates','master_client_blocks',
    'master_invitations','master_pairing_codes','masters','message_windows',
    'newsletter_subscribers','owner_pairing_codes','ownership_transfer_tokens',
    'permission_elevation_codes','photo_albums','platform_broadcasts',
    'platform_campaign_deliveries','platform_campaigns','platform_config',
    'platform_message_templates','platform_roles','platform_thread_messages',
    'platform_threads','platform_ticket_messages','platform_tickets','plugin_events',
    'plugin_installations','plugin_pins','promo_code_uses','promo_codes',
    'push_subscriptions','rate_limits','referral_codes','referral_events',
    'referral_rewards','referrals','reviews','role_change_requests','service_categories',
    'services','stamp_card_configs','stamp_card_progress','stripe_customers','stripe_events',
    'stripe_ledger','subscription_cancellations','subscription_grant_codes','support_agents',
    'template_usage','tenant_action_requests','tenant_config','tenant_member_permissions',
    'tenant_onboarding','tenant_roles','tenant_support_agents','tenants','thread_members',
    'thread_messages','threads','tracking_links','upload_token_used','user_notifications',
    'user_origins','users','web_users','webhook_dedup',
  ];
  // Wrap as objects for the loop below
  const tables = TABLE_NAMES.map(name => ({ name }));

  log(`Backing up ${tables.length} tables...`);

  const lines = [
    `-- ManicBot D1 backup — ${new Date().toISOString()}`,
    'PRAGMA foreign_keys=OFF;',
    '',
  ];

  let totalRows = 0;

  for (const { name } of tables) {
    // Get column names
    const cols = await d1Query(`PRAGMA table_info(${name})`);
    if (!cols.length) continue;
    const colNames = cols.map(c => c.name);

    // Dump rows in pages to stay within API limits
    const PAGE = 500;
    let offset = 0;
    let pageRows;

    lines.push(`-- Table: ${name}`);
    lines.push(`DELETE FROM "${name}";`);

    do {
      pageRows = await d1Query(
        `SELECT * FROM "${name}" LIMIT ${PAGE} OFFSET ${offset}`
      );
      for (const row of pageRows) {
        const vals = colNames.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        lines.push(`INSERT OR REPLACE INTO "${name}" (${colNames.map(c => `"${c}"`).join(',')}) VALUES (${vals.join(',')});`);
      }
      totalRows += pageRows.length;
      offset += PAGE;
    } while (pageRows.length === PAGE);

    lines.push('');
  }

  lines.push('PRAGMA foreign_keys=ON;');
  const sqlContent = lines.join('\n');

  fs.writeFileSync(outFile, sqlContent);
  try { fs.chmodSync(outFile, 0o600); } catch {}
  const sizeMb = (sqlContent.length / 1024 / 1024).toFixed(2);
  log(`Backup saved: ${outFile} (${tables.length} tables, ${totalRows} rows, ${sizeMb} MB)`);

  // Prune backups older than 30 days
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('d1-') && f.endsWith('.sql'))
    .sort();
  if (files.length > 30) {
    const toDelete = files.slice(0, files.length - 30);
    toDelete.forEach(f => {
      fs.unlinkSync(path.join(backupDir, f));
      log(`Pruned old backup: ${f}`);
    });
  }

  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  log('=== Nightly run started ===');
  const errors = [];

  let clientCount = 0;
  try {
    clientCount = await syncClients();
  } catch (e) {
    log(`Client sync error: ${e.message}`);
    errors.push('client sync');
  }

  let backupOk = false;
  try {
    backupOk = await backupD1();
  } catch (e) {
    log(`D1 backup error: ${e.message}`);
    errors.push('D1 backup');
  }

  const date = new Date().toLocaleDateString('ru-RU');
  const status = errors.length ? `⚠️ Ошибки: ${errors.join(', ')}` : '✅';
  const msg = `${status} Ночной крон ${date}\nКлиентов: ${clientCount}\nBackup D1: ${backupOk ? 'OK' : 'пропущен/ошибка'}`;

  await notifyTg(msg);
  log(`=== Nightly run done ===\n`);
}

run().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
