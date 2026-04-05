import { nowSec, msToSec } from '../utils/time.js';
import { getTenantIdByBotId, getTenant, putTenant, putBot } from '../tenant/storage.js';
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
  // Check if any bot is unregistered OR any tenant is missing photos (needs sync)
  let needsProvision = false;
  for (const b of DEMO_BOTS) {
    const bid = b.botToken.split(':')[0];
    const tid = await getTenantIdByBotId(ec, bid);
    if (!tid) { needsProvision = true; break; }
    const tenant = await getTenant(ec, tid);
    if (!tenant?.photos?.length) { needsProvision = true; break; }
  }
  if (!needsProvision) {
    _demoProvisioned = true;
    return;
  }

  console.log('Self-provisioning demo bots (some missing)...');
  const { dbRun } = await import('../utils/db.js');
  const TRIAL_SEC = msToSec(7 * 24 * 3600 * 1000);
  const now = nowSec();

  // Curated Pexels photo URLs per demo tenant (light pink / dark luxury / clean minimal / colorful)
  const DEMO_PHOTOS = {
    t_salon1: {
      logo: 'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?auto=compress&cs=tinysrgb&w=200',
      coverPhoto: 'https://images.pexels.com/photos/3997390/pexels-photo-3997390.jpeg?auto=compress&cs=tinysrgb&w=800',
      photos: [
        'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/3997380/pexels-photo-3997380.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/4046316/pexels-photo-4046316.jpeg?auto=compress&cs=tinysrgb&w=400',
      ],
    },
    t_salon2: {
      logo: 'https://images.pexels.com/photos/7290075/pexels-photo-7290075.jpeg?auto=compress&cs=tinysrgb&w=200',
      coverPhoto: 'https://images.pexels.com/photos/7290075/pexels-photo-7290075.jpeg?auto=compress&cs=tinysrgb&w=800',
      photos: [
        'https://images.pexels.com/photos/7290075/pexels-photo-7290075.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/3997381/pexels-photo-3997381.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/4046317/pexels-photo-4046317.jpeg?auto=compress&cs=tinysrgb&w=400',
      ],
    },
    t_master1: {
      coverPhoto: 'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?auto=compress&cs=tinysrgb&w=800',
      photos: [
        'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/3997386/pexels-photo-3997386.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?auto=compress&cs=tinysrgb&w=400',
      ],
    },
    t_master2: {
      coverPhoto: 'https://images.pexels.com/photos/4046315/pexels-photo-4046315.jpeg?auto=compress&cs=tinysrgb&w=800',
      photos: [
        'https://images.pexels.com/photos/4046315/pexels-photo-4046315.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/4046318/pexels-photo-4046318.jpeg?auto=compress&cs=tinysrgb&w=400',
        'https://images.pexels.com/photos/4046319/pexels-photo-4046319.jpeg?auto=compress&cs=tinysrgb&w=400',
      ],
    },
  };

  const TENANTS = {
    t_salon1: {
      name: 'Crystal Nails', slug: 'crystal-nails', city: 'Warszawa', publicActive: true,
      description: 'Студия маникюра Crystal Nails — нежный дизайн, гель-лак и наращивание в центре Варшавы.',
      salon: { name: 'Crystal Nails', address: 'ul. Nowy Świat 15, Warszawa', phone: '+48 22 100 10 01', timezone: 'Europe/Warsaw', workHours: { from: 9, to: 20 }, currency: 'PLN' },
      ...DEMO_PHOTOS.t_salon1,
    },
    t_salon2: {
      name: 'Velvet Touch', slug: 'velvet-touch', city: 'Warszawa', publicActive: true,
      description: 'Velvet Touch — премиальный маникюр и педикюр. Индивидуальный подход и люксовые материалы.',
      salon: { name: 'Velvet Touch', address: 'ul. Mokotowska 42, Warszawa', phone: '+48 22 200 20 02', timezone: 'Europe/Warsaw', workHours: { from: 10, to: 21 }, currency: 'PLN' },
      ...DEMO_PHOTOS.t_salon2,
    },
    t_master1: {
      name: 'Мастер Алина', slug: 'master-alina', city: 'Warszawa', publicActive: true,
      description: 'Мастер Алина — классический и аппаратный маникюр, нежный дизайн.',
      salon: { name: 'Мастер Алина', address: 'ul. Złota 59, Warszawa', phone: '+48 22 300 30 03', timezone: 'Europe/Warsaw', workHours: { from: 10, to: 19 }, currency: 'PLN' },
      ...DEMO_PHOTOS.t_master1,
    },
    t_master2: {
      name: 'Мастер Виктория', slug: 'master-victoria', city: 'Warszawa', publicActive: true,
      description: 'Мастер Виктория — наращивание, коррекция и авторский дизайн ногтей.',
      salon: { name: 'Мастер Виктория', address: 'ul. Puławska 12, Warszawa', phone: '+48 22 400 40 04', timezone: 'Europe/Warsaw', workHours: { from: 11, to: 20 }, currency: 'PLN' },
      ...DEMO_PHOTOS.t_master2,
    },
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
      photos: t.photos,
      logo: t.logo || null,
      coverPhoto: t.coverPhoto || null,
      slug: t.slug || null,
      city: t.city || null,
      description: t.description || null,
      publicActive: t.publicActive || false,
      searchText: (t.name + ' ' + (t.city || '') + ' ' + (t.description || '')).toLowerCase(),
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
