/**
 * Pure helper computing why a given viewer can't install/use a plugin.
 * Used by listCatalog to render locked cards, and by assertPluginEnabled
 * indirectly (same rules, different entry point).
 */

import type {
  PluginManifest,
  PluginRole,
  PluginLockReason,
} from "@plugins/types";
import { meetsPlanGate, roleMatches } from "./assertPluginEnabled";

export interface ViewerContext {
  role: PluginRole | null;
  tenantPlan: string | null;
  tenantId: string | null;
}

export function computeLockReason(
  manifest: PluginManifest,
  viewer: ViewerContext,
): PluginLockReason {
  // coming_soon is absolute — even system_admin sees it as locked (nothing to
  // install yet on the server side).
  if (manifest.status === "coming_soon") return { kind: "coming_soon" };

  // system_admin bypasses role / plan / scope gates — they can install anything
  // in any scope for testing and support purposes.
  if (viewer.role === "system_admin") return { kind: "none" };

  if (viewer.role && !roleMatches(viewer.role, manifest.availableForRoles)) {
    return { kind: "role_mismatch", availableFor: manifest.availableForRoles };
  }

  if (manifest.scope === "platform") {
    return { kind: "platform_only", currentScope: "tenant" };
  }

  if (
    manifest.minPlan !== "any" &&
    viewer.tenantId &&
    !meetsPlanGate(viewer.tenantPlan, manifest.minPlan)
  ) {
    return { kind: "plan", required: manifest.minPlan, current: viewer.tenantPlan };
  }

  return { kind: "none" };
}
