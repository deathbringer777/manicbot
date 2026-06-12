/**
 * Mask an email address for display to parties who are not its owner:
 * `kirill@gmail.com` → `k***@gmail.com`.
 *
 * Keeps the first local-part character + the full domain — enough for a
 * "sign in as …" hint on the invitation accept page without disclosing the
 * address itself (audit 2026-06-12, TI-1). Malformed input collapses to
 * `***`; null passes through so optional fields stay optional.
 */
export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}
