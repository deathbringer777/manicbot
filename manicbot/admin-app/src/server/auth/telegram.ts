import { env } from "~/env";

function hexToBytes32(hex: string): Uint8Array | null {
  const h = hex.trim().toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]{64}$/.test(h)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

export async function validateWebAppData(telegramInitData: string): Promise<{ user: TelegramUser | null; valid: boolean }> {
  if (!telegramInitData) return { user: null, valid: false };
  
  try {
    const initData = new URLSearchParams(telegramInitData);
    const hash = initData.get("hash");
    if (!hash) return { user: null, valid: false };
    
    initData.delete("hash");
    
    const keys = Array.from(initData.keys());
    keys.sort();
    const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join("\n");
    
    const encoder = new TextEncoder();
    
    const webAppDataKey = await crypto.subtle.importKey(
      "raw", 
      encoder.encode("WebAppData"), 
      { name: "HMAC", hash: "SHA-256" }, 
      false, 
      ["sign"]
    );
    
    const secretKeyBuf = await crypto.subtle.sign(
      "HMAC", 
      webAppDataKey, 
      encoder.encode(env.TELEGRAM_BOT_TOKEN)
    );
    
    const importedSecretKey = await crypto.subtle.importKey(
      "raw", 
      secretKeyBuf, 
      { name: "HMAC", hash: "SHA-256" }, 
      false, 
      ["sign"]
    );
    
    const signature = await crypto.subtle.sign(
      "HMAC", 
      importedSecretKey, 
      encoder.encode(dataCheckString)
    );
    
    const calculatedBytes = new Uint8Array(signature);
    const providedBytes = hexToBytes32(hash);
    if (!providedBytes || !timingSafeEqualBytes(calculatedBytes, providedBytes)) {
      return { user: null, valid: false };
    }
    
    const userStr = initData.get("user");
    if (!userStr) return { user: null, valid: false };
    
    const user = JSON.parse(userStr) as TelegramUser;
    
    // Check expiration (optional but recommended: 24h)
    const authDate = initData.get("auth_date");
    if (authDate) {
      const now = Math.floor(Date.now() / 1000);
      if (now - parseInt(authDate) > 86400) {
        return { user: null, valid: false };
      }
    }
    
    return { user, valid: true };
  } catch (e) {
    console.error("Failed to parse telegram init data", e);
    return { user: null, valid: false };
  }
}
