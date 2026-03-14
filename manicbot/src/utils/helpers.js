import { L } from '../i18n.js';
import { VALID_LANGS } from '../config.js';

export function t(lang, key) { return L[lang]?.[key] ?? L.ru[key] ?? key; }
export function p2(n) { return String(n).padStart(2, '0'); }

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function isCorrectionSvc(svcId) { return svcId === 'correction'; }

export function svcName(ctx, lang, id) {
  const s = ctx.svc.find(x => x.id === id);
  if (!s) return escHtml(id);
  return `${s.e} ${t(lang, 'svc_' + id)}`;
}

export function fill(str, vars) {
  let r = typeof str === 'string' ? str : str.join('\n');
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, v);
  return r;
}

export function detectLang(code) {
  if (!code) return null;
  const c = code.toLowerCase().slice(0, 2);
  if (c === 'uk') return 'ua';
  if (VALID_LANGS.has(c)) return c;
  return null;
}

export function isValidChatId(id) {
  return typeof id === 'number' && Number.isFinite(id) && id !== 0;
}
