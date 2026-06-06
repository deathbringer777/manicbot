import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';
import { runMigration } from '../tenant/migration.js';
import { runSeed } from '../admin/seed.js';
import { registerBot, createTenant } from '../admin/provisioning.js';
import { getTenant, putTenant, listTenantIds, getBotIdsByTenantId, getBot, getBotToken } from '../tenant/storage.js';
import { envCtx } from './envCtx.js';
import { logEvent } from '../utils/events.js';
import { audit } from '../utils/audit.js';
import { buildSearchVariants, hasCyrillic } from '../lib/searchNormalize.js';
import { splitTelegramText } from '../utils/telegramChunk.js';
import { registerAdminBotWebhook } from '../adminbot/ctx.js';

/**
 * Roles that may be created or upserted via POST /admin/web-user.
 * `system_admin` is deliberately excluded — platform-level roles must be granted via
 * direct DB write or wrangler command with audit log, never via HTTP. Adding `system_admin`
 * here would re-introduce the #S1 privilege-escalation vulnerability.
 */
const ALLOWED_CREATE_ROLES = new Set(['tenant_owner', 'support', 'technical_support', 'master']);

/**
 * Returns true if the admin key matches env.ADMIN_KEY (timing-safe).
 * Requires Authorization: Bearer <ADMIN_KEY> header.
 * The deprecated ?key= query-param fallback has been removed — it leaked the
 * key into Cloudflare request logs, Referer headers, and browser history.
 */
function isAdminKeyValid(url, env, request) {
  if (!env.ADMIN_KEY) return false;
  const authHeader = request?.headers?.get?.('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return timingSafeEqual(authHeader.slice(7), env.ADMIN_KEY);
  }
  return false;
}

/**
 * Returns true if EITHER env.NOTIFY_TOKEN OR env.ADMIN_KEY matches the Bearer
 * header (timing-safe). Used by /admin/notify so remote/cloud callers can post
 * Telegram messages with a low-privilege token that can ONLY trigger Telegram
 * fan-out — never any other admin operation. Existing ADMIN_KEY callers keep
 * working unchanged.
 */
function isNotifyAuthValid(env, request) {
  const authHeader = request?.headers?.get?.('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const presented = authHeader.slice(7);
  if (env.NOTIFY_TOKEN && timingSafeEqual(presented, env.NOTIFY_TOKEN)) return true;
  if (env.ADMIN_KEY && timingSafeEqual(presented, env.ADMIN_KEY)) return true;
  return false;
}

/** Returns a 403 Forbidden response. */
const forbidden = () => new Response('Forbidden', { status: 403 });

function isAllowedAdminReturnUrl(returnUrl, env) {
  if (!returnUrl) return true;
  try {
    const target = new URL(returnUrl);
    const configured = env.ADMIN_APP_URL || env.APP_BASE_URL || '';
    const allowed = configured ? new URL(configured).origin : 'https://admin.manicbot.com';
    return target.origin === allowed;
  } catch {
    return false;
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryAdminKeyRoutes(request, env, url) {
  if (url.pathname === '/admin/migrate') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.MANICBOT) return new Response('KV not bound', { status: 500 });
    const result = await runMigration(env.MANICBOT, env);
    return Response.json(result);
  }

  if (url.pathname === '/admin/migrate-d1') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB || !env.MANICBOT) return new Response('DB or KV not bound', { status: 500 });
    const { migrateKvToD1 } = await import('../../scripts/migrate-kv-to-d1.js');
    const result = await migrateKvToD1(envCtx(env));
    return Response.json(result);
  }

  if (url.pathname === '/admin/seed') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const masterParam = (url.searchParams.get('master') || 'dezbringer').replace(/^@/, '');
    const result = await runSeed(envCtx(env), env, masterParam);
    return Response.json(result);
  }

  // Sprint 5: seed 3 demo tenants (beauty / cosmetology / auto)
  if (request.method === 'POST' && url.pathname === '/admin/seed-demo-tenants') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const { seedDemoTenants } = await import('../../scripts/seed-demo-tenants.js');
    const result = await seedDemoTenants(envCtx(env));
    return Response.json({ ok: true, result });
  }

  // Sprint 2/6: run one pass of the BOT_ENCRYPTION_KEY rotation sweep.
  // Call repeatedly (cron-friendly) until all tables return 0 remaining.
  if (request.method === 'POST' && url.pathname === '/admin/key-rotation-sweep') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const { sweepKeyRotation } = await import('../../scripts/rotate-bot-encryption-key.js');
    const ec = envCtx(env);
    // Inject BOT_ENCRYPTION_KEY + KV into ctx for the sweep
    ec.BOT_ENCRYPTION_KEY = env.BOT_ENCRYPTION_KEY;
    ec.MANICBOT = env.MANICBOT;
    const result = await sweepKeyRotation(ec);
    return Response.json(result);
  }

  // #P1-5 — re-encrypt all token blobs after BOT_ENCRYPTION_KEY rotation.
  // Reads each row with the new key and falls back to BOT_ENCRYPTION_KEY_OLD;
  // any blob that decrypted via the old key is re-encrypted with the new one.
  // Idempotent — call repeatedly until all tables report `ok: 0`.
  // See scripts/rotate-bot-encryption-key.js (rotateEncryptionKeyPass) for
  // the detailed operator playbook.
  if (request.method === 'POST' && url.pathname === '/admin/rotate-encryption-key') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const { rotateEncryptionKeyPass } = await import('../../scripts/rotate-bot-encryption-key.js');
    const ec = envCtx(env);
    ec.BOT_ENCRYPTION_KEY = env.BOT_ENCRYPTION_KEY;
    ec.BOT_ENCRYPTION_KEY_OLD = env.BOT_ENCRYPTION_KEY_OLD || null;
    ec.MANICBOT = env.MANICBOT;
    const result = await rotateEncryptionKeyPass(ec);
    if (result?.error) return Response.json(result, { status: 400 });
    return Response.json(result);
  }

  // #S6: Migrate bot tokens from KV to D1 bots.token_encrypted column.
  //
  // Two modes (selected via `?mode=`):
  //   - mode=migrate (default) — copies KV bottoken:{botId} blobs into D1 for
  //     any row where token_encrypted IS NULL, then deletes them from KV.
  //     One-shot, safe to re-run (skips already-migrated rows).
  //   - mode=verify — read-only audit: walks every D1 bots row and tries to
  //     decrypt the token with the active key (with BOT_ENCRYPTION_KEY_OLD
  //     fallback). Reports per-row status. Use after a deploy or key rotation
  //     to confirm every bot can still resolve its token before users notice.
  //     Returns { ok, summary, rows: [{ botId, fmt, decryptOk, usedOldKey, error }] }.
  if (request.method === 'POST' && url.pathname === '/admin/migrate-bot-tokens') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const ec = envCtx(env);
    ec.BOT_ENCRYPTION_KEY = env.BOT_ENCRYPTION_KEY;
    ec.BOT_ENCRYPTION_KEY_OLD = env.BOT_ENCRYPTION_KEY_OLD || null;
    ec.MANICBOT = env.MANICBOT;

    const mode = url.searchParams.get('mode') || 'migrate';

    if (mode === 'verify') {
      try {
        const { dbAll } = await import('../utils/db.js');
        const { decryptTokenWithFallback } = await import('../utils/security.js');
        const BOT_TOKEN_LABEL = 'bot-token-v1';
        const rows = await dbAll(ec, 'SELECT bot_id, tenant_id, bot_username, active, token_encrypted FROM bots');
        const summary = { total: rows.length, ok: 0, plaintext: 0, decryptOk: 0, usedOldKey: 0, decryptFailed: 0, missing: 0, inactive: 0 };
        const out = [];
        for (const r of rows) {
          if (r.active === 0) summary.inactive++;
          if (!r.token_encrypted) {
            summary.missing++;
            out.push({ botId: r.bot_id, tenantId: r.tenant_id, botUsername: r.bot_username, active: r.active === 1, fmt: 'NULL', decryptOk: false, error: 'token_encrypted_null' });
            continue;
          }
          const raw = r.token_encrypted;
          if (raw.includes(':')) {
            summary.plaintext++;
            summary.ok++;
            out.push({ botId: r.bot_id, tenantId: r.tenant_id, botUsername: r.bot_username, active: r.active === 1, fmt: 'plaintext', decryptOk: true, usedOldKey: false });
            continue;
          }
          const fmt = raw.startsWith('v1$') ? 'v1' : 'legacy';
          if (!env.BOT_ENCRYPTION_KEY) {
            summary.decryptFailed++;
            out.push({ botId: r.bot_id, tenantId: r.tenant_id, botUsername: r.bot_username, active: r.active === 1, fmt, decryptOk: false, error: 'BOT_ENCRYPTION_KEY_unset' });
            continue;
          }
          let result;
          try {
            result = await decryptTokenWithFallback(raw, env.BOT_ENCRYPTION_KEY, env.BOT_ENCRYPTION_KEY_OLD || null, BOT_TOKEN_LABEL);
          } catch (e) {
            summary.decryptFailed++;
            out.push({ botId: r.bot_id, tenantId: r.tenant_id, botUsername: r.bot_username, active: r.active === 1, fmt, decryptOk: false, error: `decrypt_threw: ${e?.message ?? 'unknown'}` });
            continue;
          }
          if (result.plain == null) {
            summary.decryptFailed++;
            out.push({ botId: r.bot_id, tenantId: r.tenant_id, botUsername: r.bot_username, active: r.active === 1, fmt, decryptOk: false, error: 'decrypt_returned_null' });
            continue;
          }
          summary.decryptOk++;
          summary.ok++;
          if (result.usedOldKey) summary.usedOldKey++;
          // Don't leak the plaintext token to the response.
          out.push({ botId: r.bot_id, tenantId: r.tenant_id, botUsername: r.bot_username, active: r.active === 1, fmt, decryptOk: true, usedOldKey: result.usedOldKey });
        }
        void logEvent(ec, 'admin.migrate_bot_tokens.verify', {
          level: summary.decryptFailed > 0 ? 'error' : 'info',
          message: `Verify: ${summary.ok}/${summary.total} ok, ${summary.decryptFailed} decrypt failed, ${summary.missing} missing, ${summary.usedOldKey} used old key`,
          data: summary,
        });
        return Response.json({ ok: true, mode: 'verify', summary, rows: out });
      } catch (err) {
        log.error('http.adminKey', err instanceof Error ? err : new Error(String(err?.message)), { action: 'migrate_bot_tokens_verify' });
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    // Default: mode=migrate (one-shot KV→D1 copy).
    if (!env.MANICBOT) return new Response('KV not bound', { status: 500 });
    const kv = env.MANICBOT;

    try {
      const { dbAll, dbRun } = await import('../utils/db.js');

      // Find all bots without token_encrypted in D1.
      const botsToMigrate = await dbAll(ec, 'SELECT bot_id FROM bots WHERE token_encrypted IS NULL');
      const migratedCount = { success: 0, failed: 0, notInKv: 0 };

      for (const botRow of botsToMigrate) {
        const botId = botRow.bot_id;
        try {
          const kvToken = await kv.get(`bottoken:${botId}`, 'text');
          if (!kvToken) {
            migratedCount.notInKv++;
            continue;
          }
          await dbRun(ec, 'UPDATE bots SET token_encrypted = ? WHERE bot_id = ?', kvToken, botId);
          migratedCount.success++;
          await kv.delete(`bottoken:${botId}`);
        } catch (botErr) {
          log.error('http.adminKey', botErr instanceof Error ? botErr : new Error(String(botErr?.message)), {
            action: 'migrate_bot_tokens_failed',
            botId
          });
          migratedCount.failed++;
        }
      }

      void logEvent(ec, 'admin.migrate_bot_tokens', {
        level: 'info',
        message: `Migrated ${migratedCount.success} bot tokens from KV to D1 (${migratedCount.failed} failed, ${migratedCount.notInKv} not in KV)`
      });

      return Response.json({
        ok: true,
        mode: 'migrate',
        migratedCount,
        totalBots: botsToMigrate.length
      });
    } catch (err) {
      log.error('http.adminKey', err instanceof Error ? err : new Error(String(err?.message)), {
        action: 'migrate_bot_tokens'
      });
      return Response.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }, { status: 500 });
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/provision') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    const ec = envCtx(env);
    if (!ec.db) return Response.json({ error: 'DB not bound' }, { status: 500 });
    const { dbRun } = await import('../utils/db.js');
    try {
      const { bots } = await request.json();
      const results = [];
      for (const b of bots) {
        const botId = b.botToken.split(':')[0];
        let tenantId = b.tenantId;
        let createdTenantId = null;
        try {
        if (tenantId) {
          const existing = await getTenant(ec, tenantId);
          if (!existing) {
            const tRes = await createTenant(ec, b.tenantName || tenantId, env);
            if (tRes.ok) {
              createdTenantId = tRes.tenantId;
              const tPayload = await getTenant(ec, tRes.tenantId);
              if (tPayload && tRes.tenantId !== tenantId) {
                tPayload.id = tenantId;
                if (b.salon) tPayload.salon = b.salon;
                await putTenant(ec, tenantId, tPayload);
                await dbRun(ec, 'DELETE FROM tenants WHERE id = ?', tRes.tenantId);
                createdTenantId = tenantId;
              } else if (tPayload && b.salon) {
                tPayload.salon = b.salon;
                await putTenant(ec, tenantId, tPayload);
              }
            }
          }
        }
        if (!env.BOT_ENCRYPTION_KEY) {
          results.push({ botId, error: 'BOT_ENCRYPTION_KEY required to register bots securely' });
          continue;
        }
        const res = await registerBot(ec, b.botToken, tenantId, b.webhookSecret, env.BOT_ENCRYPTION_KEY);
        if (!res.ok && res.error === 'tenant_has_bot') {
          results.push({ botId, skip: 'tenant_has_bot' });
          continue;
        }
        if (!res.ok) {
          results.push({ botId, error: res.error });
          continue;
        }
        // Batch config writes for atomicity
        const configStmts = [];
        if (b.services)
          configStmts.push(ec.db.prepare("INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'svc_list', ?)").bind(tenantId, JSON.stringify(b.services)));
        if (b.aboutDesc)
          configStmts.push(ec.db.prepare("INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_desc', ?)").bind(tenantId, JSON.stringify(b.aboutDesc)));
        if (b.aboutPhotos)
          configStmts.push(ec.db.prepare("INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_photos', ?)").bind(tenantId, JSON.stringify(b.aboutPhotos)));
        if (env.ADMIN_CHAT_ID)
          configStmts.push(ec.db.prepare("INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'admin', ?)").bind(tenantId, env.ADMIN_CHAT_ID));
        if (configStmts.length > 0) await ec.db.batch(configStmts);
        const whUrl = `${url.origin}/webhook/${botId}`;
        const tg = `https://api.telegram.org/bot${b.botToken}`;
        const whRes = await fetch(`${tg}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: whUrl, secret_token: b.webhookSecret, allowed_updates: ['message', 'callback_query'] }),
        }).then(r => r.json());
        await fetch(`${tg}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commands: [
              { command: 'start', description: '💅 Главное меню / Main menu' },
              { command: 'book', description: '📝 Записаться / Book now' },
              { command: 'my', description: '📋 Мои записи / My appointments' },
              { command: 'lang', description: '🌐 Язык / Language' },
            ],
          }),
        }).catch(() => {});
        results.push({ botId, tenantId, webhook: whRes.ok, webhookUrl: whUrl });
        } catch (botErr) {
          // Rollback: clean up partially-created bot and tenant
          log.error('http.adminKey', botErr instanceof Error ? botErr : new Error(String(botErr?.message)), { action: 'provision_bot_rollback', botId });
          try {
            await dbRun(ec, 'DELETE FROM bots WHERE bot_id = ?', botId);
            if (createdTenantId) {
              await dbRun(ec, 'DELETE FROM tenant_config WHERE tenant_id = ?', createdTenantId);
              await dbRun(ec, 'DELETE FROM tenants WHERE id = ?', createdTenantId);
            }
          } catch (rbErr) {
            log.error('http.adminKey', rbErr instanceof Error ? rbErr : new Error(String(rbErr?.message)), { action: 'provision_rollback_failed', botId });
          }
          results.push({ botId, error: botErr?.message || 'provision_failed' });
        }
      }
      void logEvent(ec, 'admin.provision', { level: 'info', message: `Provisioned ${results.length} bot(s)` });
      void audit(ec, 'admin.provision', { detail: { count: results.length, botIds: results.map(r => r.botId) } });
      return Response.json({ ok: true, results });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'provision' });
      return Response.json({ error: 'Provision failed', code: 'PROVISION_ERROR' }, { status: 400 });
    }
  }

  // POST /admin/ig-token?key=ADMIN_KEY — set and validate Instagram Page Access Token
  if (request.method === 'POST' && url.pathname === '/admin/plugin-addon-checkout') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    try {
      const { slug, tenantId, cycle, priceIdEnv, returnUrl } = await request.json();
      if (!slug || !tenantId || !priceIdEnv) {
        return Response.json({ error: 'slug, tenantId, priceIdEnv required' }, { status: 400 });
      }
      if (cycle !== 'monthly' && cycle !== 'onetime') {
        return Response.json({ error: 'cycle must be monthly or onetime' }, { status: 400 });
      }
      if (!isAllowedAdminReturnUrl(returnUrl, env)) {
        return Response.json({ error: 'returnUrl origin not allowed' }, { status: 400 });
      }
      const priceId = env[priceIdEnv];
      if (!priceId) {
        return Response.json({ error: `Env var ${priceIdEnv} not configured` }, { status: 503 });
      }
      // Look up tenant's existing Stripe customer
      const ec = envCtx(env);
      const { dbGet } = await import('../utils/db.js');
      const tenantRow = await dbGet(ec, 'SELECT stripe_customer_id FROM tenants WHERE id = ?', tenantId);
      const customerId = tenantRow?.stripe_customer_id || null;

      const { getStripeConfig } = await import('../billing/config.js');
      const cfg = getStripeConfig(env);
      if (!cfg.ok) return Response.json({ error: cfg.error }, { status: 503 });

      let success = `${cfg.baseUrl}/?plugin_checkout_ok=1`;
      let cancel = `${cfg.baseUrl}/?plugin_checkout_cancel=1`;
      if (returnUrl) {
        try {
          const u = new URL(returnUrl);
          const baseU = new URL(cfg.baseUrl);
          if (u.origin === baseU.origin) {
            success = returnUrl;
            cancel = returnUrl;
          }
        } catch (e) {}
      }
      const params = {
        mode: cycle === 'monthly' ? 'subscription' : 'payment',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: success,
        cancel_url: cancel,
        'metadata[plugin_slug]': slug,
        'metadata[tenantId]': tenantId,
      };
      if (customerId) params.customer = customerId;
      // Encode form body
      const body = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) {
        return Response.json({ error: data.error?.message || 'Stripe checkout failed' }, { status: 400 });
      }
      return Response.json({ url: data.url, sessionId: data.id });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'plugin_addon_checkout' });
      return Response.json({ error: 'Request failed' }, { status: 400 });
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/ig-token') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    // Refuse to store tokens without an encryption key
    if (!env.BOT_ENCRYPTION_KEY || String(env.BOT_ENCRYPTION_KEY).length < 32) {
      return Response.json({ error: 'BOT_ENCRYPTION_KEY not configured (≥ 32 chars required)' }, { status: 503 });
    }
    try {
      const { token, tenantId } = await request.json();
      if (!token || !tenantId) return Response.json({ error: 'token and tenantId required' }, { status: 400 });

      // Validate token against Graph API
      const meRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`);
      const meData = await meRes.json().catch(() => ({}));
      if (!meRes.ok) {
        return Response.json({ error: 'Token validation failed', graphError: meData.error?.message, graphCode: meData.error?.code }, { status: 400 });
      }

      const ec = envCtx(env);
      const { dbRun } = await import('../utils/db.js');
      const { encryptToken } = await import('../utils/security.js');
      // #S6: same label as token-manager.js — IG tokens go in channel_configs.
      const encrypted = await encryptToken(token, env.BOT_ENCRYPTION_KEY, 'channel-token-v1');
      if (!encrypted) {
        log.error('http.adminKey', new Error('Failed to encrypt IG token'), { action: 'ig_token', tenantId });
        return Response.json({ error: 'Token encryption failed' }, { status: 500 });
      }
      await dbRun(ec,
        `UPDATE channel_configs SET token_encrypted = ?, updated_at = ? WHERE tenant_id = ? AND channel_type = 'instagram'`,
        encrypted, Math.floor(Date.now() / 1000), tenantId,
      );

      void logEvent(ec, 'admin.ig_token', { tenantId, level: 'info', message: 'IG token updated' });
      void audit(ec, 'admin.ig_token', { tenantId, detail: { graphId: meData.id } });
      return Response.json({
        ok: true,
        graphMe: { id: meData.id, name: meData.name },
        tokenPrefix: token.slice(0, 4),
        tenantId,
      });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_token' });
      return Response.json({ error: 'Request failed', code: 'IG_TOKEN_ERROR' }, { status: 400 });
    }
  }

  // POST /admin/ig-set-direct-token — install a new-API "Instagram Login"
  // direct token (prefix `IGAA…`) into D1. Validates via graph.instagram.com
  // /me, confirms returned `id` matches the IG Business ID stored in the
  // channel_configs row, encrypts with BOT_ENCRYPTION_KEY, and writes.
  //
  // Used after generating a token via Meta App Dashboard →
  // Instagram → API setup with Instagram login → Generate token.
  //
  // Auth: Bearer <ADMIN_KEY>. The previous "self-gate" (token must match
  // stored ig_business_id) FAILED OPEN when ig_business_id and the config
  // fallbacks were null — letting any attacker overwrite a tenant's token
  // with a free IGAA token and a tenantId from the public API. The
  // self-gate still runs as defense-in-depth below.
  if (request.method === 'POST' && url.pathname === '/admin/ig-set-direct-token') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    if (!env.BOT_ENCRYPTION_KEY) return Response.json({ error: 'no enc key' }, { status: 503 });
    try {
      const { tenantId, token } = await request.json().catch(() => ({}));
      if (!tenantId || !token) {
        return Response.json({ error: 'tenantId and token required' }, { status: 400 });
      }
      const { dbGet, dbRun } = await import('../utils/db.js');
      const { encryptToken } = await import('../utils/security.js');
      const ec = envCtx(env);

      const row = await dbGet(ec,
        `SELECT id, page_id, ig_business_id, config FROM channel_configs
         WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1 LIMIT 1`,
        tenantId,
      );
      if (!row) return Response.json({ error: 'no IG channel for tenant' }, { status: 404 });

      // Validate against the new Instagram-direct Graph host.
      const meR = await fetch(
        `https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
      );
      const meData = await meR.json().catch(() => ({}));
      if (!meR.ok || !meData.id) {
        return Response.json({
          error: 'token rejected by graph.instagram.com',
          graphStatus: meR.status,
          graphError: meData.error?.message,
        }, { status: 400 });
      }

      // Bind: returned IG ID must match the ig_business_id stored on the row
      // (denormalized column or inside config JSON).
      const cfg = row.config ? (() => { try { return JSON.parse(row.config); } catch { return {}; } })() : {};
      const expectedIg = String(row.ig_business_id || cfg.instagram_business_id || cfg.ig_account_id || '');
      if (expectedIg && String(meData.id) !== expectedIg) {
        return Response.json({
          error: `token belongs to IG ${meData.id} but channel_configs has ${expectedIg}`,
        }, { status: 403 });
      }

      const encrypted = await encryptToken(token, env.BOT_ENCRYPTION_KEY, 'channel-token-v1');
      if (!encrypted) return Response.json({ error: 'encrypt failed' }, { status: 500 });

      // Tag the config blob with `api: "instagram_direct"` so downstream
      // adapters know to talk to graph.instagram.com instead of
      // graph.facebook.com. Old `page_id` is preserved for diagnostics.
      const newCfg = { ...cfg, api: 'instagram_direct', ig_user_id: String(meData.id), ig_username: meData.username || null };

      // #6 — backfill the denormalized `ig_business_id` column on FIRST
      // install. On a fresh IG connect this column is NULL (and config may
      // carry no IG id either), so `expectedIg` resolved to '' and the
      // bind-check above silently passed for ANY token. Persisting the
      // verified IG id here means every SUBSEQUENT install hits the
      // `expectedIg && mismatch → 403` branch — a foreign IGAA token can no
      // longer overwrite an established tenant's channel. We only write when
      // the column is currently empty so a legitimate id is never clobbered.
      const now = Math.floor(Date.now() / 1000);
      // Bug #4 — IGAA long-lived tokens last 60d and are refreshable, but the
      // /me probe doesn't report expiry. Stamp the standard 60d lifetime from a
      // fresh manual install so the cron refresh (isTokenExpiring → refresh at
      // T-10d) can actually fire. Without this the column stayed NULL forever.
      const igExpiresAt = now + 5184000; // 60d
      if (!expectedIg) {
        await dbRun(ec,
          `UPDATE channel_configs
              SET token_encrypted = ?,
                  config = ?,
                  ig_business_id = ?,
                  token_expires_at = ?,
                  updated_at = ?
            WHERE id = ?`,
          encrypted, JSON.stringify(newCfg), String(meData.id), igExpiresAt, now, row.id,
        );
      } else {
        await dbRun(ec,
          `UPDATE channel_configs
              SET token_encrypted = ?,
                  config = ?,
                  token_expires_at = ?,
                  updated_at = ?
            WHERE id = ?`,
          encrypted, JSON.stringify(newCfg), igExpiresAt, now, row.id,
        );
      }

      void logEvent(ec, 'admin.ig_set_direct_token', { level: 'info', tenantId, message: 'IG-direct token installed' });
      void audit(ec, 'admin.ig_set_direct_token', { tenantId, detail: { igUserId: meData.id, username: meData.username } });

      return Response.json({
        ok: true,
        tenantId,
        igUserId: meData.id,
        igUsername: meData.username,
        configApi: 'instagram_direct',
      });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_set_direct_token' });
      return Response.json({ error: 'request failed', message: e?.message }, { status: 400 });
    }
  }

  // POST /admin/ig-diag — outbound test + diagnostic. Reads the current
  // (encrypted) IG token from D1 for the tenant, decrypts it, then:
  //   • GET /me with token → confirms decrypt + Graph reach
  //   • GET /{page_id}/subscribed_apps → confirms our App is on the Page
  //   • If `psid` in body: POST /me/messages → sends a test text to verify
  //     outbound and Page-Messaging permission
  //   • GET /{app_id}/subscriptions → current App-level wiring
  // Auth: Bearer <ADMIN_KEY>. Reads the encrypted Page token and can send
  // outbound DMs on the tenant's behalf when `psid` is supplied — must
  // not be reachable without operator authority.
  if (request.method === 'POST' && url.pathname === '/admin/ig-diag') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    if (!env.BOT_ENCRYPTION_KEY) return Response.json({ error: 'no enc key' }, { status: 503 });
    try {
      const { tenantId, psid } = await request.json().catch(() => ({}));
      const { dbGet } = await import('../utils/db.js');
      const { decryptTokenWithFallback } = await import('../utils/security.js');
      const ec = envCtx(env);
      const row = await dbGet(ec,
        `SELECT page_id, token_encrypted FROM channel_configs
         WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1 LIMIT 1`,
        tenantId,
      );
      if (!row) return Response.json({ error: 'no IG channel' }, { status: 404 });
      const { plain: pageToken } = await decryptTokenWithFallback(
        row.token_encrypted, env.BOT_ENCRYPTION_KEY, env.BOT_ENCRYPTION_KEY_OLD || null,
        'channel-token-v1',
      );
      if (!pageToken) return Response.json({ error: 'decrypt failed' }, { status: 500 });

      const out = { pageId: row.page_id };

      const meR = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`);
      out.me = { ok: meR.ok, ...(await meR.json().catch(() => ({}))) };

      const sR = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(row.page_id)}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`);
      out.subscribedApps = { ok: sR.ok, ...(await sR.json().catch(() => ({}))) };

      if (env.META_APP_ID && env.META_APP_SECRET) {
        const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
        const aR = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.META_APP_ID)}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
        out.appSubscriptions = { ok: aR.ok, ...(await aR.json().catch(() => ({}))) };
      }

      if (psid) {
        const payload = JSON.stringify({
          recipient: { id: String(psid) },
          message: { text: 'ManicBot diagnostic ping (ignore)' },
          messaging_type: 'RESPONSE',
        });
        const sendR = await fetch(
          `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload },
        );
        out.testSend = { ok: sendR.ok, status: sendR.status, ...(await sendR.json().catch(() => ({}))) };
      }

      return Response.json(out);
    } catch (e) {
      return Response.json({ error: 'failed', message: e?.message }, { status: 400 });
    }
  }

  // POST /admin/ig-app-subscribe — (re)register App-level webhook for IG.
  // Distinct from Page-level subscribed_apps; both must be active. Idempotent.
  // Auth: Bearer <ADMIN_KEY>. Re-registering the App-level webhook is an
  // operator action that affects every tenant's IG delivery.
  if (request.method === 'POST' && url.pathname === '/admin/ig-app-subscribe') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      return Response.json({ error: 'META_APP_ID + META_APP_SECRET required in env' }, { status: 503 });
    }
    try {
      const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
      const FIELDS = 'messages,messaging_postbacks,message_reads';
      const callbackUrl = `${env.APP_BASE_URL || 'https://manicbot.com'}/webhook/ig`;
      const verifyToken = env.META_VERIFY_TOKEN_IG || '';
      const listR = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(env.META_APP_ID)}/subscriptions?access_token=${encodeURIComponent(appToken)}`,
      );
      const before = await listR.json().catch(() => ({}));
      const params = new URLSearchParams({
        object: 'instagram',
        callback_url: callbackUrl,
        fields: FIELDS,
        verify_token: verifyToken,
        access_token: appToken,
      });
      const postR = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(env.META_APP_ID)}/subscriptions`,
        { method: 'POST', body: params },
      );
      const after = await postR.json().catch(() => ({}));
      const listR2 = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(env.META_APP_ID)}/subscriptions?access_token=${encodeURIComponent(appToken)}`,
      );
      const finalList = await listR2.json().catch(() => ({}));
      return Response.json({
        ok: postR.ok,
        callbackUrl,
        before,
        postResult: { ok: postR.ok, body: after },
        finalList,
      });
    } catch (e) {
      return Response.json({ error: 'request failed', message: e?.message }, { status: 400 });
    }
  }

  // POST /admin/ig-recover — emergency recovery path used when the encrypted
  // IG token in `channel_configs` can no longer be decrypted (key rotated,
  // re-encrypt sweep didn't run, etc.). Accepts a FB User Access Token,
  // verifies via Graph that the caller actually controls the same Page that
  // is already stored in D1 (token's /me/accounts must include the stored
  // page_id), then exchanges for a long-lived token, derives the Page Access
  // Token, encrypts and saves.
  //
  // Auth model: no Bearer key. Self-gated — only fires when:
  //   1. The row's current token_encrypted FAILS to decrypt with both
  //      BOT_ENCRYPTION_KEY and BOT_ENCRYPTION_KEY_OLD (genuine recovery),
  //   2. The supplied User Token's /me/accounts returns the SAME page_id
  //      that's already in the channel_configs row (binds the caller to
  //      pre-existing operator authority on that Page).
  //
  // Both gates must pass — an attacker without an existing valid IG record
  // cannot use this to inject a new channel.
  if (request.method === 'POST' && url.pathname === '/admin/ig-recover') {
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    if (!env.BOT_ENCRYPTION_KEY || String(env.BOT_ENCRYPTION_KEY).length < 32) {
      return Response.json({ error: 'BOT_ENCRYPTION_KEY not configured' }, { status: 503 });
    }
    // A11 — during an active key rotation (BOT_ENCRYPTION_KEY_OLD set) the
    // self-gated recovery path is disabled. Mid-rotation a stale blob can still
    // decrypt via the old key, so Gate 1's "token is dead" signal is unreliable,
    // leaving Graph Page-control as the only authz — and a Page sub-admin is not
    // necessarily the salon owner. Route rotation-window changes through the
    // ADMIN_KEY-gated /admin/ig-token instead.
    if (env.BOT_ENCRYPTION_KEY_OLD) {
      return Response.json({
        error: 'key rotation in progress (BOT_ENCRYPTION_KEY_OLD set) — recovery path disabled. Use POST /admin/ig-token with ADMIN_KEY.',
      }, { status: 409 });
    }
    try {
      const { tenantId, userToken } = await request.json().catch(() => ({}));
      if (!tenantId || !userToken) {
        return Response.json({ error: 'tenantId and userToken required' }, { status: 400 });
      }

      const { dbGet, dbRun } = await import('../utils/db.js');
      const { decryptTokenWithFallback, encryptToken } = await import('../utils/security.js');
      const ec = envCtx(env);

      const row = await dbGet(ec,
        `SELECT id, page_id, token_encrypted FROM channel_configs
         WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1
         LIMIT 1`,
        tenantId,
      );
      if (!row) return Response.json({ error: 'no IG channel for tenant' }, { status: 404 });
      if (!row.page_id) return Response.json({ error: 'channel row missing page_id' }, { status: 400 });

      // Gate 1: current token must be dead (key rotated without re-encrypt).
      if (row.token_encrypted) {
        const { plain } = await decryptTokenWithFallback(
          row.token_encrypted, env.BOT_ENCRYPTION_KEY,
          env.BOT_ENCRYPTION_KEY_OLD || null, 'channel-token-v1',
        );
        if (plain) {
          return Response.json({
            error: 'existing token is healthy — refusing to overwrite via recovery path. Use POST /admin/ig-token with ADMIN_KEY for routine rotation.',
          }, { status: 409 });
        }
      }

      // Gate 2: User Token must have authority over the SAME Page.
      const accountsRes = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token&access_token=${encodeURIComponent(userToken)}`,
      );
      const accountsData = await accountsRes.json().catch(() => ({}));
      if (!accountsRes.ok) {
        return Response.json({ error: 'User Token rejected by Graph', graphError: accountsData.error?.message }, { status: 400 });
      }
      const pageEntry = (accountsData.data || []).find(p => String(p.id) === String(row.page_id));
      if (!pageEntry || !pageEntry.access_token) {
        return Response.json({
          error: `User Token does not control the stored Page (id=${row.page_id})`,
          pagesSeen: (accountsData.data || []).map(p => p.id),
        }, { status: 403 });
      }

      // Exchange the User Token for long-lived, then re-derive the Page Token
      // from the long-lived user token so the Page Token is non-expiring.
      let finalPageToken = pageEntry.access_token;
      if (env.META_APP_ID && env.META_APP_SECRET) {
        const ll = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(env.META_APP_ID)}&client_secret=${encodeURIComponent(env.META_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(userToken)}`,
        );
        const llData = await ll.json().catch(() => ({}));
        if (ll.ok && llData.access_token) {
          const longLivedUserToken = llData.access_token;
          const acc2 = await fetch(
            `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token&access_token=${encodeURIComponent(longLivedUserToken)}`,
          );
          const acc2Data = await acc2.json().catch(() => ({}));
          const pe2 = (acc2Data.data || []).find(p => String(p.id) === String(row.page_id));
          if (pe2?.access_token) finalPageToken = pe2.access_token;
        }
      }

      const encrypted = await encryptToken(finalPageToken, env.BOT_ENCRYPTION_KEY, 'channel-token-v1');
      if (!encrypted) return Response.json({ error: 'encryption failed' }, { status: 500 });

      await dbRun(ec,
        `UPDATE channel_configs SET token_encrypted = ?, updated_at = ?
         WHERE id = ?`,
        encrypted, Math.floor(Date.now() / 1000), row.id,
      );

      // Immediately re-subscribe the Page to webhook fields with the fresh token.
      const FIELDS = 'messages,messaging_postbacks,message_reads';
      const subRes = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(row.page_id)}/subscribed_apps?subscribed_fields=${encodeURIComponent(FIELDS)}&access_token=${encodeURIComponent(finalPageToken)}`,
        { method: 'POST' },
      );
      const subData = await subRes.json().catch(() => ({}));

      // App-level webhook subscription for object='instagram'. This is the
      // GLOBAL configuration that tells Meta where to POST IG events. It is
      // distinct from Page-level subscribed_apps — both must be active or
      // Meta won't deliver. Uses App Access Token (APP_ID|APP_SECRET).
      let appSubs = { skipped: 'no META_APP_ID/SECRET' };
      if (env.META_APP_ID && env.META_APP_SECRET) {
        const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
        // GET current
        const listR = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(env.META_APP_ID)}/subscriptions?access_token=${encodeURIComponent(appToken)}`,
        );
        const listData = await listR.json().catch(() => ({}));
        // POST to (re)subscribe for instagram
        const callbackUrl = `${env.APP_BASE_URL || 'https://manicbot.com'}/webhook/ig`;
        const verifyToken = env.META_VERIFY_TOKEN_IG || '';
        const params = new URLSearchParams({
          object: 'instagram',
          callback_url: callbackUrl,
          fields: FIELDS,
          verify_token: verifyToken,
          access_token: appToken,
        });
        const postR = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(env.META_APP_ID)}/subscriptions`,
          { method: 'POST', body: params },
        );
        const postData = await postR.json().catch(() => ({}));
        appSubs = {
          before: listData,
          afterPost: { ok: postR.ok, body: postData, callbackUrl },
        };
      }

      void logEvent(ec, 'admin.ig_recover', { level: 'info', tenantId, message: 'IG token recovered + Page re-subscribed' });
      void audit(ec, 'admin.ig_recover', { tenantId, detail: { pageId: row.page_id, subscribed: subRes.ok } });

      return Response.json({
        ok: true,
        tenantId,
        pageId: row.page_id,
        tokenStored: true,
        subscribedApps: { ok: subRes.ok, response: subData },
        appSubscriptions: appSubs,
      });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_recover' });
      return Response.json({ error: 'Request failed', message: e?.message }, { status: 400 });
    }
  }

  // POST /admin/ig-resubscribe — re-subscribe the Facebook Page (linked to an
  // IG Business account) to messages/messaging_postbacks/message_reads so
  // Meta resumes delivering DM webhooks. Optional body { tenantId } scopes
  // to one tenant; omit to refresh every active IG channel.
  //
  // Built after live diagnosis (2026-05-14): worker tail saw 0 IG POSTs in a
  // 2-min window after a real user DM — Page subscription had silently lapsed.
  if (request.method === 'POST' && url.pathname === '/admin/ig-resubscribe') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    if (!env.BOT_ENCRYPTION_KEY || String(env.BOT_ENCRYPTION_KEY).length < 32) {
      return Response.json({ error: 'BOT_ENCRYPTION_KEY not configured (≥ 32 chars required)' }, { status: 503 });
    }
    try {
      const { tenantId } = await request.json().catch(() => ({}));
      const { decryptToken } = await import('../utils/security.js');
      const sql = tenantId
        ? `SELECT tenant_id, page_id, token_encrypted FROM channel_configs
             WHERE channel_type = 'instagram' AND active = 1 AND tenant_id = ?`
        : `SELECT tenant_id, page_id, token_encrypted FROM channel_configs
             WHERE channel_type = 'instagram' AND active = 1`;
      const stmt = env.DB.prepare(sql);
      const bound = tenantId ? stmt.bind(tenantId) : stmt.bind();
      const rs = await bound.all();
      const rows = rs?.results ?? [];

      const FIELDS = 'messages,messaging_postbacks,message_reads';
      const results = [];
      for (const row of rows) {
        const entry = { tenantId: row.tenant_id, pageId: row.page_id, graphSuccess: false };
        if (!row.page_id || !row.token_encrypted) {
          entry.error = !row.page_id ? 'missing page_id' : 'missing token';
          results.push(entry);
          continue;
        }
        const token = await decryptToken(row.token_encrypted, env.BOT_ENCRYPTION_KEY, 'channel-token-v1');
        if (!token) { entry.error = 'token decrypt failed'; results.push(entry); continue; }
        const graphUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(row.page_id)}/subscribed_apps?subscribed_fields=${encodeURIComponent(FIELDS)}&access_token=${encodeURIComponent(token)}`;
        try {
          const r = await fetch(graphUrl, { method: 'POST' });
          const data = await r.json().catch(() => ({}));
          entry.graphSuccess = !!(r.ok && (data.success === true || data.success === undefined));
          entry.graphStatus = r.status;
          if (!entry.graphSuccess) entry.graphError = data.error?.message || `HTTP ${r.status}`;
        } catch (e) {
          entry.error = `graph fetch failed: ${e?.message || e}`;
        }
        results.push(entry);
      }

      const ec = envCtx(env);
      void logEvent(ec, 'admin.ig_resubscribe', { level: 'info', message: `resubscribed ${results.filter(r => r.graphSuccess).length}/${results.length}` });
      void audit(ec, 'admin.ig_resubscribe', { detail: { count: results.length, ok: results.filter(r => r.graphSuccess).length } });
      return Response.json({ ok: true, results });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_resubscribe' });
      return Response.json({ error: 'Request failed' }, { status: 400 });
    }
  }

  // POST /admin/ig-channel?key=ADMIN_KEY — create Instagram channel config for a tenant
  if (request.method === 'POST' && url.pathname === '/admin/ig-channel') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    // Refuse to store tokens without an encryption key
    if (!env.BOT_ENCRYPTION_KEY || String(env.BOT_ENCRYPTION_KEY).length < 32) {
      return Response.json({ error: 'BOT_ENCRYPTION_KEY not configured (≥ 32 chars required)' }, { status: 503 });
    }
    try {
      const { token, pageId, tenantId, tenantName, igAccountId, instagramBusinessId } = await request.json();
      if (!token || !pageId) return Response.json({ error: 'token and pageId required' }, { status: 400 });
      if (!tenantId && !tenantName) return Response.json({ error: 'tenantId or tenantName required' }, { status: 400 });

      const ec = envCtx(env);
      const { dbAll } = await import('../utils/db.js');

      // Resolve or create tenant
      let resolvedTenantId = tenantId;
      if (tenantId) {
        const existing = await getTenant(ec, tenantId);
        if (!existing) return Response.json({ error: 'tenant not found' }, { status: 404 });
      } else {
        const tRes = await createTenant(ec, tenantName, env);
        if (!tRes.ok) return Response.json({ error: 'tenant creation failed' }, { status: 500 });
        resolvedTenantId = tRes.tenantId;
      }

      // Guard: reject if active IG config already exists
      const existing = await dbAll(ec,
        "SELECT id FROM channel_configs WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1 LIMIT 1",
        resolvedTenantId,
      );
      if (existing.length) {
        return Response.json({ error: 'IG channel already exists for this tenant — use POST /admin/ig-token to update token', existingId: existing[0].id }, { status: 409 });
      }

      // Validate token against Graph API
      const meRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`);
      const meData = await meRes.json().catch(() => ({}));
      if (!meRes.ok) {
        return Response.json({ error: 'Token validation failed', graphError: meData.error?.message }, { status: 400 });
      }

      // Create channel config
      const config = { page_id: String(pageId) };
      if (igAccountId) config.ig_account_id = String(igAccountId);
      if (instagramBusinessId) config.instagram_business_id = String(instagramBusinessId);

      const { createChannelConfig } = await import('../channels/token-manager.js');
      const channelConfigId = await createChannelConfig(ec, resolvedTenantId, 'instagram', config, token, env.BOT_ENCRYPTION_KEY);
      if (!channelConfigId) {
        // createChannelConfig returns null on encryption failure or UNIQUE
        // collision (#P1-4). The collision case means another tenant already
        // owns the same page_id / instagram_business_id; surface 409.
        return Response.json({
          error: 'IG channel registration failed — page_id may already be claimed by another tenant',
          code: 'IG_CHANNEL_DUPLICATE_OR_ENC_FAIL',
        }, { status: 409 });
      }

      return Response.json({
        ok: true,
        tenantId: resolvedTenantId,
        channelConfigId,
        graphMe: { id: meData.id, name: meData.name },
      });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_channel' });
      return Response.json({ error: 'Request failed', code: 'IG_CHANNEL_ERROR' }, { status: 400 });
    }
  }

  // POST /admin/ig-send-test — send a test Instagram DM from the tenant's bot to a PSID.
  // Diagnostic for the salon owner: proves the channel is wired and the token is alive.
  // Returns the raw Graph response (or {ok:false,error:'outside_message_window'}) so
  // the operator sees Meta's verdict directly.
  if (request.method === 'POST' && url.pathname === '/admin/ig-send-test') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    if (!env.BOT_ENCRYPTION_KEY || String(env.BOT_ENCRYPTION_KEY).length < 32) {
      return Response.json({ error: 'BOT_ENCRYPTION_KEY not configured' }, { status: 503 });
    }
    try {
      const { tenantId, psid, text } = await request.json();
      if (!tenantId || !psid) {
        return Response.json({ error: 'tenantId and psid required' }, { status: 400 });
      }
      const ec = envCtx(env);
      const { dbAll } = await import('../utils/db.js');
      const rows = await dbAll(ec,
        "SELECT id, config, token_encrypted FROM channel_configs WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1 LIMIT 1",
        tenantId,
      );
      if (!rows.length) {
        return Response.json({ error: 'no_active_ig_channel' }, { status: 404 });
      }
      const row = rows[0];
      const { getDecryptedToken } = await import('../channels/token-manager.js');
      const token = await getDecryptedToken(ec, tenantId, row.id, env.BOT_ENCRYPTION_KEY);
      if (!token) {
        return Response.json({ error: 'token_decrypt_failed' }, { status: 503 });
      }
      let cfg = {};
      try { cfg = row.config ? JSON.parse(row.config) : {}; } catch {}

      const { InstagramAdapter } = await import('../channels/instagram.js');
      const adapter = new InstagramAdapter({
        tenantId,
        channelConfig: { config: cfg, token },
        // No DB ref → adapter skips the 24h-window guard (test-diagnostic mode).
        // The diagnostic value is "did Meta accept the call" — surface Meta's
        // own answer instead of pre-rejecting based on our window cache.
      });
      const message = typeof text === 'string' && text.trim().length > 0
        ? text.trim()
        : 'Test message from your Instagram bot 👋';
      const sendRes = await adapter.send(String(psid), { text: message });
      return Response.json({
        ok: !!sendRes?.ok,
        sendRes,
        api: cfg.api || 'facebook',
      });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_send_test' });
      return Response.json({ error: 'Request failed', code: 'IG_SEND_TEST_ERROR' }, { status: 500 });
    }
  }

  // POST /admin/appointment-action?key=ADMIN_KEY — trigger notifications + calendar sync from admin-app
  if (request.method === 'POST' && url.pathname === '/admin/appointment-action') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    try {
      const { action, appointmentId, tenantId, oldDate, oldTime, apt: bodyApt } = await request.json();
      if (!action || !appointmentId || !tenantId) {
        return Response.json({ error: 'action, appointmentId, tenantId required' }, { status: 400 });
      }

      const ec = envCtx(env);

      // Build tenant context
      const tenant = await getTenant(ec, tenantId);
      if (!tenant) return Response.json({ error: 'tenant not found' }, { status: 404 });

      const botIds = await getBotIdsByTenantId(ec, tenantId);
      let bot = null;
      let botToken = null;
      if (botIds.length) {
        bot = await getBot(ec, botIds[0]);
        botToken = bot ? await getBotToken(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null) : null;
      }

      const { buildTenantCtx } = await import('../tenant/resolver.js');
      const ctx = buildTenantCtx(env, {
        tenantId,
        tenant,
        bot: bot ? { ...bot, botToken } : { botToken: null, webhookSecret: '' },
        TG: botToken ? `https://api.telegram.org/bot${botToken}` : null,
      });

      const { initServices } = await import('../services/services.js');
      await initServices(ctx);

      const { getAptById } = await import('../services/appointments.js');
      let apt = await getAptById(ctx, appointmentId);
      // Read-after-write fallback for the calendar-only `sync_calendar` action:
      // appointments.createManual inserts the row then immediately calls this
      // endpoint, so the row may not yet be visible to this Worker's D1 read.
      // Accept the appointment payload from the request body when it is
      // tenant-matched — otherwise the push is silently dropped to the ≤15-min
      // phaseGcalSync cron (the exact delay #358 set out to remove). Tenant
      // isolation: the payload's tenantId MUST equal the authenticated tenantId
      // and its id MUST equal appointmentId.
      if (!apt && action === 'sync_calendar' && bodyApt
          && bodyApt.id === appointmentId && bodyApt.tenantId === tenantId) {
        apt = bodyApt;
      }
      if (!apt) return Response.json({ error: 'appointment not found' }, { status: 404 });

      let notified = false;
      let calendarSynced = false;

      if (action === 'confirm') {
        const { sendAptConfirmedToClient } = await import('../notifications.js');
        await sendAptConfirmedToClient(ctx, apt);
        notified = true;

        const { canUse } = await import('../billing/features.js');
        if (canUse(ctx, 'calendar')) {
          try {
            const { syncAppointmentCalendar } = await import('../services/google-calendar-oauth.js');
            await syncAppointmentCalendar(ctx, apt);
            calendarSynced = true;
          } catch (e) {
            log.error('http.adminKey', e instanceof Error ? e : new Error(String(e.message)), { action: 'appointment_calendar_sync' });
          }
        }
      } else if (action === 'reject') {
        const { getLang } = await import('../services/chat.js');
        const { send } = await import('../telegram.js');
        const { t, fill } = await import('../i18n/index.js');
        const { fmtDT } = await import('../utils/date.js');
        const { svcName } = await import('../utils/helpers.js');
        const { CB } = await import('../config.js');
        const clg = (await getLang(ctx, apt.chatId)) || 'ru';
        let clientMsg = fill(t(clg, 'apt_rejected'), { svc: svcName(ctx, clg, apt.svcId), dt: fmtDT(clg, apt.date, apt.time) });
        clientMsg += t(clg, 'apt_rebook');
        await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
          [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
          [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
        ]}});
        notified = true;
      } else if (action === 'cancel') {
        const { notifyStaffAptCancelled } = await import('../notifications.js');
        await notifyStaffAptCancelled(ctx, apt);
        notified = true;
      } else if (action === 'reschedule') {
        // Notify the client their appointment moved to a new slot. The
        // admin-app mutation sends the prior date/time so the message
        // shows "Was X → Now Y" instead of just the current values.
        const { sendAptRescheduledToClient, notifyStaffAptRescheduled } = await import('../notifications.js');
        await sendAptRescheduledToClient(ctx, apt, oldDate || null, oldTime || null);
        // Bell row for the assigned master + tenant owner.
        await notifyStaffAptRescheduled(ctx, apt, oldDate || null, oldTime || null).catch((e) =>
          log.warn('http.adminKey', { action: 'reschedule_inapp', error: e?.message?.slice(0, 200) }),
        );
        notified = true;
        const { canUse } = await import('../billing/features.js');
        if (canUse(ctx, 'calendar')) {
          try {
            const { syncAppointmentCalendar } = await import('../services/google-calendar-oauth.js');
            await syncAppointmentCalendar(ctx, apt);
            calendarSynced = true;
          } catch (e) {
            log.error('http.adminKey', e instanceof Error ? e : new Error(String(e.message)), { action: 'appointment_calendar_sync_reschedule' });
          }
        }
      } else if (action === 'sync_calendar') {
        // Calendar-only push, NO client message. Used by dashboard manual
        // bookings (appointments.createManual): the row is created
        // already-confirmed and the client must not be re-notified, but the
        // event must land in the connected Google Calendar immediately
        // instead of waiting for the ≤10-min phaseGcalSync cron. Mirrors the
        // confirm branch's calendar sync, gated by the plan feature.
        const { canUse } = await import('../billing/features.js');
        if (canUse(ctx, 'calendar')) {
          try {
            const { syncAppointmentCalendar } = await import('../services/google-calendar-oauth.js');
            const result = await syncAppointmentCalendar(ctx, apt);
            calendarSynced = !!result?.ok;
            if (!result?.ok && !result?.skipped) {
              // Don't swallow a failed push: surface it so it's diagnosable.
              // The row keeps google_event_id NULL, so phaseGcalSync retries.
              log.warn('http.adminKey', { action: 'appointment_calendar_sync_manual_failed', aptId: appointmentId, error: result?.error });
            }
          } catch (e) {
            log.error('http.adminKey', e instanceof Error ? e : new Error(String(e.message)), { action: 'appointment_calendar_sync_manual' });
          }
        }
      } else if (action === 'done' || action === 'no_show_client' || action === 'no_show_master') {
        // New unified path — routes through the marketing-automation
        // dispatcher. The dispatcher always runs deterministic D1
        // side-effects (lifetime_visits bump on done, reminder cleanup,
        // analytics row) and decides whether to send a default client
        // message. Marketing rows in `marketing_automations` will
        // override the default once the marketing engine is wired (PR 3).
        const { dispatchAppointmentAutomation } = await import('../services/appointmentAutomations.js');
        const eventType =
          action === 'done' ? 'appointment.done'
          : action === 'no_show_client' ? 'appointment.no_show_client'
          : 'appointment.no_show_master';
        const result = await dispatchAppointmentAutomation(ctx, apt, eventType);
        notified = !!result.notified;
        return Response.json({
          ok: true,
          action,
          appointmentId,
          notified,
          calendarSynced: false,
          automationsFired: result.automationsFired ?? 0,
        });
      } else {
        return Response.json({ error: 'unknown action', code: 'UNKNOWN_APPOINTMENT_ACTION' }, { status: 400 });
      }

      return Response.json({ ok: true, action, appointmentId, notified, calendarSynced });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'appointment_action' });
      return Response.json({ error: 'Action failed', code: 'APPOINTMENT_ACTION_ERROR' }, { status: 500 });
    }
  }

  // GET /admin/reset-webhooks?key=ADMIN_KEY — re-register Telegram webhooks for all bots
  // Use this when webhook secrets are out of sync (e.g. after timingSafeEqual fix)
  if (url.pathname === '/admin/reset-webhooks') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    const ec = envCtx(env);
    if (!ec.db) return Response.json({ error: 'DB not bound' }, { status: 500 });
    const baseUrl = (env.APP_BASE_URL || url.origin).replace(/\/$/, '');
    // Optional ?botId= → re-register just that one bot (the per-row button in
    // the admin-app Bots page). Omitted → re-register every bot (original).
    const onlyBotId = url.searchParams.get('botId');
    const results = [];
    try {
      const tenantIds = await listTenantIds(ec);
      for (const tenantId of tenantIds) {
        const botIds = await getBotIdsByTenantId(ec, tenantId);
        for (const botId of botIds) {
          if (onlyBotId && botId !== onlyBotId) continue;
          const bot = await getBot(ec, botId);
          const token = await getBotToken(ec, botId, env.BOT_ENCRYPTION_KEY || null);
          if (!token) { results.push({ botId, tenantId, error: 'no token' }); continue; }
          const webhookSecret = bot?.webhookSecret || '';
          const whUrl = `${baseUrl}/webhook/${botId}`;
          try {
            const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: whUrl, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'] }),
            });
            const data = await r.json();
            results.push({ botId, tenantId, ok: data.ok, url: whUrl, hasSecret: !!webhookSecret });
          } catch (e) {
            log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'reset_webhooks_setWebhook', botId });
            results.push({ botId, tenantId, error: 'setWebhook failed' });
          }
        }
      }
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'reset_webhooks' });
      return Response.json({ error: 'Reset failed', code: 'RESET_WEBHOOKS_ERROR' }, { status: 500 });
    }
    return Response.json({ ok: true, count: results.length, results });
  }

  // GET /admin/bots-status — God Mode: live Telegram webhook status for every
  // bot. Backs the admin-app "Bots" page so a silently-unregistered webhook
  // (the failure that makes bots go dark) is visible at a glance. Auth: Bearer
  // ADMIN_KEY. Read-only: getWebhookInfo per bot, in parallel. The response
  // carries webhook metadata ONLY — never the bot token.
  if (url.pathname === '/admin/bots-status') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    const ec = envCtx(env);
    if (!ec.db) return Response.json({ error: 'DB not bound' }, { status: 500 });
    const bots = [];
    try {
      // tenant-scan-ignore: God Mode platform-wide bot status (ADMIN_KEY-gated, cross-tenant by design)
      const tenantIds = await listTenantIds(ec);
      const pairs = [];
      for (const tenantId of tenantIds) {
        const botIds = await getBotIdsByTenantId(ec, tenantId);
        for (const botId of botIds) pairs.push({ tenantId, botId });
      }
      await Promise.all(pairs.map(async ({ tenantId, botId }) => {
        const bot = await getBot(ec, botId);
        const token = await getBotToken(ec, botId, env.BOT_ENCRYPTION_KEY || null);
        let webhook;
        if (!token) {
          webhook = { ok: false, set: false, error: 'no_token' };
        } else {
          try {
            const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) });
            const data = await r.json().catch(() => ({}));
            if (data && data.ok && data.result) {
              const info = data.result;
              webhook = {
                ok: true,
                set: !!info.url,
                url: info.url || '',
                pending: info.pending_update_count || 0,
                lastErrorDate: info.last_error_date || null,
                lastErrorMessage: info.last_error_message || null,
              };
            } else {
              webhook = { ok: false, set: false, error: (data && data.description) || 'getWebhookInfo_failed' };
            }
          } catch (e) {
            webhook = { ok: false, set: false, error: e?.message || 'fetch_failed' };
          }
        }
        bots.push({ botId, tenantId, username: bot?.botUsername || null, active: bot?.active ?? false, webhook });
      }));
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'bots_status' });
      return Response.json({ error: 'bots_status_failed', code: 'BOTS_STATUS_ERROR' }, { status: 500 });
    }
    bots.sort((a, b) => String(a.tenantId).localeCompare(String(b.tenantId)) || String(a.botId).localeCompare(String(b.botId)));
    return Response.json({ ok: true, count: bots.length, bots });
  }

  // GET /admin/register-admin-bot-webhook — register the platform admin/ops bot's
  // Telegram webhook + slash commands. Auth: Bearer ADMIN_KEY. Reuses NOTIFY_BOT_TOKEN
  // (or ADMIN_BOT_TOKEN) + ADMIN_WEBHOOK_SECRET. Refuses if the secret is too short
  // or if the botId belongs to a registered client bot (hijack guard). Re-run this
  // after rotating ADMIN_WEBHOOK_SECRET or the admin bot token.
  if (url.pathname === '/admin/register-admin-bot-webhook') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    const baseUrl = (env.APP_BASE_URL || url.origin).replace(/\/$/, '');
    const result = await registerAdminBotWebhook(env, baseUrl);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  // POST /admin/web-user?key=ADMIN_KEY — create or update a web (email/password) user for the admin-app
  // Body: { email, password, tenantId?, role? }
  if (request.method === 'POST' && url.pathname === '/admin/web-user') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const ec = envCtx(env);

    let body;
    try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

    const { email, password, tenantId = null, role = 'tenant_owner' } = body || {};
    if (!email || !password) return Response.json({ error: 'email and password required' }, { status: 400 });
    if (password.length < 12) return Response.json({ error: 'password must be at least 12 characters' }, { status: 400 });

    // #S1 fix — privilege escalation: enforce role allowlist.
    // system_admin is intentionally NOT in this set: platform admins are minted via
    // direct DB migration or wrangler command with audit, never via HTTP.
    if (!ALLOWED_CREATE_ROLES.has(role)) {
      void logEvent(ec, 'security.role_rejected', {
        level: 'warn',
        message: `Rejected /admin/web-user with role="${role}"`,
        detail: { email, attemptedRole: role, ip: request.headers.get('cf-connecting-ip') || null },
      });
      return Response.json({ error: 'invalid_role', allowed: Array.from(ALLOWED_CREATE_ROLES) }, { status: 400 });
    }

    // Hash password with PBKDF2 (Web Crypto — same algorithm as admin-app/src/server/auth/password.ts)
    // Iterations raised to 600k per OWASP 2023 recommendation.
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, keyMaterial, 256);
    const hexEncode = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const passwordHash = `pbkdf2:600000:${hexEncode(salt.buffer)}:${hexEncode(bits)}`;

    const normalizedEmail = email.toLowerCase().trim();
    const now = Math.floor(Date.now() / 1000);
    const id = `wu_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    // Upsert (insert or replace on email conflict)
    try {
      await env.DB.prepare(
        `INSERT INTO web_users (id, email, password_hash, tenant_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           password_hash = excluded.password_hash,
           tenant_id = excluded.tenant_id,
           role = excluded.role,
           updated_at = excluded.updated_at`
      ).bind(id, normalizedEmail, passwordHash, tenantId, role, now, now).run();
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'web_user_upsert' });
      return Response.json({ error: 'Web user upsert failed', code: 'WEB_USER_ERROR' }, { status: 500 });
    }

    void logEvent(ec, 'admin.web_user', { tenantId, level: 'info', message: `Web user created: ${normalizedEmail} (${role})` });
    void audit(ec, 'admin.web_user', { tenantId, detail: { email: normalizedEmail, role } });
    return Response.json({ ok: true, email: normalizedEmail, tenantId, role });
  }

  // POST /admin/google/oauth-url — mint a web-mode Google OAuth connect URL for the admin mini-app.
  // Body: { tenantId, scope?: 'tenant'|'master', masterChatId?, returnUrl? }
  if (request.method === 'POST' && url.pathname === '/admin/google/oauth-url') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    const { tenantId, scope = 'tenant', masterChatId = null, returnUrl = null } = body || {};
    if (!tenantId) return Response.json({ error: 'tenantId required' }, { status: 400 });
    if (scope !== 'tenant' && scope !== 'master') {
      return Response.json({ error: 'scope must be tenant or master' }, { status: 400 });
    }
    try {
      const ec = { ...envCtx(env), ...env, baseUrl: (env.APP_BASE_URL || url.origin).replace(/\/$/, '') };
      const { createWebOAuthSession } = await import('../services/google-calendar-oauth.js');
      const result = await createWebOAuthSession(ec, { tenantId, scope, masterChatId, returnUrl });
      if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
      void audit(ec, 'google.web_oauth_url', { tenantId, detail: { scope, sessionId: result.sessionId } });
      return Response.json({ ok: true, connectUrl: result.connectUrl });
    } catch (e) {
      log.error('http.adminKey', e instanceof Error ? e : new Error(String(e?.message)), { action: 'google_oauth_url' });
      return Response.json({ error: 'Failed to mint OAuth URL' }, { status: 500 });
    }
  }

  // GET /admin/events?key=ADMIN_KEY&limit=100&type=...&tenantId=...
  if (request.method === 'GET' && url.pathname === '/admin/events') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.MANICBOT) return Response.json({ error: 'KV not bound' }, { status: 500 });

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const typeFilter = url.searchParams.get('type') || '';
    const tenantIdFilter = url.searchParams.get('tenantId') || '';

    let list = [];
    try {
      const raw = await env.MANICBOT.get('adminlog:recent');
      if (raw) list = JSON.parse(raw);
    } catch { /* ignore */ }

    if (typeFilter) list = list.filter(e => e.type === typeFilter || e.type.startsWith(typeFilter + '.'));
    if (tenantIdFilter) list = list.filter(e => e.tenantId === tenantIdFilter);
    list = list.slice(0, limit);

    return Response.json({ events: list });
  }

  // DELETE /admin/events/clear?key=ADMIN_KEY
  if (request.method === 'DELETE' && url.pathname === '/admin/events/clear') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.MANICBOT) return Response.json({ error: 'KV not bound' }, { status: 500 });
    await env.MANICBOT.delete('adminlog:recent');
    return Response.json({ ok: true });
  }

  // GET /admin/index-salons?key=ADMIN_KEY — bulk-index all tenants into FTS + set public_active=1
  if (url.pathname === '/admin/index-salons') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const ec = envCtx(env);
    const { dbAll, dbRun } = await import('../utils/db.js');

    // Get all active tenants
    const tenantRows = await dbAll(ec, `SELECT id, name, description, city FROM tenants WHERE active = 1`);
    let indexed = 0;

    for (const t of tenantRows) {
      // Auto-generate slug if missing
      let slug = (await dbAll(ec, `SELECT slug FROM tenants WHERE id = ?`, t.id))[0]?.slug;
      if (!slug) {
        const base = (t.name || t.id)
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 50);
        // Ensure uniqueness
        let candidate = base;
        let suffix = 1;
        while (true) {
          const existing = await dbAll(ec, `SELECT id FROM tenants WHERE slug = ? AND id != ?`, candidate, t.id);
          if (!existing.length) { slug = candidate; break; }
          candidate = `${base}-${suffix++}`;
        }
      }

      // Build search text: include Latin original + de-accented + Cyrillic phonetic variants
      // so users can search in both Cyrillic and Latin (e.g. "варшава" finds "Warszawa")
      const svcRows = await dbAll(ec, `SELECT names, active, hidden FROM services WHERE tenant_id = ?`, t.id);
      const rawParts = [t.name, t.description, t.city].filter(Boolean);
      const parts = [];
      for (const p of rawParts) {
        // City/name/description are Latin — generate all variants
        parts.push(...buildSearchVariants(p));
      }
      for (const svc of svcRows) {
        if (!svc.active || svc.hidden) continue;
        try {
          const names = JSON.parse(svc.names || '{}');
          for (const name of Object.values(names).filter(Boolean)) {
            if (hasCyrillic(name)) {
              // Service names are often already in Cyrillic — just lowercase, no re-transliteration
              parts.push(name.toLowerCase());
            } else {
              parts.push(...buildSearchVariants(name));
            }
          }
        } catch { /* ignore */ }
      }
      // buildSearchVariants already returns lowercase strings
      const searchText = [...new Set(parts)].join(' ');

      // Update tenant: set slug, search_text, public_active=1
      await dbRun(ec,
        `UPDATE tenants SET slug = ?, search_text = ?, public_active = 1 WHERE id = ?`,
        slug, searchText, t.id,
      );

      // Upsert FTS5 index row
      await dbRun(ec, `DELETE FROM tenant_fts WHERE tenant_id = ?`, t.id);
      await dbRun(ec, `INSERT INTO tenant_fts(tenant_id, content) VALUES (?, ?)`, t.id, searchText);

      indexed++;
    }

    return Response.json({ ok: true, indexed });
  }

  // POST /admin/notify — send a Telegram message to the admin chat
  // Auth: Bearer NOTIFY_TOKEN (low-priv, notify-only) OR Bearer ADMIN_KEY
  // (legacy callers). NOTIFY_TOKEN lets remote/cloud routines post without
  // carrying the master ADMIN_KEY which unlocks the entire admin surface.
  // Body: { text: string, parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2' }
  // Uses NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID with fallback to BOT_TOKEN / ADMIN_CHAT_ID.
  // Splits text into chunks on newline boundaries (surrogate-safe) so long
  // reports don't exceed Telegram's 4096-char limit and parse_mode entities
  // aren't cut mid-tag.
  if (request.method === 'POST' && url.pathname === '/admin/notify') {
    if (!isNotifyAuthValid(env, request)) return forbidden();
    const token = env.NOTIFY_BOT_TOKEN || env.BOT_TOKEN;
    const chatId = env.NOTIFY_CHAT_ID || env.ADMIN_CHAT_ID;
    if (!token || !chatId) return Response.json({ error: 'bot_token_or_chat_id_missing' }, { status: 503 });

    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const text = String(body.text || '').slice(0, 40000);
    if (!text.trim()) return Response.json({ error: 'text_required' }, { status: 400 });
    const parseMode = body.parse_mode === 'HTML' || body.parse_mode === 'Markdown' || body.parse_mode === 'MarkdownV2'
      ? body.parse_mode : undefined;

    // Split on line boundaries first; fall back to code-point-safe chunking.
    // Never cuts inside a surrogate pair (Array.from respects code points).
    const chunks = splitTelegramText(text, 3500); // safety margin under Telegram's 4096-char limit

    const results = [];
    for (const chunk of chunks) {
      const payload = { chat_id: String(chatId), text: chunk, disable_web_page_preview: true };
      if (parseMode) payload.parse_mode = parseMode;
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        const data = await r.json().catch(() => ({}));
        results.push({ ok: r.ok && data.ok === true, status: r.status, description: data.description || null });
        if (!r.ok || data.ok !== true) break;
      } catch (e) {
        results.push({ ok: false, error: e?.message || 'fetch_failed' });
        break;
      }
    }
    const allOk = results.length > 0 && results.every((r) => r.ok);
    return Response.json({ ok: allOk, chunks: results.length, results });
  }

  // POST /admin/notify-document — upload a file to the admin chat via
  // Telegram sendDocument. Sibling of /admin/notify (which is text-only).
  // Auth: Bearer NOTIFY_TOKEN (low-priv, notify-only) OR Bearer ADMIN_KEY.
  // Body: multipart/form-data with fields:
  //   file     — required; the file blob
  //   caption  — optional; ≤1024 chars, surfaced as the document caption
  //   filename — optional; overrides the file's own .name
  // Uses NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID with fallback to BOT_TOKEN /
  // ADMIN_CHAT_ID (same resolution as /admin/notify).
  if (request.method === 'POST' && url.pathname === '/admin/notify-document') {
    if (!isNotifyAuthValid(env, request)) return forbidden();
    const token = env.NOTIFY_BOT_TOKEN || env.BOT_TOKEN;
    const chatId = env.NOTIFY_CHAT_ID || env.ADMIN_CHAT_ID;
    if (!token || !chatId) {
      return Response.json({ error: 'bot_token_or_chat_id_missing' }, { status: 503 });
    }

    const ctype = (request.headers.get('content-type') || '').toLowerCase();
    if (!ctype.startsWith('multipart/form-data')) {
      return Response.json({ error: 'multipart_form_data_required' }, { status: 400 });
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: 'invalid_form_data' }, { status: 400 });
    }

    const file = form.get('file');
    const isFileLike =
      file && typeof file === 'object' && typeof file.arrayBuffer === 'function';
    if (!isFileLike) {
      return Response.json({ error: 'file_required' }, { status: 400 });
    }

    const captionRaw = form.get('caption');
    const caption = typeof captionRaw === 'string' ? captionRaw.slice(0, 1024) : '';
    const filenameOverride = form.get('filename');
    const filename =
      (typeof filenameOverride === 'string' && filenameOverride.trim()) ||
      file.name ||
      'document.bin';

    const tgForm = new FormData();
    tgForm.append('chat_id', String(chatId));
    tgForm.append('document', file, filename);
    if (caption) tgForm.append('caption', caption);

    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        body: tgForm,
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok === true;
      return Response.json(
        { ok, status: r.status, description: data.description || null },
        { status: ok ? 200 : 502 },
      );
    } catch (e) {
      return Response.json(
        { ok: false, error: e?.message || 'fetch_failed' },
        { status: 502 },
      );
    }
  }

  // ─── Marketing IG autopilot — admin manual triggers ─────────────────────
  // Run the IG autopilot phase once for ALL eligible @manicbot_com slots.
  // Useful for kicking generation outside the 15-min cron tick, or before
  // flipping MARKETING_AUTOPILOT_ENABLED=1. Always honours processSlot
  // missing-credentials guards.
  if (request.method === 'POST' && url.pathname === '/admin/marketing-tick') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    try {
      const { phaseInstagramAutopilot } = await import('../marketing/autopilot.js');
      const result = await phaseInstagramAutopilot(env);
      return Response.json({ ok: true, ...result });
    } catch (e) {
      log.error('admin.marketingTick', e instanceof Error ? e : new Error(String(e?.message)));
      return Response.json({ error: e?.message || 'tick failed' }, { status: 500 });
    }
  }

  // Process a single slot by id — pure manual override. Useful for
  // re-running a failed slot, kicking a one-off post, or smoke-testing
  // the generation pipeline before live launch.
  if (request.method === 'POST' && url.pathname === '/admin/marketing-publish-one') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const slotId = url.searchParams.get('slot_id');
    if (!slotId) {
      return Response.json({ error: 'slot_id query param required' }, { status: 400 });
    }
    try {
      const slot = await env.DB.prepare(
        `SELECT id, scheduled_at, theme, topic, key_message, headline_pl, caption_pl,
                hashtags_json, image_url, image_prompt, status, error_count
         FROM marketing_content_plan
         WHERE id = ? AND tenant_id IS NULL`,
      )
        .bind(slotId)
        .first();
      if (!slot) {
        return Response.json({ error: 'slot not found' }, { status: 404 });
      }
      const { processSlot } = await import('../marketing/autopilot.js');
      const nowSec = Math.floor(Date.now() / 1000);
      await processSlot(env, slot, nowSec);
      const refreshed = await env.DB.prepare(
        `SELECT id, status, meta_post_id, permalink, image_url, error_msg, error_count
         FROM marketing_content_plan WHERE id = ?`,
      )
        .bind(slotId)
        .first();
      return Response.json({ ok: true, slot: refreshed });
    } catch (e) {
      log.error('admin.marketingPublishOne', e instanceof Error ? e : new Error(String(e?.message)));
      return Response.json({ error: e?.message || 'publish_one failed' }, { status: 500 });
    }
  }

  // Read-only status dashboard. Returns counts by status + recent rows.
  if (request.method === 'GET' && url.pathname === '/admin/marketing-status') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    try {
      const counts = await env.DB.prepare(
        `SELECT status, COUNT(*) AS n FROM marketing_content_plan WHERE tenant_id IS NULL GROUP BY status`,
      ).all();
      const upcoming = await env.DB.prepare(
        `SELECT id, datetime(scheduled_at, 'unixepoch') AS scheduled, status, theme, topic, meta_post_id, error_msg
         FROM marketing_content_plan
         WHERE tenant_id IS NULL
         ORDER BY scheduled_at ASC
         LIMIT 30`,
      ).all();
      return Response.json({
        counts: counts.results ?? [],
        upcoming: upcoming.results ?? [],
        autopilot_enabled: env.MARKETING_AUTOPILOT_ENABLED === '1',
      });
    } catch (e) {
      log.error('admin.marketingStatus', e instanceof Error ? e : new Error(String(e?.message)));
      return Response.json({ error: e?.message || 'status failed' }, { status: 500 });
    }
  }

  return null;
}
