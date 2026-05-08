import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';
import { runMigration } from '../tenant/migration.js';
import { runSeed } from '../admin/seed.js';
import { registerBot, createTenant } from '../admin/provisioning.js';
import { getTenant, putTenant, putBot, listTenantIds, getBotIdsByTenantId, getBot, getBotToken } from '../tenant/storage.js';
import { envCtx } from './envCtx.js';
import { logEvent } from '../utils/events.js';
import { audit } from '../utils/audit.js';
import { buildSearchVariants, hasCyrillic } from '../lib/searchNormalize.js';

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

/** Returns a 403 Forbidden response. */
const forbidden = () => new Response('Forbidden', { status: 403 });

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

      const success = returnUrl || `${cfg.baseUrl}/?plugin_checkout_ok=1`;
      const cancel = returnUrl || `${cfg.baseUrl}/?plugin_checkout_cancel=1`;
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

  // POST /admin/appointment-action?key=ADMIN_KEY — trigger notifications + calendar sync from admin-app
  if (request.method === 'POST' && url.pathname === '/admin/appointment-action') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    try {
      const { action, appointmentId, tenantId, confirmedBy } = await request.json();
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

      const { getAptById, updateApt } = await import('../services/appointments.js');
      const apt = await getAptById(ctx, appointmentId);
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
    const results = [];
    try {
      const tenantIds = await listTenantIds(ec);
      for (const tenantId of tenantIds) {
        const botIds = await getBotIdsByTenantId(ec, tenantId);
        for (const botId of botIds) {
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

  // POST /admin/notify?key=ADMIN_KEY — send a Telegram message to the admin chat
  // Body: { text: string, parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2' }
  // Uses NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID with fallback to BOT_TOKEN / ADMIN_CHAT_ID.
  // Splits text into chunks on newline boundaries (surrogate-safe) so long
  // reports don't exceed Telegram's 4096-char limit and parse_mode entities
  // aren't cut mid-tag.
  if (request.method === 'POST' && url.pathname === '/admin/notify') {
    if (!isAdminKeyValid(url, env, request)) return forbidden();
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
    const MAX = 3500; // safety margin under Telegram's 4096-char limit
    const chunks = [];
    let buf = '';
    const pushBuf = () => { if (buf) { chunks.push(buf); buf = ''; } };
    for (const line of text.split('\n')) {
      const candidate = buf ? buf + '\n' + line : line;
      if (candidate.length <= MAX) { buf = candidate; continue; }
      pushBuf();
      if (line.length <= MAX) { buf = line; continue; }
      // Line itself exceeds MAX — split by code points, not code units.
      for (const ch of Array.from(line)) {
        if ((buf + ch).length > MAX) pushBuf();
        buf += ch;
      }
    }
    pushBuf();

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

  return null;
}
