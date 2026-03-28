/**
 * Single source of truth for which platform_roles.role values grant
 * God Mode tRPC (adminProcedure) and support-router access.
 */
export const ADMIN_PROCEDURE_PLATFORM_ROLES = [
  "system_admin",
  "support",
  "technical_support",
] as const;

export type AdminProcedurePlatformRole =
  (typeof ADMIN_PROCEDURE_PLATFORM_ROLES)[number];

export function isAdminProcedurePlatformRole(
  role: string | undefined | null,
): role is AdminProcedurePlatformRole {
  return (
    role === "system_admin" ||
    role === "support" ||
    role === "technical_support"
  );
}
