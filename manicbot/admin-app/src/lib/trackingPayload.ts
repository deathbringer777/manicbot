/**
 * Client/server helper to encode tracking payloads for Telegram /start deep
 * links. Mirror of `manicbot/src/services/origins.js` `encodeStartPayload` —
 * token format must stay in lockstep so the Worker can decode what we mint.
 *
 * Token format:
 *   base64url(JSON({ s?, m?, c?, ct? }))
 * Keys are shortened to stay under Telegram's 64-char /start limit.
 */

export interface TrackingPayload {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export function encodeStartPayload(
  payload: TrackingPayload = {},
  maxLen = 64,
): string {
  const obj: Record<string, string> = {};
  if (payload.source) obj.s = String(payload.source).slice(0, 120);
  if (payload.medium) obj.m = String(payload.medium).slice(0, 120);
  if (payload.campaign) obj.c = String(payload.campaign).slice(0, 120);
  if (payload.content) obj.ct = String(payload.content).slice(0, 120);
  if (Object.keys(obj).length === 0) throw new Error("encodeStartPayload: empty object");

  const json = JSON.stringify(obj);
  const b64 = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (b64.length > maxLen) {
    throw new Error(
      `encodeStartPayload: token exceeds maxLen ${maxLen} (got ${b64.length})`,
    );
  }
  return b64;
}

export function decodeStartPayload(token: string): TrackingPayload | null {
  if (!token || typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return null;

  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length >= 4) {
    try {
      const padded = trimmed.replace(/-/g, "+").replace(/_/g, "/") +
        "===".slice((trimmed.length + 3) % 4);
      const decoded = atob(padded);
      if (decoded.startsWith("{") && decoded.endsWith("}")) {
        const raw = JSON.parse(decoded) as Record<string, unknown>;
        const out: TrackingPayload = {};
        if (typeof raw.s === "string") out.source = raw.s.slice(0, 120);
        if (typeof raw.m === "string") out.medium = raw.m.slice(0, 120);
        if (typeof raw.c === "string") out.campaign = raw.c.slice(0, 120);
        if (typeof raw.ct === "string") out.content = raw.ct.slice(0, 120);
        if (Object.keys(out).length > 0) return out;
      }
    } catch {
      /* fall through */
    }
  }

  if (/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) {
    return { source: trimmed };
  }

  return null;
}
