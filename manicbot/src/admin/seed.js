/**
 * One-time seed: 2 test salons with different services/prices/photos, 2 masters.
 * GET /admin/seed?key=ADMIN_KEY&master=dezbringer
 */

import { listTenantIds, getTenant, putTenant, getBotIdsByTenantId, getBotToken } from '../tenant/storage.js';
import { createTenant } from './provisioning.js';
import { setTenantRole, ROLES } from '../roles/roles.js';
import { saveMaster } from '../services/users.js';
import { saveServices } from '../services/services.js';
import { CORRECTION_SVC } from '../config.js';
import { dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';

const L = {
  ru: { svc_classic: 'Классический маникюр', svc_gel: 'Гель-лак', svc_pedi: 'Педикюр', svc_ext: 'Наращивание', svc_design: 'Дизайн', svc_combo: 'Маникюр + Педикюр' },
  ua: { svc_classic: 'Класичний манікюр', svc_gel: 'Гель-лак', svc_pedi: 'Педікюр', svc_ext: 'Нарощування', svc_design: 'Дизайн', svc_combo: 'Манікюр + Педікюр' },
  en: { svc_classic: 'Classic manicure', svc_gel: 'Gel polish', svc_pedi: 'Pedicure', svc_ext: 'Nail extensions', svc_design: 'Nail art', svc_combo: 'Manicure + Pedicure' },
  pl: { svc_classic: 'Manicure klasyczny', svc_gel: 'Żelowy lakier', svc_pedi: 'Pedicure', svc_ext: 'Przedłużanie', svc_design: 'Dizajn', svc_combo: 'Manicure + Pedicure' },
};

const DESC = {
  classic: { ru: 'Классический маникюр с обработкой кутикулы, придание формы и покрытие лаком.', ua: 'Класичний манікюр з обробкою кутикули та покриттям лаком.', en: 'Classic manicure with cuticle care, shaping and polish.', pl: 'Manicure klasyczny z pielęgnacją skórek i lakierem.' },
  gel: { ru: 'Стойкий гель-лак — держится до 3 недель. Широкая палитра цветов.', ua: 'Стійкий гель-лак — тримається до 3 тижнів. Широка палітра кольорів.', en: 'Long-lasting gel polish — up to 3 weeks. Wide color palette.', pl: 'Trwały żelowy lakier — do 3 tygodni. Szeroka paleta kolorów.' },
  pedi: { ru: 'Педикюр с обработкой стоп, ногтей и покрытием. Расслабляющий уход.', ua: 'Педикюр з обробкою стоп та покриттям. Розслабляючий догляд.', en: 'Pedicure with foot care, nail shaping and polish. Relaxing treatment.', pl: 'Pedicure z pielęgnacją stóp i paznokci. Relaksujący zabieg.' },
  ext: { ru: 'Наращивание гелем или акрилом. Любая длина и форма — миндаль, балерина, квадрат.', ua: 'Нарощування гелем або акрилом. Будь-яка довжина та форма.', en: 'Gel or acrylic extensions. Any length and shape — almond, ballerina, square.', pl: 'Przedłużanie żelem lub akrylem. Dowolna długość i kształt.' },
  design: { ru: 'Дизайн ногтей: стразы, фольга, градиент, ручная роспись, стемпинг.', ua: 'Дизайн нігтів: стрази, фольга, градієнт, ручний розпис.', en: 'Nail art: rhinestones, foil, gradient, hand painting, stamping.', pl: 'Dizajn paznokci: cyrkonie, folia, gradient, malowanie ręczne.' },
  combo: { ru: 'Маникюр + педикюр в одном визите. Экономьте время и деньги.', ua: 'Манікюр + педикюр за один візит. Економте час та гроші.', en: 'Manicure + pedicure in one visit. Save time and money.', pl: 'Manicure + pedicure w jednej wizycie. Oszczędź czas i pieniądze.' },
};

function buildSvc(spec, photosBySvc) {
  return spec.map((s, i) => ({
    id: s.id, e: s.e, dur: s.dur, price: s.price, active: true, order: i,
    names: { ru: L.ru['svc_' + s.id], ua: L.ua['svc_' + s.id], en: L.en['svc_' + s.id], pl: L.pl['svc_' + s.id] },
    desc: DESC[s.id] || { ru: null, ua: null, en: null, pl: null },
    photos: photosBySvc[s.id] || [],
  }));
}

const SALON1 = {
  name: 'Nails Studio',
  svc: [
    { id: 'classic', e: '💅', dur: 60, price: 80 }, { id: 'gel', e: '💎', dur: 90, price: 140 },
    { id: 'pedi', e: '🦶', dur: 90, price: 120 }, { id: 'ext', e: '✨', dur: 120, price: 250 },
    { id: 'design', e: '🎨', dur: 30, price: 50 }, { id: 'combo', e: '👑', dur: 150, price: 220 },
  ],
  photos: {
    classic: ['https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600', 'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600'],
    gel: ['https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600', 'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600'],
    pedi: ['https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600', 'https://images.pexels.com/photos/9789207/pexels-photo-9789207.jpeg?w=600'],
    ext: ['https://images.pexels.com/photos/939836/pexels-photo-939836.jpeg?w=600'],
    design: ['https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600'],
    combo: ['https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600', 'https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600'],
  },
  aboutPhotos: ['https://images.pexels.com/photos/7750099/pexels-photo-7750099.jpeg?w=600', 'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600'],
  aboutDesc: 'Салон Nails Studio — уютное место в центре. Классический маникюр, гель-лак, педикюр, наращивание и дизайн. Работаем по записи.',
};

const SALON2 = {
  name: 'Luxe Manicure',
  svc: [
    { id: 'classic', e: '💅', dur: 60, price: 100 }, { id: 'gel', e: '💎', dur: 90, price: 180 },
    { id: 'pedi', e: '🦶', dur: 90, price: 150 }, { id: 'ext', e: '✨', dur: 120, price: 300 },
    { id: 'design', e: '🎨', dur: 30, price: 70 }, { id: 'combo', e: '👑', dur: 150, price: 280 },
  ],
  photos: {
    classic: ['https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600', 'https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600'],
    gel: ['https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600', 'https://images.pexels.com/photos/4963822/pexels-photo-4963822.jpeg?w=600'],
    pedi: ['https://images.pexels.com/photos/4155017/pexels-photo-4155017.jpeg?w=600', 'https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600'],
    ext: ['https://images.pexels.com/photos/3738375/pexels-photo-3738375.jpeg?w=600', 'https://images.pexels.com/photos/7320686/pexels-photo-7320686.jpeg?w=600'],
    design: ['https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600'],
    combo: ['https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600', 'https://images.pexels.com/photos/4155017/pexels-photo-4155017.jpeg?w=600'],
  },
  aboutPhotos: ['https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600', 'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600', 'https://images.pexels.com/photos/7750099/pexels-photo-7750099.jpeg?w=600'],
  aboutDesc: 'Luxe Manicure — премиум уход за ногтями. Премиальные материалы и индивидуальный подход. Запись через бота.',
};

async function resolveUsernameToChatId(botToken, username) {
  const u = username.replace(/^@/, '');
  const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=@${u}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok || !data.result?.id) return null;
  return data.result.id;
}

export async function runSeed(ctx, env, masterUsername = 'dezbringer') {
  if (!ctx?.db) return { ok: false, error: 'DB not bound' };
  const encKey = env.BOT_ENCRYPTION_KEY || null;
  const log = [];

  let tenantIds = await listTenantIds(ctx);
  if (tenantIds.length < 2) {
    const names = [SALON1.name, SALON2.name];
    for (let i = tenantIds.length; i < 2; i++) {
      const out = await createTenant(ctx, names[i], env);
      if (out.ok) {
        tenantIds.push(out.tenantId);
        log.push(`Created tenant: ${out.tenantId} (${out.name})`);
      }
    }
  }
  if (tenantIds.length < 2) {
    return { ok: false, error: 'Need at least 2 tenants', log };
  }

  const t1 = tenantIds[0];
  const t2 = tenantIds[1];

  const tenant1 = await getTenant(ctx, t1);
  const tenant2 = await getTenant(ctx, t2);
  if (tenant1) { tenant1.name = SALON1.name; tenant1.updatedAt = nowSec(); await putTenant(ctx, t1, tenant1); }
  if (tenant2) { tenant2.name = SALON2.name; tenant2.updatedAt = nowSec(); await putTenant(ctx, t2, tenant2); }
  log.push(`Tenant names set: ${SALON1.name}, ${SALON2.name}`);

  const svcList1 = [...buildSvc(SALON1.svc, SALON1.photos), CORRECTION_SVC];
  const svcList2 = [...buildSvc(SALON2.svc, SALON2.photos), CORRECTION_SVC];

  const tenantCtx = (tenantId) => ({ ...ctx, tenantId, prefix: `t:${tenantId}:` });
  const ctx1 = tenantCtx(t1);
  const ctx2 = tenantCtx(t2);

  await saveServices(ctx1, svcList1);
  await saveServices(ctx2, svcList2);
  log.push(`Seeded services for ${t1} and ${t2}`);

  await dbRun(ctx, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_photos', ?)", t1, JSON.stringify(SALON1.aboutPhotos));
  await dbRun(ctx, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_photos', ?)", t2, JSON.stringify(SALON2.aboutPhotos));
  await dbRun(ctx, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_desc', ?)", t1, JSON.stringify(SALON1.aboutDesc));
  await dbRun(ctx, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'about_desc', ?)", t2, JSON.stringify(SALON2.aboutDesc));
  log.push('Seeded about_photos and about_desc');

  let masterChatId = null;
  for (const tid of tenantIds) {
    const botIds = await getBotIdsByTenantId(ctx, tid);
    if (botIds.length) {
      const token = await getBotToken(ctx, botIds[0], encKey);
      if (token) {
        masterChatId = await resolveUsernameToChatId(token, masterUsername);
        if (masterChatId) break;
      }
    }
  }
  if (!masterChatId) {
    return {
      ok: true, log, tenants: [t1, t2], masterAssigned: false,
      hint: `Could not resolve @${masterUsername} to chatId. Add master in bot: /grant_master @${masterUsername}`,
    };
  }

  for (const tid of [t1, t2]) {
    const tCtx = tenantCtx(tid);
    await setTenantRole(tCtx, masterChatId, ROLES.MASTER);
    await saveMaster(tCtx, masterChatId, { name: masterUsername, tgUsername: masterUsername, onVacation: false });
    await setTenantRole(tCtx, masterChatId, ROLES.TENANT_OWNER);
    await dbRun(ctx, "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'admin', ?)", tid, JSON.stringify(masterChatId));
  }
  log.push(`@${masterUsername} (${masterChatId}) set as master and owner for ${t1} and ${t2}`);

  // Make demo salons publicly visible — include gallery photos
  try {
    const s1Photos = [...SALON1.aboutPhotos, ...Object.values(SALON1.photos).flat().slice(0, 4)];
    const s2Photos = [...SALON2.aboutPhotos, ...Object.values(SALON2.photos).flat().slice(0, 4)];
    const s1Search = ('nails studio варшава ' + SALON1.aboutDesc).toLowerCase();
    const s2Search = ('luxe manicure варшава ' + SALON2.aboutDesc).toLowerCase();
    await dbRun(ctx, `UPDATE tenants SET slug = 'nails-studio', city = 'Варшава', description = ?, public_active = 1, photos = ?, search_text = ? WHERE name = ?`,
      SALON1.aboutDesc, JSON.stringify(s1Photos), s1Search, SALON1.name);
    await dbRun(ctx, `UPDATE tenants SET slug = 'luxe-manicure', city = 'Варшава', description = ?, public_active = 1, photos = ?, search_text = ? WHERE name = ?`,
      SALON2.aboutDesc, JSON.stringify(s2Photos), s2Search, SALON2.name);
  } catch(e) {
    console.warn('[seed] Could not set public profile fields:', e?.message);
  }

  return { ok: true, log, tenants: [t1, t2], masterAssigned: true, masterChatId, masterUsername: '@' + masterUsername };
}
