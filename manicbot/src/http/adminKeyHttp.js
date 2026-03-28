import { timingSafeEqual } from '../utils/security.js';
import { runMigration } from '../tenant/migration.js';
import { runSeed } from '../admin/seed.js';
import { registerBot, createTenant } from '../admin/provisioning.js';
import { getTenant, putTenant, putBot } from '../tenant/storage.js';
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

  return null;
}
