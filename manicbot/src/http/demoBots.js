import { nowSec, msToSec } from '../utils/time.js';
import { getTenantIdByBotId, putTenant, putBot } from '../tenant/storage.js';
import { envCtx } from './envCtx.js';

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

export async function ensureDemoBotsProvisioned(env) {
  if (_demoProvisioned) return;
  const ec = envCtx(env);
  if (!ec.db) return;
  const DEMO_BOTS = getDemoBots(env);
  if (!DEMO_BOTS.length) {
    _demoProvisioned = true;
    return;
  }
  let allOk = true;
  for (const b of DEMO_BOTS) {
    const bid = b.botToken.split(':')[0];
    const tid = await getTenantIdByBotId(ec, bid);
    if (!tid) {
      allOk = false;
      break;
    }
  }
  if (allOk) {
    _demoProvisioned = true;
    return;
  }

  console.log('Self-provisioning demo bots (some missing)...');
  const { dbRun } = await import('../utils/db.js');
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
      id: b.tenantId,
      name: t.name,
      active: true,
      createdAt: now,
      updatedAt: now,
      salon: t.salon,
      plan: 'pro',
      billingStatus: 'trialing',
      trialEndsAt: now + TRIAL_SEC,
      graceEndsAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      billingEmail: null,
      cancelAtPeriodEnd: false,
    });
    await putBot(ec, botId, {
      botId,
      tenantId: b.tenantId,
      botToken: b.botToken,
      botUsername: b.botUsername,
      webhookSecret: b.webhookSecret,
      active: true,
      createdAt: now,
      updatedAt: now,
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
