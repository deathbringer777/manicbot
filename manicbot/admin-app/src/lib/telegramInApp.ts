/**
 * Whether the app runs inside a Telegram client (mini app, in-app browser, or
 * a WebView that identifies in UA / URL / referrer). Used to hide the cookie
 * bar — it is not appropriate in Telegram, and `WebApp.initData` alone is unreliable.
 */
export function isTelegramInAppContext(w: Window): boolean {
  if ("Telegram" in w && (w as Window & { Telegram?: unknown }).Telegram)
    return true;

  try {
    if (/Telegram/i.test(w.navigator.userAgent || "")) return true;
  } catch {
    /* ignore */
  }

  try {
    if (w.location?.search && w.location.search.includes("tgWebApp")) return true;
  } catch {
    /* ignore */
  }

  try {
    const ref = w.document?.referrer || "";
    if (/\/\/t\.me\//.test(ref) || /web\.telegram\.org/i.test(ref)) return true;
  } catch {
    /* ignore */
  }

  return false;
}
