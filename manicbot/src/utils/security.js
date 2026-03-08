export function timingSafeEqual(a, b) {
  const ta = new TextEncoder().encode(a);
  const tb = new TextEncoder().encode(b);
  if (ta.length !== tb.length) {
    crypto.subtle.timingSafeEqual(ta, ta);
    return false;
  }
  return crypto.subtle.timingSafeEqual(ta, tb);
}

export function checkAdmin(request, adminKey) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    return timingSafeEqual(decoded.slice(idx + 1), adminKey);
  } catch { return false; }
}

const ALGO = 'AES-GCM';
const IV_LEN = 12;
const TAG_LEN = 128;

export async function encryptToken(plain, keyStr) {
  if (!keyStr || keyStr.length < 32) return null;
  const keyBytes = new TextEncoder().encode(keyStr.slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyBytes, ALGO, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const enc = await crypto.subtle.encrypt(
    { name: ALGO, iv, tagLength: TAG_LEN },
    key,
    new TextEncoder().encode(plain),
  );
  const buf = new Uint8Array(iv.length + enc.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...buf));
}

export async function decryptToken(encryptedB64, keyStr) {
  if (!keyStr || keyStr.length < 32) return null;
  try {
    const keyBytes = new TextEncoder().encode(keyStr.slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyBytes, ALGO, false, ['decrypt']);
    const buf = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const iv = buf.slice(0, IV_LEN);
    const data = buf.slice(IV_LEN);
    const dec = await crypto.subtle.decrypt(
      { name: ALGO, iv, tagLength: TAG_LEN },
      key,
      data,
    );
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}

export function randomId(byteLength = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteLength)), b => b.toString(36)).join('').slice(0, byteLength * 2);
}
