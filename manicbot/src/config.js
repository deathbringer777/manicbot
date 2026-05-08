// ══════════════════════════════════════════════════════════════
// ManicBot — Configuration & Constants
// ══════════════════════════════════════════════════════════════

export const MAX_APTS = 10;
export const API_TIMEOUT_MS = 10000;
export const VALID_LANGS = new Set(['ru', 'ua', 'en', 'pl']);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;

export const CB = {
  NOOP:        '_',
  MAIN:        'main',
  CLIENT_VIEW: 'cv',    // Switch to client view (admin/master → see salon as a client)
  BOOK:      'book',
  MY:        'my',
  PRICES:    'prices',
  CONTACTS:  'cont',
  REVIEWS:   'rev',
  ABOUT:     'about',
  CATALOG:   'cat',
  CAL_BACK:  'bcal',
  CONFIRM:   'ok',
  CANCEL_BOOK: 'no',
  /** While adjusting booking after declining confirmation — show service catalog */
  BOOK_PICK_SVC: 'bpsvc',
  LANG:      'lang',
  LANG_SET:  'sl:',
  REG_YES:   'rg:y',
  REG_CHANGE:'rg:c',
  SERVICE:   'sv:',
  CAL_MONTH: 'cm:',
  DATE:      'dt:',
  TIME:      'tm:',
  CANCEL_APT:'cx:',
  CANCEL_APT_YES:'cxy:',
  CANCEL_APT_SKIP:'cxs:',
  CANCEL_ALL:    'cxa',
  CANCEL_ALL_YES: 'cxay',
  CAT_PHOTO: 'cc:',
  ABOUT_PHOTO: 'abph:',
  ADM_MAIN:    'adm',
  ADM_TODAY:   'adm:td',
  ADM_TOMORROW:'adm:tm',
  ADM_MASTERS: 'adm:ms',
  ADM_ADD_M:   'adm:am',
  ADM_DEL_M:   'adm:dm:',
  ADM_VACATION:'adm:vac:',
  ADM_SETTINGS:'adm:st',
  ADM_CLIENTS: 'adm:cl',
  ADM_CLIENTS_PAGE: 'adm:clp:',
  MST_MAIN:    'mst',
  MST_TODAY:   'mst:td',
  MST_TOMORROW:'mst:tm',
  APT_CONFIRM:     'ac:',
  APT_REJECT:      'ar:',
  APT_REJECT_SKIP: 'ars:',
  APT_COUNTER:     'ao:',
  APT_COUNTER_SKIP:'aos:',
  APT_ACCEPT:      'aa:',
  APT_DECLINE:     'adl:',
  APT_REPLY:       'arl:',
  ADM_BLOCK:       'abk:',
  ADM_UNBLOCK:     'aub:',
  ADM_CANCEL_APT:  'aca:',
  ADM_CANCEL_SKIP: 'acs:',
  ADM_CANCEL_ALL:  'admcxa',
  ADM_CANCEL_ALL_YES: 'admcxay',
  ADM_ABOUT: 'adm:about',
  ADM_ABOUT_PHOTOS: 'adm:abph',
  ADM_ABOUT_PHOTO_ADD: 'adm:abpha',
  ADM_ABOUT_PHOTO_DEL: 'adm:abphd:',
  ADM_ABOUT_DESC: 'adm:abdesc',
  ADM_ABOUT_INSTAGRAM: 'adm:abig',
  /** Instagram / WhatsApp — открыть подсказку и Mini App (вкладка Channels) */
  ADM_META_CHANNELS: 'adm:meta',
  SVC_LIST:     'svl',
  SVC_EDIT:     'sve:',
  SVC_NAME:     'svn:',
  SVC_PRICE:    'svp:',
  SVC_DUR:      'svd:',
  SVC_DESC:     'svds:',
  SVC_EMOJI:    'svem:',
  SVC_TOGGLE:   'svt:',
  SVC_DEL:      'svdl:',
  SVC_ADD:      'sva',
  SVC_PHOTOS:   'svph:',
  SVC_PHOTO_DEL:'svpd:',
  SVC_PHOTO_ADD:'svpa:',
  CONSULT_REQ:  'consult_req',
  SUPPORT:      'support',
  TECH_SUPPORT_REQ: 'tech_req',
  TICKET_TAKE:  'tk:',
  TICKET_DECLINE:'td:',
  TICKET_CLOSE: 'tkc:',
  TICKET_FREE_CORRECTION: 'tfc:',
  ADM_BILLING:  'adm:bill',
  BILLING_SUBSCRIBE: 'bill:sub:',
  BILLING_PORTAL:    'bill:portal',
  BILLING_BACK:      'bill:back',
  // Platform (system_admin) panel
  SYSADM_MAIN:        'sysadm',
  SYSADM_TENANTS:     'sysadm:ten',
  SYSADM_NEW_TENANT:  'sysadm:nt',
  SYSADM_BOT_NEW:     'sysadm:bn',
  SYSADM_SUPPORT_LIST:'sysadm:sup',
  SYSADM_TENANT_INFO: 'sysadm:ti:',
  SYSADM_BACK:        'sysadm:back',
  SYSADM_LINKS:       'sysadm:links',
  SYSADM_SUPPORT_ADD: 'sysadm:supadd',
  SYSADM_SUPPORT_REMOVE: 'sysadm:suprm:',
  SYSADM_GRANT_ROLE: 'sysadm:grant',
  SYSADM_GRANT_MASTER: 'sysadm:gm',
  SYSADM_GRANT_OWNER: 'sysadm:go',
  SYSADM_BOT_NEW_FOR: 'sysadm:bnf:',
  // Technical support (platform-level)
  SYSADM_TECH_SUPPORT_LIST:   'sysadm:tsl',
  SYSADM_TECH_SUPPORT_ADD:    'sysadm:tsadd',
  SYSADM_TECH_SUPPORT_REMOVE: 'sysadm:tsrm:',
  // Tenant support agents (managed by tenant admin)
  ADM_SUPPORT_LIST:   'adm:sul',
  ADM_SUPPORT_ADD:    'adm:suadd',
  ADM_SUPPORT_REMOVE: 'adm:surm:',
  // Salon settings editing
  ADM_SETTINGS_NAME: 'adm:stn',
  ADM_SETTINGS_PHONE: 'adm:stp',
  ADM_SETTINGS_ADDR: 'adm:sta',
  ADM_SETTINGS_HOURS: 'adm:sth',
  ADM_CALENDAR:      'adm:gcal',
  ADM_CALENDAR_CLEAR:'adm:gcalclr',
  ADM_CALENDAR_RESYNC:'adm:gcalsync',
  // Google Calendar (master)
  MST_CALENDAR:       'mst:cal',
  MST_CALENDAR_SET:   'mst:calset',
  MST_CALENDAR_CLEAR: 'mst:calclr',
  MST_CALENDAR_RESYNC:'mst:calsync',
  // Master selection during booking
  MASTER_ANY:  'ma',       // client picks "any available master"
  MASTER_SEL:  'ms:',      // client picks specific master: ms:{chatId}
  // Instagram pagination (>13-button limit)
  SVC_PAGE:    'svpg:',    // service list page nav (Instagram): svpg:{pageNum}
  MASTER_PAGE: 'mspg:',    // master list page nav (Instagram): mspg:{pageNum}
  // Admin assigns master to unassigned appointment
  ADM_ASSIGN_M: 'adm:asm:', // show master list for apt: adm:asm:{aptId}
  ADM_SET_M:    'adm:stm:', // set master for apt: adm:stm:{aptId}:{masterId}
  // Admin all-appointments view with master filter
  ADM_ALL_APTS:   'adm:aa',   // all appointments (no filter)
  ADM_ALL_APTS_M: 'adm:aam:', // filtered by master: adm:aam:{masterId}
  ADM_RENAME_M:   'adm:rnm:', // rename master: adm:rnm:{chatId}
};

export const STEP = {
  REG_CONFIRM:         'rc',
  REG_NAME:            'rn',
  REG_PHONE:           'rp',
  DATE:                'date',
  TIME:                'time',
  CONFIRM:             'conf',
  /** Declined confirmation screen; date/time/master kept for correction */
  BOOK_ADJUST:         'badj',
  CLIENT_CANCEL_COMMENT: 'client_cancel_comment',
  ADD_MASTER:          'add_master',
  REJECT_COMMENT:      'reject_comment',
  COUNTER_TIME:        'counter_time',
  COUNTER_COMMENT:     'counter_comment',
  ADMIN_CANCEL_REASON: 'admin_cancel_reason',
  CLIENT_REPLY:        'client_reply',
  EDIT_SVC_NAME:       'edit_svc_name',
  EDIT_SVC_PRICE:      'edit_svc_price',
  EDIT_SVC_DUR:        'edit_svc_dur',
  EDIT_SVC_DESC:       'edit_svc_desc',
  EDIT_SVC_EMOJI:      'edit_svc_emoji',
  ADD_SVC_ID:          'add_svc_id',
  ADD_SVC_PHOTO:       'add_svc_photo',
  ADD_ABOUT_PHOTO:     'add_about_photo',
  EDIT_ABOUT_DESC:     'edit_about_desc',
  EDIT_ABOUT_INSTAGRAM:'edit_about_instagram',
  MASTER_PICK:         'master_pick',   // booking step: choose master
  SUPPORT_MSG:         'support_msg',
  TECH_SUPPORT_MSG:    'tech_support_msg',
  // Platform admin flows
  SYSADM_NEW_TENANT:       'sysadm_new_tenant',
  SYSADM_NEW_BOT:          'sysadm_new_bot',
  SYSADM_GRANT_INPUT:      'sysadm_grant_input',
  SYSADM_NEW_BOT_TENANT:   'sysadm_new_bot_tenant',
  SYSADM_ADD_SUPPORT:      'sysadm_add_support',
  SYSADM_ADD_TECH_SUPPORT: 'sysadm_add_tech_support',
  // Tenant support flows
  ADM_ADD_TENANT_SUPPORT:  'adm_add_tenant_support',
  // Salon settings editing steps
  EDIT_SALON_NAME:      'edit_salon_name',
  EDIT_SALON_PHONE:     'edit_salon_phone',
  EDIT_SALON_ADDR:      'edit_salon_addr',
  EDIT_SALON_HOURS_FROM:'edit_salon_hours_from',
  // Google Calendar
  SET_CALENDAR_ID:      'set_calendar_id',
  RENAME_MASTER:        'rename_master',
};

export const TIMEZONE = 'Europe/Warsaw';
export const SALON = 'ManicBot 💅';
export const ADDRESS = 'ul. Marszałkowska 27, Warszawa';
export const MAPS_URL = 'https://maps.app.goo.gl/qabutZZG1sEmnwcX7';
export const INSTAGRAM_URL = 'https://instagram.com/';
export const PHONE = '+48 22 123 45 67';
export const WORK = { from: 9, to: 19 };
export const HOURS_STR = `${WORK.from}:00 — ${WORK.to}:00`;
export const STATE_TTL_SEC = 7200;
export const LOCK_TTL_SEC = 30;
export const CLEANUP_AFTER_MS = 48 * 3600000;
export const RATE_LIMIT_MAX = 100;
export const RATE_LIMIT_WINDOW_SEC = 60;
export const CHAT_HISTORY_MAX = 8;
export const CHAT_HISTORY_TTL = 3600;
export const HUMAN_REQ_THRESHOLD = 1;

export const DEFAULT_SVC = [
  { id: 'classic',  e: '💅', dur: 60,  price: 80   },
  { id: 'gel',      e: '💎', dur: 90,  price: 140  },
  { id: 'pedi',     e: '🦶', dur: 90,  price: 120  },
  { id: 'ext',      e: '✨', dur: 120, price: 250  },
  { id: 'design',   e: '🎨', dur: 30,  price: 50   },
  { id: 'combo',    e: '👑', dur: 150, price: 220  },
];

export const DEFAULT_PHOTOS = {
  classic: [
    'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
    'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600',
    'https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600',
  ],
  gel: [
    'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600',
    'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600',
    'https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600',
  ],
  pedi: [
    'https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600',
    'https://images.pexels.com/photos/9789207/pexels-photo-9789207.jpeg?w=600',
    'https://images.pexels.com/photos/4155017/pexels-photo-4155017.jpeg?w=600',
  ],
  ext: [
    'https://images.pexels.com/photos/939836/pexels-photo-939836.jpeg?w=600',
    'https://images.pexels.com/photos/3738375/pexels-photo-3738375.jpeg?w=600',
    'https://images.pexels.com/photos/7320686/pexels-photo-7320686.jpeg?w=600',
  ],
  design: [
    'https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600',
    'https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600',
    'https://images.pexels.com/photos/4963822/pexels-photo-4963822.jpeg?w=600',
  ],
  combo: [
    'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
    'https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600',
  ],
};

export const DEFAULT_ABOUT_PHOTOS = [
  'https://images.pexels.com/photos/7750099/pexels-photo-7750099.jpeg?w=600',
  'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600',
  'https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600',
];

export const CORRECTION_SVC = {
  id: 'correction', e: '🔧', dur: 30, price: 0, active: true, hidden: true, order: 999,
  names: { ru: 'Исправление', ua: 'Виправлення', en: 'Correction', pl: 'Korekta' },
  desc: { ru: null, ua: null, en: null, pl: null },
  photos: [],
};

export const AI_MODEL = '@cf/openai/gpt-oss-120b';
export const AI_MODEL_FALLBACK = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const AI_MODEL_FALLBACK2 = '@cf/meta/llama-3.1-8b-instruct';
export const AI_MAX_TOKENS = 280;
export const LANG_HINT = { ru: 'русском', ua: 'українській', en: 'English', pl: 'polsku' };

export const BROKEN_ABOUT_PHOTO_ID = '33412989';
export const FALLBACK_ABOUT_PHOTO = 'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600';

export function buildCtx(env) {
  if (!env.BOT_TOKEN) throw new Error('Missing secret: BOT_TOKEN');
  if (!env.ADMIN_KEY) throw new Error('Missing secret: ADMIN_KEY');
  if (!env.WEBHOOK_SECRET) throw new Error('Missing secret: WEBHOOK_SECRET');
  const botId = env.BOT_TOKEN.split(':')[0];
  return {
    ...env,
    TG: `https://api.telegram.org/bot${env.BOT_TOKEN}`,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    db: env.DB || null,
    tenantId: null,
    tenant: null,
    bot: { botId, botToken: env.BOT_TOKEN, webhookSecret: env.WEBHOOK_SECRET },
    adminChatId: env.ADMIN_CHAT_ID || null,
    ADMIN_CHAT_ID: env.ADMIN_CHAT_ID || null,
    prefix: `b:${botId}:`,
    channel: null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    BOT_ENCRYPTION_KEY: env.BOT_ENCRYPTION_KEY || null,
    BOT_ENCRYPTION_KEY_OLD: env.BOT_ENCRYPTION_KEY_OLD || null,
    GOOGLE_SERVICE_ACCOUNT_KEY: env.GOOGLE_SERVICE_ACCOUNT_KEY || null,
    GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID || null,
    GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET || null,
    GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI || null,
    GOOGLE_TOKEN_ENCRYPTION_KEY: env.GOOGLE_TOKEN_ENCRYPTION_KEY || null,
    APP_BASE_URL: env.APP_BASE_URL || null,
    baseUrl: env.APP_BASE_URL || null,
    ADMIN_APP_URL: env.ADMIN_APP_URL || null,
  };
}
