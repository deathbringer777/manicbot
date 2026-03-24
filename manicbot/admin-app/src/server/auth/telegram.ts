import { env } from "~/env";

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
    
    const calculatedHash = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    if (calculatedHash !== hash) {
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
