// ══════════════════════════════════════════════════════════════
// Shared constants (used by worker and modules)
// ══════════════════════════════════════════════════════════════

export const MAX_APTS = 10;
export const API_TIMEOUT_MS = 10000;
export const VALID_LANGS = new Set(['ru', 'ua', 'en', 'pl']);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;

export const CB = {
  NOOP: '_',
  MAIN: 'main',
  BOOK: 'book',
  MY: 'my',
  PRICES: 'prices',
  CONTACTS: 'cont',
  REVIEWS: 'rev',
  ABOUT: 'about',
  CATALOG: 'cat',
  CAL_BACK: 'bcal',
  CONFIRM: 'ok',
  CANCEL_BOOK: 'no',
  LANG: 'lang',
  LANG_SET: 'sl:',
  REG_YES: 'rg:y',
  REG_CHANGE: 'rg:c',
  SERVICE: 'sv:',
  CAL_MONTH: 'cm:',
  DATE: 'dt:',
  TIME: 'tm:',
  CANCEL_APT: 'cx:',
  CAT_PHOTO: 'cc:',
};

/** Default tenant config (single-tenant legacy). Moved to KV per tenant in multi-tenant. */
export const DEFAULT_TENANT_CONFIG = {
  timezone: 'Europe/Warsaw',
  salonName: 'ManicBot 💅',
  address: 'ul. Marszałkowska 27, Warszawa',
  phone: '+48 22 123 45 67',
  workHours: { from: 9, to: 19 },
  services: [
    { id: 'classic', e: '💅', dur: 60, price: 80 },
    { id: 'gel', e: '💎', dur: 90, price: 140 },
    { id: 'pedi', e: '🦶', dur: 90, price: 120 },
    { id: 'ext', e: '✨', dur: 120, price: 250 },
    { id: 'design', e: '🎨', dur: 30, price: 50 },
    { id: 'combo', e: '👑', dur: 150, price: 220 },
  ],
  photos: {
    classic: [
      'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
      'https://images.pexels.com/photos/3997391/pexels-photo-3997391.jpeg?w=600',
      'https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600',
    ],
    gel: [
      'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600',
      'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600',
      'https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600',
    ],
    pedi: [
      'https://images.pexels.com/photos/1204464/pexels-photo-1204464.jpeg?w=600',
      'https://images.pexels.com/photos/5765783/pexels-photo-5765783.jpeg?w=600',
    ],
    ext: [
      'https://images.pexels.com/photos/939836/pexels-photo-939836.jpeg?w=600',
      'https://images.pexels.com/photos/1115128/pexels-photo-1115128.jpeg?w=600',
    ],
    design: [
      'https://images.pexels.com/photos/1484808/pexels-photo-1484808.jpeg?w=600',
      'https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600',
    ],
    combo: [
      'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
      'https://images.pexels.com/photos/1204464/pexels-photo-1204464.jpeg?w=600',
    ],
  },
};

export const DEFAULT_TENANT_ID = 'default';
