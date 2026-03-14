import { buildCtx } from './config.js';
import { timingSafeEqual, checkAdmin } from './utils/security.js';
import { kvGet, kvListAll } from './utils/kv.js';
import { escHtml, p2 } from './utils/helpers.js';
import { warsawNow } from './utils/date.js';
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
import { listTenantIds, getBotIdsByTenantId, getTenant } from './tenant/storage.js';
import { runSeed } from './admin/seed.js';

async function getCtx(env, url, request) {
  const kv = env.MANICBOT;
  const webhookBotMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (request.method === 'POST' && webhookBotMatch) {
    const resolved = await resolveTenantFromBotId(kv, webhookBotMatch[1], env.BOT_ENCRYPTION_KEY || null);
    if (!resolved) return null;
    return buildTenantCtx(env, resolved);
  }
  if (!env.BOT_TOKEN) return null;
  const botId = env.BOT_TOKEN.split(':')[0];
  if (kv && (await isMigrationDone(kv, botId))) {
    const resolved = await resolveTenantFromBotId(kv, botId, env.BOT_ENCRYPTION_KEY || null);
    if (resolved) return buildTenantCtx(env, resolved);
  }
  return buildLegacyCtx(env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/stripe/webhook') {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret || !env.MANICBOT) return new Response('Bad config', { status: 500 });
      const signature = request.headers.get('Stripe-Signature') || '';
      let body;
      try { body = await request.text(); } catch { return new Response('Bad body', { status: 400 }); }
      const result = await handleStripeWebhook(env.MANICBOT, body, signature, secret);
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

    if (url.pathname === '/admin/seed') {
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!env.MANICBOT) return new Response('KV not bound', { status: 500 });
      const masterParam = (url.searchParams.get('master') || 'dezbringer').replace(/^@/, '');
      const result = await runSeed(env.MANICBOT, env, masterParam);
      return Response.json(result);
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ManicBot</title>
<style>
body{font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px;background:#fdf2f8;color:#831843}
h1{font-size:2.5em}
.s{background:#fff;padding:20px;border-radius:12px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.s h3{margin-top:0}
code{background:#fce7f3;padding:2px 6px;border-radius:4px}
</style></head><body>
<h1>💅 ManicBot</h1>
<p>Telegram-бот для записи на маникюр</p>
<div class="s"><h3>Status</h3><p>✅ Worker is running</p></div>
<div class="s"><h3>Setup</h3><p>Use <code>/setup?key=YOUR_KEY</code> to configure webhook</p></div>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    let ctx;
    try {
      ctx = await getCtx(env, url, request);
      if (!ctx && url.pathname !== '/' && !url.pathname.startsWith('/admin/migrate')) {
        if (env.BOT_TOKEN && env.WEBHOOK_SECRET) ctx = buildLegacyCtx(env);
        else ctx = buildCtx(env);
      }
    } catch (e) {
      if (url.pathname !== '/' && !url.pathname.startsWith('/admin/migrate')) {
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
      if (!ctx.kv) return new Response('KV not bound', { status: 500 });
      const tenantIds = await listTenantIds(ctx.kv);
      const tenants = await Promise.all(tenantIds.map(id => getTenant(ctx.kv, id)));
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
      if (!ctx.kv) return new Response('KV not bound', { status: 500 });
      await initServices(ctx);

      const adminW = warsawNow();
      const adminMonthKeys = [-2, -1, 0].map(off => {
        const d = new Date(Date.UTC(adminW.year, adminW.month - 1 + off, 1));
        return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
      });
      const monthBuckets = await Promise.all(adminMonthKeys.map(k => kvGet(ctx, k)));
      const allIds = [...new Set(monthBuckets.flatMap(b => b || []))];
      const userKeys = await kvListAll(ctx, { prefix: 'u:' });

      const [aptRecords, userRecords] = await Promise.all([
        Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`))),
        Promise.all(userKeys.map(k => kvGet(ctx, k.name))),
      ]);

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

    if (url.pathname.startsWith('/admin/export/') && ctx.kv) {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      await initServices(ctx);
      const file = url.pathname.split('/').pop();

      if (file === 'clients.csv') {
        const userKeys = await kvListAll(ctx, { prefix: 'u:' });
        const users = await Promise.all(userKeys.map(k => kvGet(ctx, k.name)));
        let csv = 'Chat ID,Name,Phone,Username,Language,Registered\n';
        for (const u of users) {
          if (!u) continue;
          csv += `${u.chatId},"${(u.name||'').replace(/[\r\n]/g,' ').replace(/"/g,'""')}",${u.phone},${u.tgUsername||''},${u.tgLang||''},${u.registeredAt ? new Date(u.registeredAt).toISOString() : ''}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="clients.csv"' } });
      }

      if (file === 'appointments.csv') {
        const csvW = warsawNow();
        const csvMonthKeys = [-2, -1, 0].map(off => {
          const d = new Date(Date.UTC(csvW.year, csvW.month - 1 + off, 1));
          return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
        });
        const csvBuckets = await Promise.all(csvMonthKeys.map(k => kvGet(ctx, k)));
        const allIds = [...new Set(csvBuckets.flatMap(b => b || []))];
        const apts = await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`)));
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
      if (!ctx.kv) return new Response('Service unavailable', { status: 503 });
      await initServices(ctx);
      const apt = await ctx.kv.get(ctx.prefix + 'ap:' + aptId, 'json');
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
      const kv = env.MANICBOT;
      if (kv) {
        const tenantIds = await listTenantIds(kv);
        if (tenantIds.length > 0) {
          for (const tenantId of tenantIds) {
            const botIds = await getBotIdsByTenantId(kv, tenantId);
            if (botIds.length === 0) continue;
            const resolved = await resolveTenantFromBotId(kv, botIds[0], env.BOT_ENCRYPTION_KEY || null);
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
