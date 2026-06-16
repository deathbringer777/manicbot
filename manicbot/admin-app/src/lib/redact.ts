/**
 * PII-safe email preview — `jo***@gmail.com`.
 *
 * Used in cross-tenant God Mode views where full recipient addresses must not
 * be shown. Tenant-scoped views show their own contacts' emails unredacted.
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return "—";
  const head = (local ?? "").slice(0, 2);
  return `${head}***@${domain}`;
}
