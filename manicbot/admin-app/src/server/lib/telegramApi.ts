/**
 * Edge-compatible Telegram Bot API helpers.
 * No SDK — raw fetch to api.telegram.org.
 */

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export async function telegramGetMe(token: string): Promise<TelegramBotInfo> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Telegram API error: ${res.status}`);
  }
  const data = await res.json() as { ok: boolean; result?: TelegramBotInfo; description?: string };
  if (!data.ok || !data.result) {
    throw new Error(data.description ?? "Invalid bot token");
  }
  return data.result;
}

export async function telegramSetWebhook(
  token: string,
  url: string,
  secret?: string,
): Promise<void> {
  const body: Record<string, string> = { url };
  if (secret) body.secret_token = secret;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json() as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(data.description ?? "Failed to set webhook");
  }
}

export async function telegramDeleteWebhook(token: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json() as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(data.description ?? "Failed to delete webhook");
  }
}
