/**
 * Preview-landing tenant provisioner.
 *
 * Creates a dedicated demo tenant (`t_preview_landing`, slug `preview-landing`)
 * used by the iPhone mockup on the marketing landing page. Unlike the demo bots
 * in `http/demoBots.js`, this tenant has NO Telegram bot — it is reachable only
 * through the web channel (`/chat/init`, `/chat/send`, `/chat/poll`).
 *
 * The tenant is tagged with `tenant_config.preview_mode = '1'`; the rest of the
 * Worker reads that flag (via `ctx.previewMode`, set in
 * `channels/resolver.js::buildChannelCtx`) to short-circuit destructive writes
 * and apply an AI off-topic guardrail. See `LANDING_DEMO_INTEGRATION.md`.
 *
 * Idempotent: safe to call on every request; an in-memory flag skips the work
 * after the first successful provision. A second guarded check also verifies
 * that services/masters rows are present before returning early, so edits made
 * in prod D1 don't silently re-seed.
 */
import { nowSec, msToSec } from '../utils/time.js';
import { getTenant, putTenant } from './storage.js';
import { envCtx } from '../http/envCtx.js';
import { log } from '../utils/logger.js';

export const PREVIEW_TENANT_ID = 't_preview_landing';
export const PREVIEW_TENANT_SLUG = 'preview-landing';

// Synthetic chat IDs for demo masters; well above real Telegram IDs (<1e10).
const PREVIEW_MASTER_ALINA_CID = 10_000_000_001;
const PREVIEW_MASTER_VIKA_CID = 10_000_000_002;

const PREVIEW_SERVICES = [
  { svcId: 'classic',  names: { ru: 'Классический маникюр', ua: 'Класичний манікюр', en: 'Classic manicure', pl: 'Manicure klasyczny' }, duration: 60, price: 45,  emoji: '💅', sortOrder: 1,
    photos: ['https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600', 'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600'] },
  { svcId: 'gel',      names: { ru: 'Гель-лак',              ua: 'Гель-лак',          en: 'Gel polish',       pl: 'Manicure hybrydowy' },  duration: 90, price: 80,  emoji: '✨', sortOrder: 2,
    photos: ['https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600', 'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600'] },
  { svcId: 'pedi',     names: { ru: 'Педикюр',               ua: 'Педикюр',           en: 'Pedicure',         pl: 'Pedicure' },            duration: 75, price: 120, emoji: '🦶', sortOrder: 3,
    photos: ['https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600', 'https://images.pexels.com/photos/9789207/pexels-photo-9789207.jpeg?w=600'] },
  { svcId: 'design',   names: { ru: 'Авторский дизайн',      ua: 'Авторський дизайн', en: 'Custom nail art',  pl: 'Zdobienia autorskie' }, duration: 30, price: 30,  emoji: '🎨', sortOrder: 4,
    photos: ['https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600'] },
];

const PREVIEW_MASTERS = [
  { chatId: PREVIEW_MASTER_ALINA_CID, name: 'Алина',    bio: 'Мастер классического и аппаратного маникюра.', photo: 'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?auto=compress&cs=tinysrgb&w=400' },
  { chatId: PREVIEW_MASTER_VIKA_CID,  name: 'Виктория', bio: 'Специалист по гель-лаку и авторскому дизайну.', photo: 'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?auto=compress&cs=tinysrgb&w=400' },
];

const PREVIEW_PHOTOS = [
  'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?auto=compress&cs=tinysrgb&w=400',
  'https://images.pexels.com/photos/3997390/pexels-photo-3997390.jpeg?auto=compress&cs=tinysrgb&w=400',
  'https://images.pexels.com/photos/4046316/pexels-photo-4046316.jpeg?auto=compress&cs=tinysrgb&w=400',
];

let _previewProvisioned = false;

/**
 * Provision the preview-landing tenant if it is missing.
 * Safe to call repeatedly — in-memory flag + presence checks keep it idempotent.
 *
 * @param {object} env Worker env bindings
 */
export async function ensurePreviewTenantProvisioned(env) {
  if (_previewProvisioned) return;
  const ec = envCtx(env);
  if (!ec.db) return;

  const existing = await getTenant(ec, PREVIEW_TENANT_ID);
  if (existing && existing.slug === PREVIEW_TENANT_SLUG && existing.publicActive) {
    // Tenant row is fine; do the cheap checks on services/masters/config too.
    const { dbGet } = await import('../utils/db.js');
    const [svcRow, masterRow, cfgRow, svcNoPhotos] = await Promise.all([
      dbGet(ec, 'SELECT COUNT(*) as n FROM services WHERE tenant_id = ?', PREVIEW_TENANT_ID),
      dbGet(ec, 'SELECT COUNT(*) as n FROM masters  WHERE tenant_id = ?', PREVIEW_TENANT_ID),
      dbGet(ec, "SELECT value FROM tenant_config WHERE tenant_id = ? AND key = 'preview_mode'", PREVIEW_TENANT_ID),
      dbGet(ec, "SELECT COUNT(*) as n FROM services WHERE tenant_id = ? AND (photos IS NULL OR photos = '[]')", PREVIEW_TENANT_ID),
    ]);
    if ((svcRow?.n || 0) >= PREVIEW_SERVICES.length &&
        (masterRow?.n || 0) >= PREVIEW_MASTERS.length &&
        cfgRow?.value === '1' &&
        (svcNoPhotos?.n || 0) === 0) {
      _previewProvisioned = true;
      return;
    }
  }

  log.info('tenant.preview', { message: 'provisioning preview tenant', tenantId: PREVIEW_TENANT_ID });
  const { dbRun } = await import('../utils/db.js');
  const now = nowSec();
  const TRIAL_SEC = msToSec(7 * 24 * 3600 * 1000);

  const tenantName = 'Manic Bot';
  await putTenant(ec, PREVIEW_TENANT_ID, {
    id: PREVIEW_TENANT_ID,
    name: tenantName,
    active: true,
    createdAt: now,
    updatedAt: now,
    salon: {
      name: tenantName,
      address: 'ul. Demo 1, Warszawa',
      phone: '+48 22 000 00 00',
      timezone: 'Europe/Warsaw',
      workHours: { from: 10, to: 20 },
      currency: 'PLN',
    },
    photos: PREVIEW_PHOTOS,
    aboutPhotos: PREVIEW_PHOTOS,
    logo: 'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?auto=compress&cs=tinysrgb&w=200',
    coverPhoto: 'https://images.pexels.com/photos/3997390/pexels-photo-3997390.jpeg?auto=compress&cs=tinysrgb&w=800',
    slug: PREVIEW_TENANT_SLUG,
    city: 'Warszawa',
    description: 'Демо-салон для посетителей лендинга. Можно потрогать запись, прайс и каталог — реальные данные не сохраняются.',
    publicActive: true,
    searchText: `${tenantName} warszawa preview demo`.toLowerCase(),
    plan: 'pro',
    billingStatus: 'trialing',
    subscriptionStatus: null,
    trialEndsAt: now + TRIAL_SEC,
    graceEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    billingEmail: null,
    cancelAtPeriodEnd: false,
  });

  // `is_test` is not part of the default `putTenant` payload (legacy columns),
  // so set it explicitly. Mirrors what `seed:test-accounts` does for the QA roster.
  await dbRun(
    ec,
    'UPDATE tenants SET is_test = ? WHERE id = ?',
    1, PREVIEW_TENANT_ID,
  ).catch(e => log.error('tenant.preview', e instanceof Error ? e : new Error(String(e.message)), { action: 'is_test_flag' }));

  // Preview-mode flag: consumed by channels/resolver.js::buildChannelCtx.
  await dbRun(
    ec,
    "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'preview_mode', '1')",
    PREVIEW_TENANT_ID,
  );

  for (const s of PREVIEW_SERVICES) {
    await dbRun(
      ec,
      `INSERT OR IGNORE INTO services
         (tenant_id, svc_id, emoji, duration, price, active, hidden, sort_order, names, photos)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
      PREVIEW_TENANT_ID, s.svcId, s.emoji, s.duration, s.price, s.sortOrder,
      JSON.stringify(s.names), JSON.stringify(s.photos || []),
    );
  }

  // Backfill photos on rows that were already inserted without them.
  for (const s of PREVIEW_SERVICES) {
    if (s.photos?.length) {
      await dbRun(
        ec,
        "UPDATE services SET photos = ? WHERE tenant_id = ? AND svc_id = ? AND (photos IS NULL OR photos = '[]')",
        JSON.stringify(s.photos), PREVIEW_TENANT_ID, s.svcId,
      );
    }
  }

  for (const m of PREVIEW_MASTERS) {
    await dbRun(
      ec,
      `INSERT OR IGNORE INTO masters
         (tenant_id, chat_id, name, active, added_at, bio, photo, allow_delegation)
       VALUES (?, ?, ?, 1, ?, ?, ?, 0)`,
      PREVIEW_TENANT_ID, m.chatId, m.name, now, m.bio, m.photo,
    );
  }

  _previewProvisioned = true;
  log.info('tenant.preview', { message: 'preview tenant ready', slug: PREVIEW_TENANT_SLUG });
}
