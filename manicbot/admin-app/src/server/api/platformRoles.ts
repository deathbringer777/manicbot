/**
 * Platform staff in `platform_roles` (assignable via UI / bot).
 * God Mode (full admin tRPC) is only ADMIN_CHAT_ID or web `system_admin` — never granted via this table.
 */
export const ASSIGNABLE_PLATFORM_STAFF_ROLES = [
  "support",
  "technical_support",
] as const;

export type AssignablePlatformStaffRole =
  (typeof ASSIGNABLE_PLATFORM_STAFF_ROLES)[number];

export function isAssignablePlatformStaffRole(
  role: string | undefined | null,
): role is AssignablePlatformStaffRole {
  return role === "support" || role === "technical_support";
}

