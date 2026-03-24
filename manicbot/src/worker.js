import { nowSec, msToSec } from './utils/time.js';
import { buildCtx } from './config.js';
import { timingSafeEqual, checkAdmin } from './utils/security.js';
import { dbAll } from './utils/db.js';
import { escHtml } from './utils/helpers.js';
import { getAdminAllApts, getAptById } from './services/appointments.js';
import { api } from './telegram.js';
import { initServices } from './services/services.js';
import { getLang } from './services/chat.js';
import { makeICS } from './utils/ics.js';
import { onMsg } from './handlers/message.js';
import { onCb } from './handlers/callback.js';
import { handleCron } from './handlers/cron.js';
import { resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx, isMigrationDone } from './tenant/resolver.js';
import { runMigration } from './tenant/migration.js';
import { handleStripeWebhook } from './billing/webhooks.js';
import { listTenantIds, getBotIdsByTenantId, getTenant, putTenant, putBot, getTenantIdByBotId } from './tenant/storage.js';
import { runSeed } from './admin/seed.js';
import { registerBot, createTenant } from './admin/provisioning.js';
import {
  handleGoogleConnectRequest,
  handleGoogleCallback,
  handleGoogleSelect,
  handleGoogleWebhook,
} from './services/google-calendar-oauth.js';
import { resolveLandingOrigin, isLandingPath, buildLandingFetchUrl } from './utils/landing-pages-proxy.js';

function envCtx(env) {
  return { db: env.DB || null, kv: env.MANICBOT, globalKv: env.MANICBOT };
}

async function getCtx(env, url, request) {
  const ec = envCtx(env);
  const webhookBotMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (request.method === 'POST' && webhookBotMatch) {
    const resolved = await resolveTenantFromBotId(ec, webhookBotMatch[1], env.BOT_ENCRYPTION_KEY || null);
    if (!resolved) return null;
    return buildTenantCtx(env, resolved);
  }
  if (!env.BOT_TOKEN) return null;
  const botId = env.BOT_TOKEN.split(':')[0];
  if (ec.db && (await isMigrationDone(ec, botId))) {
    const resolved = await resolveTenantFromBotId(ec, botId, env.BOT_ENCRYPTION_KEY || null);
    if (resolved) return buildTenantCtx(env, resolved);
  }
  return buildLegacyCtx(env);
}

// Demo bots — tokens read from env secrets (set via `wrangler secret put`)
function getDemoBots(env) {
  const bots = [];
  const defs = [
    { tenantId: 't_salon1', tokenKey: 'BOT_TOKEN_SALON1', username: 'manic_salon1bot', whKey: 'WH_SECRET_SALON1' },
    { tenantId: 't_salon2', tokenKey: 'BOT_TOKEN_SALON2', username: 'manic_salon2bot', whKey: 'WH_SECRET_SALON2' },
    { tenantId: 't_master1', tokenKey: 'BOT_TOKEN_MASTER1', username: 'manic_master1bot', whKey: 'WH_SECRET_MASTER1' },
    { tenantId: 't_master2', tokenKey: 'BOT_TOKEN_MASTER2', username: 'manic_master2bot', whKey: 'WH_SECRET_MASTER2' },
  ];
  for (const d of defs) {
    const token = env[d.tokenKey];
    if (!token) continue;
    bots.push({
      tenantId: d.tenantId,
      botToken: token,
      botUsername: d.username,
      webhookSecret: env[d.whKey] || `wh_${d.tenantId}_auto`,
    });
  }
  return bots;
}

let _demoProvisioned = false;

async function ensureDemoBotsProvisioned(env) {
  if (_demoProvisioned) return;
  const ec = envCtx(env);
  if (!ec.db) return;
  const DEMO_BOTS = getDemoBots(env);
  if (!DEMO_BOTS.length) { _demoProvisioned = true; return; }
  let allOk = true;
  for (const b of DEMO_BOTS) {
    const bid = b.botToken.split(':')[0];
    const tid = await getTenantIdByBotId(ec, bid);
    if (!tid) { allOk = false; break; }
  }
  if (allOk) { _demoProvisioned = true; return; }

  console.log('Self-provisioning demo bots (some missing)...');
  const { dbRun } = await import('./utils/db.js');
  const TRIAL_SEC = msToSec(7 * 24 * 3600 * 1000);
  const now = nowSec();

  const TENANTS = {
    t_salon1: { name: 'Crystal Nails', salon: { name: 'Crystal Nails', address: 'ul. Nowy Świat 15, Warszawa', phone: '+48 22 100 10 01', timezone: 'Europe/Warsaw', workHours: { from: 9, to: 20 }, currency: 'PLN' } },
    t_salon2: { name: 'Velvet Touch', salon: { name: 'Velvet Touch', address: 'ul. Mokotowska 42, Warszawa', phone: '+48 22 200 20 02', timezone: 'Europe/Warsaw', workHours: { from: 10, to: 21 }, currency: 'PLN' } },
    t_master1: { name: 'Мастер Алина', salon: { name: 'Мастер Алина', address: 'ul. Złota 59, Warszawa', phone: '+48 22 300 30 03', timezone: 'Europe/Warsaw', workHours: { from: 10, to: 19 }, currency: 'PLN' } },
    t_master2: { name: 'Мастер Виктория', salon: { name: 'Мастер Виктория', address: 'ul. Puławska 12, Warszawa', phone: '+48 22 400 40 04', timezone: 'Europe/Warsaw', workHours: { from: 11, to: 20 }, currency: 'PLN' } },
  };

  for (const b of DEMO_BOTS) {
    const botId = b.botToken.split(':')[0];
    const t = TENANTS[b.tenantId];
    await putTenant(ec, b.tenantId, {
      id: b.tenantId, name: t.name, active: true, createdAt: now, updatedAt: now,
      salon: t.salon, plan: 'pro', billingStatus: 'trialing',
      trialEndsAt: now + TRIAL_SEC, graceEndsAt: null,
      stripeCustomerId: null, stripeSubscriptionId: null,
      currentPeriodEnd: null, billingEmail: null, cancelAtPeriodEnd: false,
    });
    await putBot(ec, botId, {
      botId, tenantId: b.tenantId, botToken: b.botToken,
      botUsername: b.botUsername, webhookSecret: b.webhookSecret,
      active: true, createdAt: now, updatedAt: now,
    });
    if (env.ADMIN_CHAT_ID) {
      await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'admin', ?)", b.tenantId, env.ADMIN_CHAT_ID);
    }
    const whUrl = `https://manicbot.com/webhook/${botId}`;
    await fetch(`https://api.telegram.org/bot${b.botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: whUrl, secret_token: b.webhookSecret, allowed_updates: ['message', 'callback_query'] }),
    }).catch(() => {});
    console.log(`Provisioned: @${b.botUsername} → ${b.tenantId}`);
  }
  _demoProvisioned = true;
  console.log('Demo bots provisioned!');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // One-time self-provisioning (runs inside worker for KV consistency)
    await ensureDemoBotsProvisioned(env);

    if (request.method === 'GET' && isLandingPath(url.pathname)) {
      if (url.pathname === '/blog') {
        return Response.redirect(new URL('/blog/', url).toString(), 308);
      }
      const landingOrigin = resolveLandingOrigin(env);
      const landingUrl = buildLandingFetchUrl(url.pathname, landingOrigin);
      const res = await fetch(landingUrl, { headers: request.headers });
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }

    if (request.method === 'POST' && url.pathname === '/stripe/webhook') {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret || !env.MANICBOT) return new Response('Bad config', { status: 500 });
      const signature = request.headers.get('Stripe-Signature') || '';
      let body;
      try { body = await request.text(); } catch { return new Response('Bad body', { status: 400 }); }
      const result = await handleStripeWebhook(envCtx(env), body, signature, secret);
      return new Response(result.skipped ? 'OK (duplicate)' : 'OK', { status: result.status });
    }

    if (request.method === 'GET' && url.pathname === '/stripe/success') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Payment successful</title>
<style>body{font-family:system-ui;max-width:480px;margin:60px auto;padding:20px;background:#f0fdf4;color:#166534;text-align:center}
h1{font-size:1.5em}.s{background:#fff;padding:24px;border-radius:12px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}</style></head><body>
<h1>✅ Payment successful</h1>
<div class="s"><p>Your subscription is active. You can close this tab and return to the bot.</p></div>
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

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
      const { migrateKvToD1 } = await import('../scripts/migrate-kv-to-d1.js');
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

    // Provision bots: POST /admin/provision?key=ADMIN_KEY  body: { bots: [...] }
    // Each bot: { botToken, tenantName, webhookSecret, services, aboutDesc, aboutPhotos, salon }
    if (request.method === 'POST' && url.pathname === '/admin/provision') {
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
        return new Response('Forbidden', { status: 403 });
      }
      const ec = envCtx(env);
      if (!ec.db) return Response.json({ error: 'DB not bound' }, { status: 500 });
      const { dbRun } = await import('./utils/db.js');
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
          if (!res.ok) { results.push({ botId, error: res.error }); continue; }
          if (b.services) await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'svc_list', ?)", tenantId, JSON.stringify(b.services));
          if (b.aboutDesc) await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_desc', ?)", tenantId, JSON.stringify(b.aboutDesc));
          if (b.aboutPhotos) await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_photos', ?)", tenantId, JSON.stringify(b.aboutPhotos));
          if (env.ADMIN_CHAT_ID) await dbRun(ec, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'admin', ?)", tenantId, env.ADMIN_CHAT_ID);
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
            body: JSON.stringify({ commands: [
              { command: 'start', description: '💅 Главное меню / Main menu' },
              { command: 'book', description: '📝 Записаться / Book now' },
              { command: 'my', description: '📋 Мои записи / My appointments' },
              { command: 'lang', description: '🌐 Язык / Language' },
            ] }),
          }).catch(() => {});
          results.push({ botId, tenantId, webhook: whRes.ok, webhookUrl: whUrl });
        }
        return Response.json({ ok: true, results });
      } catch (e) {
        return Response.json({ error: e.message, stack: e.stack }, { status: 400 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/google/connect') {
      return handleGoogleConnectRequest({ ...envCtx(env), ...env, baseUrl: url.origin }, url);
    }

    if (request.method === 'GET' && url.pathname === '/google/callback') {
      return handleGoogleCallback({ ...envCtx(env), ...env, baseUrl: url.origin }, url);
    }

    if (request.method === 'GET' && url.pathname === '/google/select') {
      return handleGoogleSelect({ ...envCtx(env), ...env, baseUrl: url.origin }, url);
    }

    if (request.method === 'POST' && url.pathname === '/google/webhook') {
      return handleGoogleWebhook({ ...envCtx(env), ...env, baseUrl: url.origin }, request);
    }

    const isAdminPath = url.pathname.startsWith('/admin/');
    let ctx;
    try {
      ctx = await getCtx(env, url, request);
      if (!ctx && url.pathname !== '/' && !isAdminPath) {
        if (env.BOT_TOKEN && env.WEBHOOK_SECRET) ctx = buildLegacyCtx(env);
        else ctx = buildCtx(env);
      }
    } catch (e) {
      if (url.pathname !== '/' && !isAdminPath) {
        try {
          if (env.BOT_TOKEN && env.WEBHOOK_SECRET) ctx = buildLegacyCtx(env);
          else ctx = buildCtx(env);
        } catch (_) {}
      }
      if (!ctx) return new Response(e?.message || 'Server Error', { status: 500 });
    }
    ctx.baseUrl = url.origin;
    const ADMIN_401 = new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ManicBot Admin"' },
    });

    if (url.pathname === '/setup') {
      if (!timingSafeEqual(url.searchParams.get('key') || '', ctx.ADMIN_KEY)) {
        return new Response('Forbidden', { status: 403 });
      }
      const botId = ctx.bot?.botId || (ctx.TG && ctx.TG.includes('/bot') ? ctx.TG.replace(/.*\/bot(\d+).*/, '$1') : null);
      const wh = botId ? `${url.origin}/webhook/${botId}` : `${url.origin}/webhook`;
      const [r, cmds] = await Promise.all([
        api(ctx, 'setWebhook', {
          url: wh,
          secret_token: ctx.WEBHOOK_SECRET,
          allowed_updates: ['message', 'callback_query'],
        }),
        api(ctx, 'setMyCommands', {
          commands: [
            { command: 'start', description: '💅 Главное меню / Main menu' },
            { command: 'book', description: '📝 Записаться / Book now' },
            { command: 'my', description: '📋 Мои записи / My appointments' },
            { command: 'lang', description: '🌐 Язык / Language' },
          ],
        }),
      ]);
      const adminChatId = ctx.adminChatId || ctx.ADMIN_CHAT_ID;
      let godCmds = null;
      if (adminChatId) {
        godCmds = await api(ctx, 'setMyCommands', {
          commands: [
            { command: 'start', description: '💅 Main menu' },
            { command: 'book', description: '📝 Book' },
            { command: 'my', description: '📋 My appointments' },
            { command: 'lang', description: '🌐 Language' },
            { command: 'sysadmin', description: '🌐 Platform admin (key)' },
            { command: 'admin', description: '🔧 Set admin (key)' },
            { command: 'grant_master', description: '👨‍🎨 Grant master role @user [tenantId]' },
            { command: 'grant_owner', description: '👑 Grant owner role @user [tenantId]' },
            { command: 'add_support', description: '🆘 Add support agent @user' },
            { command: 'remove_support', description: '❌ Remove support agent @user' },
            { command: 'support_register', description: '🆘 Register as support agent (key)' },
            { command: 'panel', description: '🔧 Admin/master panel' },
            { command: 'client', description: '👤 Switch to client view' },
            { command: 'master', description: '👨‍🎨 Master panel' },
          ],
          scope: { type: 'chat', chat_id: parseInt(String(adminChatId)) },
        }).catch(() => null);
      }
      return Response.json({ webhook: wh, result: r, commands: cmds, godCommands: godCmds });
    }

    if (url.pathname === '/remove-webhook') {
      if (!timingSafeEqual(url.searchParams.get('key') || '', ctx.ADMIN_KEY)) {
        return new Response('Forbidden', { status: 403 });
      }
      return Response.json({ result: await api(ctx, 'deleteWebhook', {}) });
    }

    if (url.pathname === '/admin/billing') {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      if (!ctx.db) return new Response('DB not bound', { status: 500 });
      const tenantIds = await listTenantIds(ctx);
      const tenants = await Promise.all(tenantIds.map(id => getTenant(ctx, id)));
      const fmt = (ts) => ts ? new Date(ts).toISOString().slice(0, 10) : '—';
      let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ManicBot — Platform Billing</title>
<style>*{box-sizing:border-box}body{font-family:system-ui;margin:0;padding:20px;background:#fdf2f8;color:#1a1a2e}
h1{color:#831843}h2{color:#9d174d;margin-top:24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);margin:12px 0}
th{background:#ec4899;color:#fff;padding:10px 12px;text-align:left;font-weight:600;font-size:.85em}
td{padding:8px 12px;border-bottom:1px solid #fce7f3;font-size:.9em}
tr:hover td{background:#fdf2f8}
.back{display:inline-block;padding:8px 16px;background:#ec4899;color:#fff;border-radius:8px;text-decoration:none;font-size:.85em;margin:4px}
</style></head><body>
<h1>💳 Platform Billing</h1>
<p><a class="back" href="/admin">← Admin</a></p>
<h2>Tenants</h2>
<table><tr><th>Tenant</th><th>Plan</th><th>Status</th><th>Period end</th><th>Stripe customer</th></tr>`;
      for (const t of tenants) {
        if (!t) continue;
        const name = escHtml(t.name || t.id || '—');
        const plan = escHtml(t.plan || '—');
        const status = escHtml(t.billingStatus || '—');
        const periodEnd = fmt(t.currentPeriodEnd);
        const cust = t.stripeCustomerId ? (t.stripeCustomerId.slice(0, 12) + '…') : '—';
        html += `<tr><td>${name}</td><td>${plan}</td><td>${status}</td><td>${periodEnd}</td><td>${escHtml(cust)}</td></tr>`;
      }
      html += '</table></body></html>';
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    if (url.pathname === '/admin') {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      if (!ctx.db) return new Response('DB not bound', { status: 500 });
      await initServices(ctx);

      const aptRecords = await getAdminAllApts(ctx);
      const userRows = ctx.tenantId ? await dbAll(ctx, 'SELECT * FROM users WHERE tenant_id = ?', ctx.tenantId) : [];
      const userRecords = userRows.map(r => ({ chatId: r.chat_id, name: r.name, phone: r.phone, tgUsername: r.tg_username, tgLang: r.tg_lang, registeredAt: r.registered_at }));

      const appointments = aptRecords
        .filter(Boolean)
        .map(a => {
          const svc = ctx.svc.find(x => x.id === a.svcId);
          return {
            id: a.id,
            client: a.userName,
            chatId: a.chatId,
            service: svc ? `${svc.e} ${a.svcId}` : a.svcId,
            date: a.date,
            time: a.time,
            status: a.cx ? '❌ Отменено' : a.status === 'pending' ? '⏳ Ожидает' : a.status === 'rejected' ? '❌ Отклонено' : a.status === 'counter_offer' ? '💬 Предложен другой час' : (a.ts < Date.now() ? '✅ Завершено' : '✅ Подтверждено'),
            created: new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' '),
          };
        });

      const clients = userRecords
        .filter(Boolean)
        .map(u => ({
          chatId: u.chatId,
          name: u.name,
          phone: u.phone,
          username: u.tgUsername ? `@${u.tgUsername}` : '—',
          lang: u.tgLang || '—',
          registered: u.registeredAt ? new Date(u.registeredAt).toISOString().slice(0, 16).replace('T', ' ') : '—',
        }));

      let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ManicBot Admin</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui;margin:0;padding:20px;background:#fdf2f8;color:#1a1a2e}
h1{color:#831843}h2{color:#9d174d;margin-top:40px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);margin:12px 0}
th{background:#ec4899;color:#fff;padding:10px 12px;text-align:left;font-weight:600;font-size:.85em;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #fce7f3;font-size:.9em}
tr:hover td{background:#fdf2f8}
.stat{display:inline-block;background:#fff;padding:16px 24px;border-radius:12px;margin:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.stat b{font-size:1.5em;display:block;color:#ec4899}
.export{display:inline-block;padding:8px 16px;background:#ec4899;color:#fff;border-radius:8px;text-decoration:none;font-size:.85em;margin:4px}
.export:hover{background:#db2777}
</style></head><body>
<h1>💅 ManicBot — Админ-панель</h1>

<div>
<div class="stat"><b>${clients.length}</b>Клиентов</div>
<div class="stat"><b>${appointments.length}</b>Всего записей</div>
<div class="stat"><b>${appointments.filter(a => a.status === '✅ Подтверждено').length}</b>Предстоит</div>
<a class="export" href="/admin/billing">💳 Billing (all tenants)</a>
</div>

<h2>👥 Клиенты</h2>
<a class="export" href="/admin/export/clients.csv">📥 Скачать CSV</a>
<table>
<tr><th>Chat ID</th><th>Имя</th><th>Телефон</th><th>Username</th><th>Язык</th><th>Дата рег.</th></tr>`;
      for (const c of clients) {
        html += `<tr><td>${escHtml(c.chatId)}</td><td>${escHtml(c.name)}</td><td>${escHtml(c.phone)}</td><td>${escHtml(c.username)}</td><td>${escHtml(c.lang)}</td><td>${escHtml(c.registered)}</td></tr>`;
      }
      html += `</table>

<h2>📋 Записи</h2>
<a class="export" href="/admin/export/appointments.csv">📥 Скачать CSV</a>
<table>
<tr><th>ID</th><th>Клиент</th><th>Chat ID</th><th>Услуга</th><th>Дата</th><th>Время</th><th>Статус</th><th>Создано</th></tr>`;
      for (const a of appointments) {
        html += `<tr><td>${escHtml(a.id)}</td><td>${escHtml(a.client)}</td><td>${escHtml(a.chatId)}</td><td>${escHtml(a.service)}</td><td>${escHtml(a.date)}</td><td>${escHtml(a.time)}</td><td>${escHtml(a.status)}</td><td>${escHtml(a.created)}</td></tr>`;
      }
      html += `</table></body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    if (url.pathname.startsWith('/admin/export/')) {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      await initServices(ctx);
      const file = url.pathname.split('/').pop();

      if (file === 'clients.csv') {
        const rows = ctx.tenantId ? await dbAll(ctx, 'SELECT * FROM users WHERE tenant_id = ?', ctx.tenantId) : [];
        const users = rows.map(r => ({ chatId: r.chat_id, name: r.name, phone: r.phone, tgUsername: r.tg_username, tgLang: r.tg_lang, registeredAt: r.registered_at }));
        let csv = 'Chat ID,Name,Phone,Username,Language,Registered\n';
        for (const u of users) {
          if (!u) continue;
          csv += `${u.chatId},"${(u.name||'').replace(/[\r\n]/g,' ').replace(/"/g,'""')}",${u.phone},${u.tgUsername||''},${u.tgLang||''},${u.registeredAt ? new Date(u.registeredAt).toISOString() : ''}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="clients.csv"' } });
      }

      if (file === 'appointments.csv') {
        const apts = await getAdminAllApts(ctx);
        let csv = 'ID,Client,Chat ID,Service,Date,Time,Status,Created\n';
        for (const a of apts) {
          if (!a) continue;
          const status = a.cx ? 'Cancelled' : a.status === 'pending' ? 'Pending' : a.status === 'rejected' ? 'Rejected' : a.status === 'counter_offer' ? 'Counter-offer' : (a.ts < Date.now() ? 'Completed' : 'Confirmed');
          csv += `${a.id},"${(a.userName||'').replace(/[\r\n]/g,' ').replace(/"/g,'""')}",${a.chatId},${a.svcId},${a.date},${a.time},${status},${new Date(a.createdAt).toISOString()}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' } });
      }
      return new Response('Not Found', { status: 404 });
    }

    const calMatch = request.method === 'GET' && url.pathname.match(/^\/calendar\/(.+)$/);
    if (calMatch) {
      const rawId = calMatch[1];
      const aptId = rawId.endsWith('.ics') ? rawId.slice(0, -4) : rawId;
      if (!/^a\d+_\w+$/.test(aptId)) {
        return new Response('Invalid appointment ID', { status: 400 });
      }
      if (!ctx.db) return new Response('Service unavailable', { status: 503 });
      await initServices(ctx);
      const apt = await getAptById(ctx, aptId);
      if (!apt || apt.cx) {
        return new Response('Appointment not found', { status: 404 });
      }
      const svc = ctx.svc.find(x => x.id === apt.svcId);
      if (!svc) return new Response('Service not found', { status: 404 });

      const userLang = await getLang(ctx, apt.chatId) || 'ru';
      const ics = makeICS(ctx, apt, userLang);
      if (!ics) return new Response('Error', { status: 500 });
      const openInline = url.searchParams.get('open') === '1';
      return new Response(ics, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': openInline ? 'inline; filename="manicure.ics"' : 'attachment; filename="manicure.ics"',
        },
      });
    }

    if (request.method === 'POST' && (url.pathname === '/webhook' || url.pathname.match(/^\/webhook\/([^/]+)$/))) {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
      if (!timingSafeEqual(secret, ctx.WEBHOOK_SECRET)) {
        return new Response('Unauthorized', { status: 403 });
      }

      if (!ctx.kv) {
        console.error('KV MANICBOT not bound');
        return new Response('OK');
      }

      try {
        const upd = await request.json();

        await initServices(ctx);

        if (upd.message) {
          if (!upd.message.chat?.id || !upd.message.from?.id) {
            return new Response('OK');
          }
          await onMsg(ctx, upd.message);
        }

        if (upd.callback_query) {
          if (!upd.callback_query.message?.chat?.id || !upd.callback_query.from?.id || !upd.callback_query.data) {
            return new Response('OK');
          }
          await onCb(ctx, upd.callback_query);
        }
      } catch (e) {
        console.error('Webhook error:', e.message, e.stack);
      }
      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, _scheduledCtx) {
    try {
      const ec = envCtx(env);
      if (ec.db) {
        const tenantIds = await listTenantIds(ec);
        if (tenantIds.length > 0) {
          for (const tenantId of tenantIds) {
            const botIds = await getBotIdsByTenantId(ec, tenantId);
            if (botIds.length === 0) continue;
            const resolved = await resolveTenantFromBotId(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null);
            if (!resolved) continue;
            const ctx = buildTenantCtx(env, resolved);
            _scheduledCtx.waitUntil(handleCron(ctx));
          }
          return;
        }
      }
      const ctx =
        env.BOT_TOKEN && env.WEBHOOK_SECRET
          ? buildLegacyCtx(env)
          : buildCtx(env);
      _scheduledCtx.waitUntil(handleCron(ctx));
    } catch (e) {
      console.error('Cron init error:', e.message);
    }
  },
};
