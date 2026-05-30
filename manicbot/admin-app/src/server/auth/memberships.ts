/**
 * Multi-tenant membership resolution for web users.
 *
 * A web user has a single immutable HOME tenant (`web_users.tenant_id` +
 * `web_users.role`) and may additionally be a master in other salons (one
 * `masters` row bound by `web_user_id` + a `tenant_roles` row). The currently
 * selected salon is `web_users.active_tenant_id`; it flows into
 * `ctx.webUser.{tenantId, webRole}` via the NextAuth `jwt` callback so every
 * existing tenant guard, `getMyRole`, and dashboard works unchanged.
 *
 * Security: a master membership is proven AUTHORITATIVELY via
 * `masters.web_user_id` (never by synthetic-chatId guesswork, which could
 * collide). The active role is always re-derived from the DB on each session
 * refresh — a revoked role downgrades immediately, and a stale active pointer
 * self-heals back to home.
 */
import { and, eq } from "drizzle-orm";
import { masters, tenantRoles, tenants, webUsers } from "~/server/db/schema";
import type { getDb } from "~/server/db";

type Db = ReturnType<typeof getDb>;

export interface Membership {
  tenantId: string;
  /** Role IN this tenant: "tenant_owner" | "tenant_manager" | "master". */
  role: string;
  tenantName: string | null;
  isPersonal: boolean;
  /** True for the user's home tenant (web_users.tenant_id). */
  isHome: boolean;
}

/**
 * Deterministic synthetic chat id for a web user. Mirrors the formula inlined
 * at createMasterAccount / acceptInvitation* / ownership so the `masters` and
 * `tenant_roles` rows they write line up with what we read here.
 */
export function syntheticChatIdForWebUser(webUserId: string): number {
  return 10_000_000_000 + (parseInt(webUserId.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
}

/**
 * Pure: merge the home membership with authoritative master memberships,
 * deduping the home tenant (home role wins) and preserving home-first order.
 */
export function mergeMemberships(
  home: { tenantId: string; role: string; tenantName: string | null; isPersonal: boolean } | null,
  masterRows: Array<{ tenantId: string; role: string; tenantName: string | null; isPersonal: boolean }>,
): Membership[] {
  const out: Membership[] = [];
  const seen = new Set<string>();
  if (home) {
    out.push({ ...home, isHome: true });
    seen.add(home.tenantId);
  }
  for (const r of masterRows) {
    if (seen.has(r.tenantId)) continue;
    seen.add(r.tenantId);
    out.push({ ...r, isHome: false });
  }
  return out;
}

/**
 * Pure: decide the active (tenantId, role) from the home values + the active
 * pointer + whether the caller is an authoritative master in the active tenant.
 *
 * - no pointer, or pointer === home  → home (never heals).
 * - pointer + proven master role     → the active membership.
 * - pointer but NOT a member         → home, and signal `needsHeal` so the
 *                                       caller can clear the stale pointer.
 */
export function pickActiveMembership(args: {
  homeTenantId: string | null;
  homeRole: string;
  activeTenantId: string | null;
  activeMasterRole: string | null;
}): { tenantId: string | null; role: string; needsHeal: boolean } {
  const { homeTenantId, homeRole, activeTenantId, activeMasterRole } = args;
  if (!activeTenantId || activeTenantId === homeTenantId) {
    return { tenantId: homeTenantId, role: homeRole, needsHeal: false };
  }
  if (activeMasterRole) {
    return { tenantId: activeTenantId, role: activeMasterRole, needsHeal: false };
  }
  return { tenantId: homeTenantId, role: homeRole, needsHeal: true };
}

/**
 * All salons the user can act in: home (if any) + authoritative master
 * memberships. Drives the header salon switcher.
 */
export async function listMembershipsForWebUser(
  db: Db,
  args: { webUserId: string; homeTenantId: string | null; homeRole: string },
): Promise<Membership[]> {
  let home: { tenantId: string; role: string; tenantName: string | null; isPersonal: boolean } | null = null;
  if (args.homeTenantId) {
    const [t] = await db
      .select({ name: tenants.name, displayName: tenants.displayName, isPersonal: tenants.isPersonal })
      .from(tenants)
      .where(eq(tenants.id, args.homeTenantId))
      .limit(1);
    home = {
      tenantId: args.homeTenantId,
      role: args.homeRole,
      tenantName: t ? (t.displayName || t.name) : null,
      isPersonal: !!t?.isPersonal,
    };
  }

  const rows = await db
    .select({
      tenantId: masters.tenantId,
      role: tenantRoles.role,
      name: tenants.name,
      displayName: tenants.displayName,
      isPersonal: tenants.isPersonal,
    })
    .from(masters)
    .innerJoin(tenantRoles, and(eq(tenantRoles.tenantId, masters.tenantId), eq(tenantRoles.chatId, masters.chatId)))
    .innerJoin(tenants, eq(tenants.id, masters.tenantId))
    .where(and(eq(masters.webUserId, args.webUserId), eq(masters.active, 1)));

  const masterRows = rows.map((r) => ({
    tenantId: r.tenantId,
    role: r.role,
    tenantName: r.displayName || r.name,
    isPersonal: !!r.isPersonal,
  }));

  return mergeMemberships(home, masterRows);
}

/**
 * Resolve the effective (tenantId, role) for the session. Re-derives the active
 * role from the DB and clears a stale active pointer (self-heal). Called from
 * the NextAuth `jwt` callback.
 */
export async function resolveActiveMembership(
  db: Db,
  args: { webUserId: string; homeTenantId: string | null; homeRole: string; activeTenantId: string | null },
): Promise<{ tenantId: string | null; role: string }> {
  const { webUserId, homeTenantId, homeRole, activeTenantId } = args;
  if (!activeTenantId || activeTenantId === homeTenantId) {
    return { tenantId: homeTenantId, role: homeRole };
  }

  const [row] = await db
    .select({ role: tenantRoles.role })
    .from(masters)
    .innerJoin(tenantRoles, and(eq(tenantRoles.tenantId, masters.tenantId), eq(tenantRoles.chatId, masters.chatId)))
    .where(and(eq(masters.webUserId, webUserId), eq(masters.tenantId, activeTenantId), eq(masters.active, 1)))
    .limit(1);

  const decision = pickActiveMembership({
    homeTenantId,
    homeRole,
    activeTenantId,
    activeMasterRole: row?.role ?? null,
  });

  if (decision.needsHeal) {
    try {
      await db.update(webUsers).set({ activeTenantId: null }).where(eq(webUsers.id, webUserId));
    } catch {
      // Best-effort self-heal — must never break auth.
    }
  }

  return { tenantId: decision.tenantId, role: decision.role };
}
