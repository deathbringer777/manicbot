/**
 * KV → D1 migration script.
 * Run as Worker endpoint: GET /admin/migrate-d1?key=ADMIN_KEY
 */

import { dbRun, dbGet, dbBatch } from '../src/utils/db.js';

export async function migrateKvToD1(ctx) {
  const kv = ctx.kv || ctx.globalKv;
  if (!kv || !ctx.db) return { ok: false, error: 'KV or DB not bound' };

  const done = await kv.get('migration:d1:done', 'text');
  if (done) return { ok: true, skipped: true, message: 'Migration already completed' };

  const log = [];
  const stats = { tenants: 0, bots: 0, users: 0, masters: 0, appointments: 0, services: 0, roles: 0, tickets: 0, config: 0 };

  // 1. Migrate tenants
  const tenantsIndex = await kv.get('tenants_index', 'json');
  const tenantIds = Array.isArray(tenantsIndex) ? tenantsIndex : [];
  for (const tenantId of tenantIds) {
    const tenant = await kv.get(`tenant:${tenantId}`, 'json');
    if (!tenant) continue;
    try {
      await dbRun(ctx,
        `INSERT OR IGNORE INTO tenants (id, name, active, salon, photos, about_photos, maps_url, instagram_url, plan, billing_status, subscription_status, trial_ends_at, grace_ends_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, next_payment_date, billing_email, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        tenant.id, tenant.name || tenantId, tenant.active !== false ? 1 : 0,
        tenant.salon ? JSON.stringify(tenant.salon) : null,
        tenant.photos ? JSON.stringify(tenant.photos) : null,
        tenant.aboutPhotos ? JSON.stringify(tenant.aboutPhotos) : null,
        tenant.mapsUrl || null, tenant.instagramUrl || null,
        tenant.plan || 'start', tenant.billingStatus || 'trialing',
        tenant.subscriptionStatus || null, tenant.trialEndsAt || null,
        tenant.graceEndsAt || null, tenant.stripeCustomerId || null,
        tenant.stripeSubscriptionId || null, tenant.stripePriceId || null,
        tenant.currentPeriodEnd || null, tenant.nextPaymentDate || null,
        tenant.billingEmail || null, tenant.cancelAtPeriodEnd ? 1 : 0,
        tenant.createdAt || Date.now(), tenant.updatedAt || Date.now(),
      );
      stats.tenants++;
    } catch (e) { log.push(`tenant ${tenantId}: ${e.message}`); }
  }

  // 2. Migrate bots
  let botCursor;
  do {
    const res = await kv.list({ prefix: 'bot:', cursor: botCursor });
    for (const k of res.keys) {
      const botId = k.name.slice(4);
      if (!botId) continue;
      const bot = await kv.get(k.name, 'json');
      if (!bot) continue;
      try {
        await dbRun(ctx,
          'INSERT OR IGNORE INTO bots (bot_id, tenant_id, bot_username, webhook_secret, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          bot.botId || botId, bot.tenantId || null, bot.botUsername || null,
          bot.webhookSecret || '', bot.active !== false ? 1 : 0,
          bot.createdAt || Date.now(), bot.updatedAt || Date.now(),
        );
        if (bot.botToken || bot.encryptedToken) {
          const tokenVal = bot.encryptedToken || bot.botToken;
          await kv.put(`bottoken:${bot.botId || botId}`, tokenVal);
        }
        stats.bots++;
      } catch (e) { log.push(`bot ${botId}: ${e.message}`); }
    }
    botCursor = res.list_complete ? undefined : res.cursor;
  } while (botCursor);

  // 3. Per-tenant data
  for (const tenantId of tenantIds) {
    const prefix = `t:${tenantId}:`;

    // Users
    let uCursor;
    do {
      const res = await kv.list({ prefix: prefix + 'u:', cursor: uCursor });
      for (const k of res.keys) {
        const u = await kv.get(k.name, 'json');
        if (!u) continue;
        try {
          await dbRun(ctx,
            'INSERT OR IGNORE INTO users (tenant_id, chat_id, name, tg_username, tg_lang, phone, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            tenantId, u.chatId, u.name || null, u.tgUsername || null, u.tgLang || null, u.phone || null, u.registeredAt || null,
          );
          stats.users++;
        } catch (e) { log.push(`user ${tenantId}/${u.chatId}: ${e.message}`); }
      }
      uCursor = res.list_complete ? undefined : res.cursor;
    } while (uCursor);

    // Masters
    const masterIndex = await kv.get(prefix + 'master:__index', 'json');
    const masterIds = Array.isArray(masterIndex) ? masterIndex : [];
    for (const cid of masterIds) {
      const m = await kv.get(prefix + `master:${cid}`, 'json');
      if (!m) continue;
      try {
        await dbRun(ctx,
          'INSERT OR IGNORE INTO masters (tenant_id, chat_id, name, tg_username, services, work_hours, work_days, on_vacation, active, added_at, google_calendar_id, calendar_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          tenantId, cid, m.name || null, m.tgUsername || null,
          m.services ? JSON.stringify(m.services) : null,
          m.workHours ? JSON.stringify(m.workHours) : null,
          m.workDays ? JSON.stringify(m.workDays) : null,
          m.onVacation ? 1 : 0, m.active !== false ? 1 : 0,
          m.addedAt || null, m.googleCalendarId || null, m.calendarEnabled ? 1 : 0,
        );
        stats.masters++;
      } catch (e) { log.push(`master ${tenantId}/${cid}: ${e.message}`); }
    }

    // Roles
    let rCursor;
    do {
      const res = await kv.list({ prefix: prefix + 'role:', cursor: rCursor });
      for (const k of res.keys) {
        const chatId = k.name.slice((prefix + 'role:').length);
        const v = await kv.get(k.name, 'json');
        if (!v?.role) continue;
        try {
          await dbRun(ctx,
            'INSERT OR IGNORE INTO tenant_roles (tenant_id, chat_id, role, created_at) VALUES (?, ?, ?, ?)',
            tenantId, parseInt(chatId), v.role, v.createdAt || Date.now(),
          );
          stats.roles++;
        } catch (e) { log.push(`role ${tenantId}/${chatId}: ${e.message}`); }
      }
      rCursor = res.list_complete ? undefined : res.cursor;
    } while (rCursor);

    // Appointments
    let aCursor;
    do {
      const res = await kv.list({ prefix: prefix + 'ap:', cursor: aCursor });
      for (const k of res.keys) {
        const a = await kv.get(k.name, 'json');
        if (!a) continue;
        try {
          await dbRun(ctx,
            `INSERT OR IGNORE INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, user_name, user_phone, user_tg, confirmed_by, counter_time, counter_comment, reject_comment, cancel_reason, cancelled, rem_h24, rem_h2, google_event_id, google_calendar_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            a.id, tenantId, a.chatId, a.svcId, a.date, a.time, a.ts,
            a.status || 'pending', a.masterId || null,
            a.userName || null, a.userPhone || null, a.userTg || null,
            a.confirmedBy || null, a.counterTime || null, a.counterComment || null,
            a.rejectComment || null, a.cancelReason || null,
            a.cx ? 1 : 0, a.rem?.h24 ? 1 : 0, a.rem?.h2 ? 1 : 0,
            a.googleEventId || null, a.googleCalendarId || null, a.createdAt || Date.now(),
          );
          stats.appointments++;
        } catch (e) { log.push(`apt ${a.id}: ${e.message}`); }
      }
      aCursor = res.list_complete ? undefined : res.cursor;
    } while (aCursor);

    // Services
    const svcList = await kv.get(prefix + 'cfg:svc_list', 'json');
    if (Array.isArray(svcList)) {
      for (const s of svcList) {
        try {
          await dbRun(ctx,
            'INSERT OR IGNORE INTO services (tenant_id, svc_id, emoji, duration, price, active, hidden, sort_order, names, description, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            tenantId, s.id, s.e || null, s.dur, s.price,
            s.active !== false ? 1 : 0, s.hidden ? 1 : 0, s.order || 0,
            s.names ? JSON.stringify(s.names) : null,
            s.desc ? JSON.stringify(s.desc) : null,
            s.photos ? JSON.stringify(s.photos) : null,
          );
          stats.services++;
        } catch (e) { log.push(`svc ${tenantId}/${s.id}: ${e.message}`); }
      }
    }

    // Config entries
    const configKeys = ['admin', 'about_photos', 'about_desc', 'instagram_url'];
    for (const cfgKey of configKeys) {
      const val = await kv.get(prefix + `cfg:${cfgKey}`, 'text');
      if (val != null) {
        try {
          await dbRun(ctx,
            'INSERT OR IGNORE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)',
            tenantId, cfgKey, val,
          );
          stats.config++;
        } catch (e) { log.push(`cfg ${tenantId}/${cfgKey}: ${e.message}`); }
      }
    }

    // Blocked users
    let bCursor;
    do {
      const res = await kv.list({ prefix: prefix + 'blocked:', cursor: bCursor });
      for (const k of res.keys) {
        const chatId = k.name.slice((prefix + 'blocked:').length);
        try {
          await dbRun(ctx, 'INSERT OR IGNORE INTO blocked_users (tenant_id, chat_id) VALUES (?, ?)', tenantId, parseInt(chatId));
        } catch (e) { log.push(`blocked ${tenantId}/${chatId}: ${e.message}`); }
      }
      bCursor = res.list_complete ? undefined : res.cursor;
    } while (bCursor);
  }

  // 4. Platform roles
  let prCursor;
  do {
    const res = await kv.list({ prefix: 'role:', cursor: prCursor });
    for (const k of res.keys) {
      const chatId = k.name.slice(5);
      const v = await kv.get(k.name, 'json');
      if (!v?.role) continue;
      try {
        await dbRun(ctx,
          'INSERT OR IGNORE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)',
          parseInt(chatId), v.role, v.createdAt || Date.now(),
        );
      } catch (e) { log.push(`platform_role ${chatId}: ${e.message}`); }
    }
    prCursor = res.list_complete ? undefined : res.cursor;
  } while (prCursor);

  // 5. Support agents
  const supportAgents = await kv.get('support:agents', 'json');
  if (Array.isArray(supportAgents)) {
    for (const chatId of supportAgents) {
      try { await dbRun(ctx, "INSERT OR IGNORE INTO support_agents (chat_id, type) VALUES (?, 'support')", chatId); }
      catch (e) { log.push(`support_agent ${chatId}: ${e.message}`); }
    }
  }
  const techAgents = await kv.get('tech_support:agents', 'json');
  if (Array.isArray(techAgents)) {
    for (const chatId of techAgents) {
      try { await dbRun(ctx, "INSERT OR IGNORE INTO support_agents (chat_id, type) VALUES (?, 'technical')", chatId); }
      catch (e) { log.push(`tech_agent ${chatId}: ${e.message}`); }
    }
  }

  // 6. Stripe customers
  let scCursor;
  do {
    const res = await kv.list({ prefix: 'stripe_customer:', cursor: scCursor });
    for (const k of res.keys) {
      const customerId = k.name.slice('stripe_customer:'.length);
      const tenantId = await kv.get(k.name, 'text');
      if (tenantId) {
        try { await dbRun(ctx, 'INSERT OR IGNORE INTO stripe_customers (customer_id, tenant_id) VALUES (?, ?)', customerId, tenantId); }
        catch (e) { log.push(`stripe ${customerId}: ${e.message}`); }
      }
    }
    scCursor = res.list_complete ? undefined : res.cursor;
  } while (scCursor);

  await kv.put('migration:d1:done', '1');
  return { ok: true, stats, log: log.length > 0 ? log : undefined };
}
