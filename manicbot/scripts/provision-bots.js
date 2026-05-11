#!/usr/bin/env node
/**
 * Provision 4 bots: 2 salons + 2 masters.
 * Run: node scripts/provision-bots.js
 *
 * Uses wrangler KV CLI to write directly to KV.
 * Each bot gets its own tenant with unique name, services, prices, about.
 */

import { execSync } from 'child_process';

const KV_BINDING = 'MANICBOT';
const BASE_URL = 'https://manicbot.com';
const ADMIN_CHAT_ID = '321706035';
const TRIAL_DURATION_SEC = 14 * 24 * 3600;

// ── Bot definitions ─────────────────────────────────────────────

const BOTS = [
  {
    id: 'salon1',
    tenantId: 't_salon1',
    botToken: process.env.BOT_TOKEN_SALON1,
    botId: (process.env.BOT_TOKEN_SALON1 || '').split(':')[0],
    botUsername: 'manic_salon1bot',
    tenant: {
      name: 'Crystal Nails',
      salon: {
        name: 'Crystal Nails',
        address: 'ul. Nowy Świat 15, Warszawa',
        phone: '+48 22 100 10 01',
        timezone: 'Europe/Warsaw',
        workHours: { from: 9, to: 20 },
        currency: 'PLN',
      },
      aboutDesc: 'Crystal Nails — элегантный салон в самом сердце Варшавы. Кристальная чистота, премиальные материалы OPI и CND. Работаем по записи. Приходите — убедитесь сами!',
    },
    services: [
      { id: 'classic', e: '💅', dur: 50, price: 90, names: { ru: 'Классический маникюр', ua: 'Класичний манікюр', en: 'Classic manicure', pl: 'Manicure klasyczny' } },
      { id: 'gel', e: '💎', dur: 80, price: 150, names: { ru: 'Гель-лак', ua: 'Гель-лак', en: 'Gel polish', pl: 'Lakier hybrydowy' } },
      { id: 'pedi', e: '🦶', dur: 90, price: 130, names: { ru: 'Педикюр', ua: 'Педікюр', en: 'Pedicure', pl: 'Pedicure' } },
      { id: 'ext', e: '✨', dur: 120, price: 280, names: { ru: 'Наращивание', ua: 'Нарощування', en: 'Nail extensions', pl: 'Przedłużanie paznokci' } },
      { id: 'art', e: '🎨', dur: 40, price: 60, names: { ru: 'Дизайн ногтей', ua: 'Дизайн нігтів', en: 'Nail art', pl: 'Zdobienie paznokci' } },
      { id: 'spa_hands', e: '🧴', dur: 60, price: 110, names: { ru: 'SPA для рук', ua: 'SPA для рук', en: 'Hand SPA', pl: 'SPA dłoni' } },
    ],
    photos: {
      classic: ['https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600'],
      gel: ['https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600'],
      pedi: ['https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600'],
      ext: ['https://images.pexels.com/photos/939836/pexels-photo-939836.jpeg?w=600'],
      art: ['https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600'],
      spa_hands: ['https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600'],
    },
    aboutPhotos: [
      'https://images.pexels.com/photos/7750099/pexels-photo-7750099.jpeg?w=600',
      'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600',
    ],
  },
  {
    id: 'salon2',
    tenantId: 't_salon2',
    botToken: process.env.BOT_TOKEN_SALON2,
    botId: (process.env.BOT_TOKEN_SALON2 || '').split(':')[0],
    botUsername: 'manic_salon2bot',
    tenant: {
      name: 'Velvet Touch',
      salon: {
        name: 'Velvet Touch',
        address: 'ul. Mokotowska 42, Warszawa',
        phone: '+48 22 200 20 02',
        timezone: 'Europe/Warsaw',
        workHours: { from: 10, to: 21 },
        currency: 'PLN',
      },
      aboutDesc: 'Velvet Touch — бутик-салон для тех, кто ценит роскошь. Японский маникюр, SPA-педикюр и авторский дизайн. Уютная атмосфера и персональный подход к каждому клиенту.',
    },
    services: [
      { id: 'japanese', e: '🌸', dur: 70, price: 170, names: { ru: 'Японский маникюр', ua: 'Японський манікюр', en: 'Japanese manicure', pl: 'Manicure japoński' } },
      { id: 'gel_lux', e: '💎', dur: 90, price: 200, names: { ru: 'Гель-лак Luxio', ua: 'Гель-лак Luxio', en: 'Luxio gel polish', pl: 'Lakier Luxio' } },
      { id: 'spa_pedi', e: '🦶', dur: 100, price: 180, names: { ru: 'SPA-педикюр', ua: 'SPA-педікюр', en: 'SPA pedicure', pl: 'Pedicure SPA' } },
      { id: 'ext_gel', e: '✨', dur: 130, price: 350, names: { ru: 'Наращивание гелем', ua: 'Нарощування гелем', en: 'Gel extensions', pl: 'Przedłużanie żelem' } },
      { id: 'design', e: '🎨', dur: 45, price: 80, names: { ru: 'Авторский дизайн', ua: 'Авторський дизайн', en: 'Custom nail art', pl: 'Autorski design' } },
      { id: 'combo', e: '👑', dur: 150, price: 300, names: { ru: 'Комбо: маникюр + педикюр', ua: 'Комбо: манікюр + педікюр', en: 'Combo: mani + pedi', pl: 'Combo: mani + pedi' } },
    ],
    photos: {
      japanese: ['https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600'],
      gel_lux: ['https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600'],
      spa_pedi: ['https://images.pexels.com/photos/4155017/pexels-photo-4155017.jpeg?w=600'],
      ext_gel: ['https://images.pexels.com/photos/3738375/pexels-photo-3738375.jpeg?w=600'],
      design: ['https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600'],
      combo: ['https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600', 'https://images.pexels.com/photos/4155017/pexels-photo-4155017.jpeg?w=600'],
    },
    aboutPhotos: [
      'https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600',
      'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600',
    ],
  },
  {
    id: 'master1',
    tenantId: 't_master1',
    botToken: process.env.BOT_TOKEN_MASTER1,
    botId: (process.env.BOT_TOKEN_MASTER1 || '').split(':')[0],
    botUsername: 'manic_master1bot',
    tenant: {
      name: 'Мастер Алина',
      salon: {
        name: 'Мастер Алина',
        address: 'ul. Złota 59, Warszawa (Złote Tarasy)',
        phone: '+48 22 300 30 03',
        timezone: 'Europe/Warsaw',
        workHours: { from: 10, to: 19 },
        currency: 'PLN',
      },
      aboutDesc: 'Привет! Я Алина — мастер маникюра с 5-летним опытом. Специализируюсь на сложном дизайне и аппаратном маникюре. Работаю на себя, принимаю по записи в Złote Tarasy.',
    },
    services: [
      { id: 'hardware', e: '⚙️', dur: 60, price: 100, names: { ru: 'Аппаратный маникюр', ua: 'Апаратний манікюр', en: 'Hardware manicure', pl: 'Manicure frezarkowy' } },
      { id: 'gel', e: '💎', dur: 80, price: 130, names: { ru: 'Покрытие гель-лаком', ua: 'Покриття гель-лаком', en: 'Gel polish coating', pl: 'Pokrycie hybrydą' } },
      { id: 'complex_design', e: '🎨', dur: 100, price: 180, names: { ru: 'Сложный дизайн', ua: 'Складний дизайн', en: 'Complex nail art', pl: 'Zdobienie złożone' } },
      { id: 'removal', e: '🧹', dur: 30, price: 40, names: { ru: 'Снятие покрытия', ua: 'Зняття покриття', en: 'Polish removal', pl: 'Usunięcie hybrydy' } },
      { id: 'strengthen', e: '💪', dur: 70, price: 120, names: { ru: 'Укрепление ногтей', ua: 'Зміцнення нігтів', en: 'Nail strengthening', pl: 'Wzmocnienie paznokci' } },
    ],
    photos: {
      hardware: ['https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600'],
      gel: ['https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600'],
      complex_design: ['https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600', 'https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600'],
      removal: ['https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600'],
      strengthen: ['https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600'],
    },
    aboutPhotos: [
      'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600',
    ],
  },
  {
    id: 'master2',
    tenantId: 't_master2',
    botToken: process.env.BOT_TOKEN_MASTER2,
    botId: (process.env.BOT_TOKEN_MASTER2 || '').split(':')[0],
    botUsername: 'manic_master2bot',
    tenant: {
      name: 'Мастер Виктория',
      salon: {
        name: 'Мастер Виктория',
        address: 'ul. Puławska 12, Warszawa',
        phone: '+48 22 400 40 04',
        timezone: 'Europe/Warsaw',
        workHours: { from: 11, to: 20 },
        currency: 'PLN',
      },
      aboutDesc: 'Виктория — сертифицированный мастер ногтевого сервиса. Обучалась в Корее. Педикюр, наращивание, работа с проблемными ногтями. Принимаю в своей студии у метро Puławska.',
    },
    services: [
      { id: 'mani_classic', e: '💅', dur: 55, price: 85, names: { ru: 'Маникюр классический', ua: 'Манікюр класичний', en: 'Classic manicure', pl: 'Manicure klasyczny' } },
      { id: 'gel_korean', e: '🇰🇷', dur: 90, price: 160, names: { ru: 'Корейский гель', ua: 'Корейський гель', en: 'Korean gel', pl: 'Żel koreański' } },
      { id: 'pedi_medical', e: '🏥', dur: 100, price: 200, names: { ru: 'Медицинский педикюр', ua: 'Медичний педікюр', en: 'Medical pedicure', pl: 'Pedicure medyczny' } },
      { id: 'ext_acrylic', e: '✨', dur: 110, price: 260, names: { ru: 'Акриловое наращивание', ua: 'Акрилове нарощування', en: 'Acrylic extensions', pl: 'Przedłużanie akrylowe' } },
      { id: 'repair', e: '🔧', dur: 30, price: 50, names: { ru: 'Ремонт ногтя', ua: 'Ремонт нігтя', en: 'Nail repair', pl: 'Naprawa paznokcia' } },
      { id: 'paraffin', e: '🕯️', dur: 40, price: 70, names: { ru: 'Парафинотерапия', ua: 'Парафінотерапія', en: 'Paraffin therapy', pl: 'Parafina' } },
    ],
    photos: {
      mani_classic: ['https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600'],
      gel_korean: ['https://images.pexels.com/photos/4963822/pexels-photo-4963822.jpeg?w=600'],
      pedi_medical: ['https://images.pexels.com/photos/9789207/pexels-photo-9789207.jpeg?w=600'],
      ext_acrylic: ['https://images.pexels.com/photos/7320686/pexels-photo-7320686.jpeg?w=600'],
      repair: ['https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600'],
      paraffin: ['https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600'],
    },
    aboutPhotos: [
      'https://images.pexels.com/photos/7750099/pexels-photo-7750099.jpeg?w=600',
      'https://images.pexels.com/photos/4963822/pexels-photo-4963822.jpeg?w=600',
    ],
  },
];

const CORRECTION_SVC = {
  id: 'correction', e: '🔧', dur: 30, price: 0, active: true, hidden: true, order: 999,
  names: { ru: 'Исправление', ua: 'Виправлення', en: 'Correction', pl: 'Korekta' },
  desc: { ru: null, ua: null, en: null, pl: null },
  photos: [],
};

// ── Helpers ──────────────────────────────────────────────────────

function kvPut(key, value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  // Escape for shell
  const escaped = json.replace(/'/g, "'\\''");
  const cmd = `npx wrangler kv key put --binding ${KV_BINDING} "${key}" '${escaped}'`;
  console.log(`  KV PUT: ${key}`);
  execSync(cmd, { cwd: process.cwd(), stdio: 'pipe' });
}

function kvGet(key) {
  try {
    const cmd = `npx wrangler kv key get --binding ${KV_BINDING} "${key}" 2>/dev/null`;
    const result = execSync(cmd, { cwd: process.cwd(), stdio: 'pipe' }).toString().trim();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

function buildSvcList(bot) {
  return bot.services.map((s, i) => ({
    id: s.id,
    e: s.e,
    dur: s.dur,
    price: s.price,
    active: true,
    order: i,
    names: s.names,
    desc: { ru: null, ua: null, en: null, pl: null },
    photos: bot.photos[s.id] || [],
  }));
}

function generateWebhookSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('=== ManicBot: Provisioning 4 bots ===\n');

  const missing = BOTS.filter(b => !b.botToken).map(b => `BOT_TOKEN_${b.id.toUpperCase()}`);
  if (missing.length) {
    console.error(`FATAL: missing env vars: ${missing.join(', ')}`);
    console.error('Set them before running, e.g.:');
    console.error('  BOT_TOKEN_SALON1=... BOT_TOKEN_SALON2=... \\');
    console.error('  BOT_TOKEN_MASTER1=... BOT_TOKEN_MASTER2=... node scripts/provision-bots.js');
    process.exit(1);
  }

  // 1. Read current tenants index
  let tenantsIndex = kvGet('tenants_index') || [];
  console.log(`Current tenants: [${tenantsIndex.join(', ')}]\n`);

  for (const bot of BOTS) {
    console.log(`\n── ${bot.tenant.name} (@${bot.botUsername}) ──`);

    // Skip if already exists
    if (tenantsIndex.includes(bot.tenantId)) {
      console.log(`  SKIP: tenant ${bot.tenantId} already exists`);
      continue;
    }

    const now = Math.floor(Date.now() / 1000);
    const webhookSecret = generateWebhookSecret();

    // 2. Create tenant
    const tenantPayload = {
      id: bot.tenantId,
      name: bot.tenant.name,
      active: true,
      createdAt: now,
      updatedAt: now,
      salon: bot.tenant.salon,
      plan: 'pro',
      billingStatus: 'trialing',
      trialEndsAt: now + TRIAL_DURATION_SEC,
      graceEndsAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      billingEmail: null,
      cancelAtPeriodEnd: false,
    };
    kvPut(`tenant:${bot.tenantId}`, tenantPayload);

    // 3. Register bot
    const botPayload = {
      botId: bot.botId,
      tenantId: bot.tenantId,
      botToken: bot.botToken,
      botUsername: bot.botUsername,
      webhookSecret,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    kvPut(`bot:${bot.botId}`, botPayload);
    kvPut(`botmap:${bot.botId}`, bot.tenantId);
    kvPut(`botsindex:${bot.tenantId}`, [bot.botId]);

    // 4. Seed services
    const prefix = `t:${bot.tenantId}:`;
    const svcList = [...buildSvcList(bot), CORRECTION_SVC];
    kvPut(`${prefix}cfg:svc_list`, svcList);

    // 5. About
    kvPut(`${prefix}cfg:about_photos`, bot.aboutPhotos);
    kvPut(`${prefix}cfg:about_desc`, bot.tenant.aboutDesc);

    // 6. Set admin (platform creator as admin for each tenant)
    kvPut(`${prefix}cfg:admin`, ADMIN_CHAT_ID);

    // Add to index
    tenantsIndex.push(bot.tenantId);

    console.log(`  ✅ Tenant created: ${bot.tenantId}`);
    console.log(`  ✅ Bot registered: ${bot.botId}`);
    console.log(`  ✅ Services seeded: ${svcList.length - 1} + correction`);
    console.log(`  🔑 Webhook secret: ${webhookSecret}`);
  }

  // 7. Update tenants index
  kvPut('tenants_index', tenantsIndex);
  console.log(`\n✅ Tenants index updated: [${tenantsIndex.join(', ')}]`);

  // 8. Set up webhooks via Telegram API
  console.log('\n=== Setting up webhooks ===\n');
  for (const bot of BOTS) {
    const webhookUrl = `${BASE_URL}/webhook/${bot.botId}`;
    // Read back the stored webhook secret
    const storedBot = kvGet(`bot:${bot.botId}`);
    const secret = storedBot?.webhookSecret || '';

    const tgUrl = `https://api.telegram.org/bot${bot.botToken}/setWebhook`;
    const body = JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    });

    try {
      const curlCmd = `curl -s -X POST "${tgUrl}" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`;
      const result = execSync(curlCmd, { stdio: 'pipe' }).toString();
      const parsed = JSON.parse(result);
      console.log(`  @${bot.botUsername}: webhook → ${webhookUrl} — ${parsed.ok ? '✅' : '❌ ' + parsed.description}`);
    } catch (e) {
      console.log(`  @${bot.botUsername}: ❌ ${e.message}`);
    }

    // Also set bot commands
    const cmdsUrl = `https://api.telegram.org/bot${bot.botToken}/setMyCommands`;
    const cmds = JSON.stringify({
      commands: [
        { command: 'start', description: '💅 Главное меню / Main menu' },
        { command: 'book', description: '📝 Записаться / Book now' },
        { command: 'my', description: '📋 Мои записи / My appointments' },
        { command: 'lang', description: '🌐 Язык / Language' },
      ],
    });
    try {
      execSync(`curl -s -X POST "${cmdsUrl}" -H "Content-Type: application/json" -d '${cmds.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
      console.log(`  @${bot.botUsername}: commands set ✅`);
    } catch {}
  }

  console.log('\n=== Done! All 4 bots provisioned. ===');
  console.log('Test: send /start to each bot in Telegram.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
