import { timingSafeEqual } from '../utils/security.js';
import { runMigration } from '../tenant/migration.js';
import { runSeed } from '../admin/seed.js';
import { registerBot, createTenant } from '../admin/provisioning.js';
import { getTenant, putTenant, putBot, listTenantIds, getBotIdsByTenantId, getBot, getBotToken } from '../tenant/storage.js';
import { envCtx } from './envCtx.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryAdminKeyRoutes(request, env, url) {
  if (url.pathname === '/admin/migrate') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.MANICBOT) return new Response('KV not bound', { status: 500 });
    const result = await runMigration(env.MANICBOT, env);
    return Response.json(result);
  }

  if (url.pathname === '/admin/migrate-d1') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.DB || !env.MANICBOT) return new Response('DB or KV not bound', { status: 500 });
    const { migrateKvToD1 } = await import('../../scripts/migrate-kv-to-d1.js');
    const result = await migrateKvToD1(envCtx(env));
    return Response.json(result);
  }

  if (url.pathname === '/admin/seed') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.DB) return new Response('DB not bound', { status: 500 });
    const masterParam = (url.searchParams.get('master') || 'dezbringer').replace(/^@/, '');
    const result = await runSeed(envCtx(env), env, masterParam);
    return Response.json(result);
  }

  if (request.method === 'POST' && url.pathname === '/admin/provision') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    const ec = envCtx(env);
    if (!ec.db) return Response.json({ error: 'DB not bound' }, { status: 500 });
    const { dbRun } = await import('../utils/db.js');
    try {
      const { bots } = await request.json();
      const results = [];
      for (const b of bots) {
        const botId = b.botToken.split(':')[0];
        let tenantId = b.tenantId;
        if (tenantId) {
          const existing = await getTenant(ec, tenantId);
          if (!existing) {
            const tRes = await createTenant(ec, b.tenantName || tenantId, env);
            if (tRes.ok) {
              const tPayload = await getTenant(ec, tRes.tenantId);
              if (tPayload && tRes.tenantId !== tenantId) {
                tPayload.id = tenantId;
                if (b.salon) tPayload.salon = b.salon;
                await putTenant(ec, tenantId, tPayload);
                await dbRun(ec, 'DELETE FROM tenants WHERE id = ?', tRes.tenantId);
              } else if (tPayload && b.salon) {
                tPayload.salon = b.salon;
                await putTenant(ec, tenantId, tPayload);
              }
            }
          }
        }
        const res = await registerBot(ec, b.botToken, tenantId, b.webhookSecret, env.BOT_ENCRYPTION_KEY || null);
        if (!res.ok && res.error === 'tenant_has_bot') {
          results.push({ botId, skip: 'tenant_has_bot' });
          continue;
        }
        if (!res.ok) {
          results.push({ botId, error: res.error });
          continue;
        }
        if (b.services)
          await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'svc_list', ?)", tenantId, JSON.stringify(b.services));
        if (b.aboutDesc)
          await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_desc', ?)", tenantId, JSON.stringify(b.aboutDesc));
        if (b.aboutPhotos)
          await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_photos', ?)", tenantId, JSON.stringify(b.aboutPhotos));
        if (env.ADMIN_CHAT_ID)
          await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'admin', ?)", tenantId, env.ADMIN_CHAT_ID);
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
      }
      return Response.json({ ok: true, results });
    } catch (e) {
      console.error('[admin/provision]', e?.message, e?.stack);
      return Response.json({ error: 'Provision failed', code: 'PROVISION_ERROR' }, { status: 400 });
    }
  }

  // POST /admin/ig-token?key=ADMIN_KEY — set and validate Instagram Page Access Token
  if (request.method === 'POST' && url.pathname === '/admin/ig-token') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
    try {
      const { token, tenantId } = await request.json();
      if (!token || !tenantId) return Response.json({ error: 'token and tenantId required' }, { status: 400 });

      // Validate token against Graph API
      const meRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
      const meData = await meRes.json().catch(() => ({}));
      if (!meRes.ok) {
        return Response.json({ error: 'Token validation failed', graphError: meData.error?.message, graphCode: meData.error?.code }, { status: 400 });
      }

      // Store as plaintext in token_encrypted (resolver handles plaintext EAA tokens)
      const ec = envCtx(env);
      const { dbRun } = await import('../utils/db.js');
      await dbRun(ec,
        `UPDATE channel_configs SET token_encrypted = ?, updated_at = ? WHERE tenant_id = ? AND channel_type = 'instagram'`,
        token, Math.floor(Date.now() / 1000), tenantId,
      );

      return Response.json({
        ok: true,
        graphMe: { id: meData.id, name: meData.name },
        tokenPrefix: token.slice(0, 4),
        tenantId,
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
  }

  // POST /admin/ig-channel?key=ADMIN_KEY — create Instagram channel config for a tenant
  if (request.method === 'POST' && url.pathname === '/admin/ig-channel') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
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
      const meRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
      const meData = await meRes.json().catch(() => ({}));
      if (!meRes.ok) {
        return Response.json({ error: 'Token validation failed', graphError: meData.error?.message }, { status: 400 });
      }

      // Create channel config
      const config = { page_id: String(pageId) };
      if (igAccountId) config.ig_account_id = String(igAccountId);
      if (instagramBusinessId) config.instagram_business_id = String(instagramBusinessId);

      const { createChannelConfig } = await import('../channels/token-manager.js');
      const channelConfigId = await createChannelConfig(ec, resolvedTenantId, 'instagram', config, token, env.BOT_ENCRYPTION_KEY || null);

      return Response.json({
        ok: true,
        tenantId: resolvedTenantId,
        channelConfigId,
        graphMe: { id: meData.id, name: meData.name },
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
  }

  // POST /admin/appointment-action?key=ADMIN_KEY — trigger notifications + calendar sync from admin-app
  if (request.method === 'POST' && url.pathname === '/admin/appointment-action') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
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
            console.error('[appointment-action] calendar sync failed:', e.message);
          }
        }
      } else if (action === 'reject') {
        const { getLang } = await import('../utils/lang.js');
        const { send } = await import('../telegram.js');
        const { t, fill } = await import('../i18n/index.js');
        const { fmtDT } = await import('../utils/time.js');
        const { svcName } = await import('../services/services.js');
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
      console.error('[appointment-action]', e?.message, e?.stack);
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // GET /admin/reset-webhooks?key=ADMIN_KEY — re-register Telegram webhooks for all bots
  // Use this when webhook secrets are out of sync (e.g. after timingSafeEqual fix)
  if (url.pathname === '/admin/reset-webhooks') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
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
          } catch (e) { results.push({ botId, tenantId, error: e.message }); }
        }
      }
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
    return Response.json({ ok: true, count: results.length, results });
  }

  // POST /admin/web-user?key=ADMIN_KEY — create or update a web (email/password) user for the admin-app
  // Body: { email, password, tenantId?, role? }
  if (request.method === 'POST' && url.pathname === '/admin/web-user') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.DB) return new Response('DB not bound', { status: 500 });

    let body;
    try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

    const { email, password, tenantId = null, role = 'tenant_owner' } = body || {};
    if (!email || !password) return Response.json({ error: 'email and password required' }, { status: 400 });
    if (password.length < 8) return Response.json({ error: 'password must be at least 8 characters' }, { status: 400 });

    // Hash password with PBKDF2 (Web Crypto — same algorithm as admin-app/src/server/auth/password.ts)
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
    const hexEncode = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const passwordHash = `pbkdf2:${hexEncode(salt.buffer)}:${hexEncode(bits)}`;

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
      return Response.json({ error: e.message }, { status: 500 });
    }

    return Response.json({ ok: true, email: normalizedEmail, tenantId, role });
  }

  // GET /admin/events?key=ADMIN_KEY&limit=100&type=...&tenantId=...
  if (request.method === 'GET' && url.pathname === '/admin/events') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
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
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!env.MANICBOT) return Response.json({ error: 'KV not bound' }, { status: 500 });
    await env.MANICBOT.delete('adminlog:recent');
    return Response.json({ ok: true });
  }

  // GET /admin/index-salons?key=ADMIN_KEY — bulk-index all tenants into FTS + set public_active=1
  if (url.pathname === '/admin/index-salons') {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
      return new Response('Forbidden', { status: 403 });
    }
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

      // Build search text
      const svcRows = await dbAll(ec, `SELECT names, active, hidden FROM services WHERE tenant_id = ?`, t.id);
      const parts = [t.name, t.description, t.city].filter(Boolean);
      for (const svc of svcRows) {
        if (!svc.active || svc.hidden) continue;
        try {
          const names = JSON.parse(svc.names || '{}');
          parts.push(...Object.values(names).filter(Boolean));
        } catch { /* ignore */ }
      }
      // Store lowercase so LIKE queries work for Cyrillic (SQLite LIKE is ASCII-only)
      const searchText = [...new Set(parts)].join(' ').toLowerCase();

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

  return null;
}
