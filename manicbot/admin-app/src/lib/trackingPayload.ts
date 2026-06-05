/**
 * Client/server helper to encode tracking payloads for Telegram /start deep
 * links. Mirror of `manicbot/src/services/origins.js` (encode/decode) — the token
 * format must stay in lockstep so the Worker can decode what we mint.
 *
 * Token format:
 *   base64url(JSON({ s?, m?, c?, ct? }))
 * Keys are shortened to stay under Telegram's 64-char /start limit. Encoding is
 * UTF-8-safe (handles Cyrillic), unlike a bare `btoa(JSON.stringify(...))` which
 * is Latin-1 only and throws on non-Latin-1 input.
 */

export interface TrackingPayload {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export interface FitResult {
  token: string;
  truncated: boolean;
  dropped: string[];
}

/**
 * UTF-8-safe base64url encode. `btoa` is Latin-1 only and throws
 * `InvalidCharacterError` on anything outside 0-255 (e.g. Cyrillic), so we
 * serialize through UTF-8 bytes first and only hand `btoa` a binary string.
 */
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of {@link toBase64Url}: base64url → UTF-8 string. Throws on bad input. */
function fromBase64Url(b64url: string): string {
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
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
  const b64 = toBase64Url(json);
  if (b64.length > maxLen) {
    throw new Error(
      `encodeStartPayload: token exceeds maxLen ${maxLen} (got ${b64.length})`,
    );
  }
  return b64;
}

/** Optional fields in the order they are dropped to make a token fit (last → first). */
const FIT_DROP_SEQUENCE = ["content", "medium", "campaign"] as const;

/**
 * Like {@link encodeStartPayload}, but never throws on overflow: drops optional
 * fields by priority (content → medium → campaign) until the token fits `maxLen`,
 * always keeping `source` (truncating it only as a last resort). Used by the public
 * web→Telegram CTA, where a working (if partially-attributed) link beats a crash.
 */
export function encodeStartPayloadFit(
  payload: TrackingPayload = {},
  maxLen = 64,
): FitResult {
  if (!payload.source) {
    throw new Error("encodeStartPayloadFit: empty object (source required)");
  }
  const { source, medium, campaign, content } = payload;
  const candidates: TrackingPayload[] = [
    { source, medium, campaign, content },
    { source, medium, campaign },
    { source, campaign },
    { source },
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      return {
        token: encodeStartPayload(candidates[i]!, maxLen),
        truncated: i > 0,
        dropped: FIT_DROP_SEQUENCE.slice(0, i),
      };
    } catch {
      /* too long — try the next, smaller candidate */
    }
  }

  // Source alone still overflows — hard-truncate it until a token fits.
  let src = String(source);
  while (src.length > 1) {
    src = src.slice(0, -1);
    try {
      return {
        token: encodeStartPayload({ source: src }, maxLen),
        truncated: true,
        dropped: [...FIT_DROP_SEQUENCE, "source"],
      };
    } catch {
      /* keep shrinking */
    }
  }
  return {
    token: encodeStartPayload({ source: src.slice(0, 1) || "x" }, maxLen),
    truncated: true,
    dropped: [...FIT_DROP_SEQUENCE, "source"],
  };
}

export function decodeStartPayload(token: string): TrackingPayload | null {
  if (!token || typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return null;

  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length >= 4) {
    try {
      const decoded = fromBase64Url(trimmed);
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
