/**
 * Shared helper for the master Telegram-pairing tRPC procedures.
 *
 * Mirror of `manicbot/src/services/masterPairing.js` (Worker side) — both
 * sides MUST produce the same SHA-256 hash for a given raw token so the
 * bot can look up the row by hash. Pure-functional pieces here are unit-
 * tested in `__tests__/master-pairing-token-logic.test.ts`.
 *
 * The DB insert is intentionally NOT factored out — each tRPC procedure
 * (`master.requestPairingCode`, `salon.createMasterPairingCode`) writes
 * the row directly with the right `createdByWebUserId` attribution.
 */

export const PAIRING_TOKEN_BYTES = 24;
export const PAIRING_TOKEN_TTL_SEC = 7 * 24 * 3600; // 7 days

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a fresh pairing token. Returns `{ raw, hash }` so the caller
 * can hand `raw` to the master (in the deep-link) and persist only `hash`.
 */
export async function generatePairingToken(): Promise<{ raw: string; hash: string }> {
  const bytes = new Uint8Array(PAIRING_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const raw = b64urlEncodeBytes(bytes);
  const hash = await hashPairingToken(raw);
  return { raw, hash };
}

/** SHA-256 hex of the raw token. Deterministic. */
export async function hashPairingToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i]!.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Build the Telegram deep-link URL. Format mirrors the Worker
 * `buildDeepLink` helper so the two sides stay in lockstep.
 */
export function buildDeepLink(botUsername: string, rawToken: string): string {
  const u = botUsername.replace(/^@/, "");
  return `https://t.me/${u}?start=mst_${rawToken}`;
}
