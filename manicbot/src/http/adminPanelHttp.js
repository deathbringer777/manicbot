import { timingSafeEqual, checkAdmin, requireAdmin } from '../utils/security.js';
import { dbAll } from '../utils/db.js';
import { escHtml } from '../utils/helpers.js';
import { getAdminAllApts } from '../services/appointments.js';
import { api } from '../telegram.js';
import { initServices } from '../services/services.js';
import { listTenantIds, getTenant } from '../tenant/storage.js';

/**
 * @param {Request} request
 * @param {any} ctx
 * @param {URL} url
 * @param {Response} ADMIN_401
 * @returns {Promise<Response | null>}
 */
export async function tryAdminPanel(request, ctx, url, ADMIN_401) {
  if (url.pathname === '/setup') {
    const authResp = await requireAdmin(request, ctx);
    if (authResp) return authResp;
    const botId =
      ctx.bot?.botId || (ctx.TG && ctx.TG.includes('/bot') ? ctx.TG.replace(/.*\/bot(\d+).*/, '$1') : null);
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
    const authResp = await requireAdmin(request, ctx);
    if (authResp) return authResp;
    return Response.json({ result: await api(ctx, 'deleteWebhook', {}) });
  }

  if (url.pathname === '/admin/billing') {
    // #S10: rate-limited admin auth (per-credential, not per-IP).
    const authResp = await requireAdmin(request, ctx);
    if (authResp) return authResp;
    if (!ctx.db) return new Response('DB not bound', { status: 500 });
    const tenantIds = await listTenantIds(ctx);
    const tenants = await Promise.all(tenantIds.map(id => getTenant(ctx, id)));
    const fmt = ts => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '—');
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
      const cust = t.stripeCustomerId ? t.stripeCustomerId.slice(0, 12) + '…' : '—';
      html += `<tr><td>${name}</td><td>${plan}</td><td>${status}</td><td>${periodEnd}</td><td>${escHtml(cust)}</td></tr>`;
    }
    html += '</table></body></html>';
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }

  if (url.pathname === '/admin') {
    // #S10: rate-limited admin auth.
    const authResp = await requireAdmin(request, ctx);
    if (authResp) return authResp;
    if (!ctx.db) return new Response('DB not bound', { status: 500 });
    await initServices(ctx);

    const aptRecords = await getAdminAllApts(ctx);
    const userRows = ctx.tenantId ? await dbAll(ctx, 'SELECT * FROM users WHERE tenant_id = ?', ctx.tenantId) : [];
    const userRecords = userRows.map(r => ({
      chatId: r.chat_id,
      name: r.name,
      phone: r.phone,
      tgUsername: r.tg_username,
      tgLang: r.tg_lang,
      registeredAt: r.registered_at,
    }));

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
          status: a.cx
            ? '❌ Отменено'
            : a.status === 'pending'
              ? '⏳ Ожидает'
              : a.status === 'rejected'
                ? '❌ Отклонено'
                : a.status === 'counter_offer'
                  ? '💬 Предложен другой час'
                  : a.ts < Date.now()
                    ? '✅ Завершено'
                    : '✅ Подтверждено',
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

    // Channels info
    let channelRows = [];
    try {
      const tid = ctx.tenantId;
      if (tid && ctx.db) {
        channelRows = await dbAll(ctx, 'SELECT * FROM channel_configs WHERE tenant_id = ?', tid);
      }
    } catch {}

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
.badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:.75em;font-weight:600}
.badge-ok{background:#d1fae5;color:#065f46}
.badge-off{background:#fee2e2;color:#991b1b}
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
    html += `</table>`;

    // ── Channels section ──
    html += `<h2>📡 Каналы</h2>`;
    html += `<table><tr><th>Канал</th><th>Статус</th><th>ID (page_id / phone_number_id)</th><th>Webhook</th></tr>`;
    const telegramWebhook = ctx.bot?.botId ? `${url.origin}/webhook/${ctx.bot.botId}` : `${url.origin}/webhook`;
    html += `<tr><td>🤖 Telegram</td><td><span class="badge badge-ok">Подключён</span></td><td>${escHtml(ctx.bot?.botId || '—')}</td><td>${escHtml(telegramWebhook)}</td></tr>`;
    for (const ch of channelRows) {
      const type = ch.channel_type;
      const icon = type === 'whatsapp' ? '💬' : type === 'instagram' ? '📸' : '📡';
      const label = type === 'whatsapp' ? 'WhatsApp' : type === 'instagram' ? 'Instagram' : escHtml(type);
      const active = ch.active === 1;
      const badge = active ? '<span class="badge badge-ok">Активен</span>' : '<span class="badge badge-off">Выкл</span>';
      let identifier = '—';
      try {
        const cfg = ch.config ? JSON.parse(ch.config) : {};
        if (type === 'whatsapp') identifier = cfg.phone_number_id || '—';
        if (type === 'instagram') identifier = cfg.page_id || cfg.ig_account_id || '—';
      } catch {}
      const whPath = type === 'whatsapp' ? '/webhook/wa' : type === 'instagram' ? '/webhook/ig' : '';
      html += `<tr><td>${icon} ${label}</td><td>${badge}</td><td>${escHtml(identifier)}</td><td>${escHtml(whPath ? url.origin + whPath : '—')}</td></tr>`;
    }
    if (channelRows.length === 0) {
      html += `<tr><td colspan="4" style="text-align:center;color:#9ca3af">Нет подключённых каналов (настройте через Mini App → Channels)</td></tr>`;
    }
    html += `</table>`;

    html += `</body></html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }

  if (url.pathname.startsWith('/admin/export/')) {
    // #S10: rate-limited admin auth.
    const authResp = await requireAdmin(request, ctx);
    if (authResp) return authResp;
    await initServices(ctx);
    const file = url.pathname.split('/').pop();

    // Escape CSV cell. Prevents:
    //  - Formula injection: leading =, +, -, @, TAB, CR → prefix with single quote.
    //  - Quote/newline breaking: double quotes doubled, newlines stripped.
    // Output is always wrapped in double quotes.
    const csvCell = (v) => {
      let s = v == null ? '' : String(v).replace(/[\r\n]/g, ' ');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      s = s.replace(/"/g, '""');
      return `"${s}"`;
    };

    if (file === 'clients.csv') {
      const rows = ctx.tenantId ? await dbAll(ctx, 'SELECT * FROM users WHERE tenant_id = ?', ctx.tenantId) : [];
      const users = rows.map(r => ({
        chatId: r.chat_id,
        name: r.name,
        phone: r.phone,
        tgUsername: r.tg_username,
        tgLang: r.tg_lang,
        registeredAt: r.registered_at,
      }));
      let csv = 'Chat ID,Name,Phone,Username,Language,Registered\n';
      for (const u of users) {
        if (!u) continue;
        csv += [
          csvCell(u.chatId),
          csvCell(u.name),
          csvCell(u.phone),
          csvCell(u.tgUsername),
          csvCell(u.tgLang),
          csvCell(u.registeredAt ? new Date(u.registeredAt).toISOString() : ''),
        ].join(',') + '\n';
      }
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': 'attachment; filename="clients.csv"',
        },
      });
    }

    if (file === 'appointments.csv') {
      const apts = await getAdminAllApts(ctx);
      let csv = 'ID,Client,Chat ID,Service,Date,Time,Status,Created\n';
      for (const a of apts) {
        if (!a) continue;
        const status = a.cx
          ? 'Cancelled'
          : a.status === 'pending'
            ? 'Pending'
            : a.status === 'rejected'
              ? 'Rejected'
              : a.status === 'counter_offer'
                ? 'Counter-offer'
                : a.ts < Date.now()
                  ? 'Completed'
                  : 'Confirmed';
        csv += [
          csvCell(a.id),
          csvCell(a.userName),
          csvCell(a.chatId),
          csvCell(a.svcId),
          csvCell(a.date),
          csvCell(a.time),
          csvCell(status),
          csvCell(new Date(a.createdAt).toISOString()),
        ].join(',') + '\n';
      }
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': 'attachment; filename="appointments.csv"',
        },
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  return null;
}
