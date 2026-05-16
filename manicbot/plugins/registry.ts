/**
 * Static plugin registry.
 *
 * All plugins are imported by slug here. The registry is the single source of
 * truth used by both the admin-app (tRPC router, UI catalog, nav injection)
 * and the worker (cron, worker routes). No dynamic loading — every plugin is
 * a compile-time dependency.
 *
 * Runtime validation of the manifests happens in
 * `admin-app/src/server/plugins/manifestSchema.ts` (Zod). This file stays
 * dependency-free so the worker can import it without pulling zod.
 *
 * To add a plugin: create `manicbot/plugins/<slug>/manifest.ts` + optional
 * router/lifecycle/worker/ui files, then add one import line below.
 *
 * 2026-05-16 cleanup — dropped 13 slugs that duplicated already-shipped core
 * features or were pure marketing stubs:
 *   DELETED (capability already in core):
 *     - google-calendar          → admin-app `googleCalendar.ts` router
 *     - booking-reminder         → worker `phaseReminders` cron
 *     - client-crm-lite          → admin-app `clients.ts` router (0062)
 *     - quick-notes              → subset of task-board
 *   FOLDED INTO CORE (capability moves out of marketplace into core UI):
 *     - ai-abuse-monitor         → God Mode `/errors` filter tab
 *     - gdpr-center              → `consent.ts` + `/admin/gdpr` page
 *     - sla-tracker              → Support dashboard SLA tab
 *     - escalation-playbook      → Support dashboard playbook tab
 *     - kb-search                → Support dashboard FTS search
 *     - ticket-templates         → Support reply composer
 *     - keyboard-shortcuts       → `(dashboard)/layout.tsx` global hook
 *     - dark-plus                → `AppearanceSection` extra themes
 *     - portfolio-gallery        → public salon + master profile (uses
 *                                  existing `cover_photo` / `portfolio` cols)
 *
 * The 7 retained plugins below are genuinely modular and stay in the
 * marketplace. Variant A from the catalog strategy adds 10 more on top.
 */

import type { PluginManifest, PluginModule } from "./types";

// ─── Manifest imports ────────────────────────────────────────────────────────

// ── tenant_owner ────────────────────────────────────────────────────────────
import loyaltyStampsManifest from "./loyalty-stamps/manifest";

// ── tenant_manager ──────────────────────────────────────────────────────────
import shiftPlannerManifest from "./shift-planner/manifest";
import taskBoardManifest from "./task-board/manifest";

// ── master ──────────────────────────────────────────────────────────────────
import availabilityShareManifest from "./availability-share/manifest";
import earningsGoalManifest from "./earnings-goal/manifest";

// ── universal ───────────────────────────────────────────────────────────────
import exportHubManifest from "./export-hub/manifest";

// ── master + tenant_owner ───────────────────────────────────────────────────
import messageTemplatesManifest from "./message-templates/manifest";

const RAW_MANIFESTS: readonly PluginManifest[] = [
  // tenant_owner
  loyaltyStampsManifest,
  // tenant_manager
  shiftPlannerManifest,
  taskBoardManifest,
  // master
  availabilityShareManifest,
  earningsGoalManifest,
  // universal
  exportHubManifest,
  // master + tenant_owner
  messageTemplatesManifest,
];

// ─── Lazy loaders (optional per plugin) ─────────────────────────────────────

const PLUGIN_ROUTER_LOADERS: Record<string, PluginModule["loadRouter"]> = {};

const PLUGIN_LIFECYCLE_LOADERS: Record<string, PluginModule["loadLifecycle"]> = {};

const PLUGIN_HEALTH_LOADERS: Record<string, PluginModule["loadHealth"]> = {};

// ─── Registry assembly ──────────────────────────────────────────────────────

function buildModule(manifest: PluginManifest): PluginModule {
  return {
    manifest,
    loadRouter: PLUGIN_ROUTER_LOADERS[manifest.slug],
    loadLifecycle: PLUGIN_LIFECYCLE_LOADERS[manifest.slug],
    loadHealth: PLUGIN_HEALTH_LOADERS[manifest.slug],
  };
}

export const PLUGINS: Readonly<Record<string, PluginModule>> = Object.freeze(
  Object.fromEntries(RAW_MANIFESTS.map((m) => [m.slug, buildModule(m)] as const)),
);

// ─── Query helpers ──────────────────────────────────────────────────────────

export function getPlugin(slug: string): PluginModule | null {
  return PLUGINS[slug] ?? null;
}

export function listPlugins(): PluginModule[] {
  return Object.values(PLUGINS);
}

export function listManifests(): PluginManifest[] {
  return listPlugins().map((p) => p.manifest);
}

export function findDuplicateSlugs(): string[] {
  const seen = new Map<string, number>();
  for (const m of RAW_MANIFESTS) seen.set(m.slug, (seen.get(m.slug) ?? 0) + 1);
  return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([s]) => s);
}
