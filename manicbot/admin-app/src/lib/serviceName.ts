/**
 * Resolve a service's human-readable display name from its stored `names`
 * column.
 *
 * Services store `names` as either a plain string or a JSON blob keyed by
 * language (e.g. `{"ru":"Маникюр","en":"Manicure"}`). This helper is shared
 * between the server (appointment read queries that enrich rows with a
 * resolved `serviceName`) and the client (rail / picker labels) so the two
 * never drift.
 *
 * Server callers have no UI language in scope, so the default priority is
 * ru → en → pl → ua → first available. Client callers may pass `preferredLang`
 * to surface the viewer's language first.
 *
 * @param raw     the raw `services.names` value (JSON blob or plain string)
 * @param fallback value to return when `raw` is empty/unparseable — usually the svcId
 * @param preferredLang optional language code to prefer (e.g. "ru", "pl")
 */
export function parseServiceName(
  raw: string | null | undefined,
  fallback: string,
  preferredLang?: string,
): string {
  if (!raw) return fallback;
  const trimmed = String(raw).trim();
  if (!trimmed) return fallback;
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, string>;
    const byPref = preferredLang ? parsed[preferredLang] : undefined;
    return (
      byPref ??
      parsed.ru ??
      parsed.en ??
      parsed.pl ??
      parsed.ua ??
      Object.values(parsed)[0] ??
      fallback
    );
  } catch {
    // Not valid JSON despite the leading brace — treat as a plain label.
    return trimmed;
  }
}
