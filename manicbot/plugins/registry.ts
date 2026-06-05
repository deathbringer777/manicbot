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
 * 2026-06-05 cleanup — dropped 7 more slugs that either duplicated
 * already-shipped core UI or were non-functional facades / localStorage stubs.
 * The marketplace now lists ONLY genuinely modular, custom capabilities with
 * no native-UI equivalent.
 *   REMOVED (capability already lives in core UI, or pure facade / stub):
 *     - google-calendar         → core Settings GCal OAuth (SalonCalendarSection
 *                                 + googleCalendar.ts router); facade, no runtime
 *     - master-telegram-pairing → core Master profile + Salon → Channels pairing
 *                                 UI (MasterTelegramPairingCard +
 *                                 SalonMasterPairingTable); facade, no runtime
 *     - availability-share      → only emits the existing public /salon/<id> link
 *     - shift-planner           → core working hours + MasterScheduleEditor; the
 *                                 plugin had no runtime at all (stub)
 *     - earnings-goal           → core master earnings (MasterDashboard);
 *                                 plugin was a localStorage-only toy
 *     - export-hub              → core CSV export (clients.exportCsv / export.ts);
 *                                 plugin only dumped localStorage junk
 *     - message-templates       → localStorage-only template store (no server
 *                                 sync, no core equivalent — dropped as low-value)
 *
 * 2026-06-06 — also dropped `reminders`: it duplicated the system-level
 * notification bell + the core `phaseReminders` appointment-reminder cron, and
 * its calendar-chip UI was never wired. The worker `phasePluginCron`
 * orchestrator stays (now with zero dispatchers) for the next cron plugin.
 *
 * See the earlier 2026-05-16 drop list in
 * `admin-app/src/__tests__/plugins-removed-duplicates.test.ts` for prior cleanups.
 *
 * The 4 retained plugins below are genuinely modular, server-backed
 * capabilities with no core duplication.
 */

import type { PluginManifest, PluginModule } from "./types";

// ─── Manifest imports ────────────────────────────────────────────────────────

// ── tenant_owner ────────────────────────────────────────────────────────────
import loyaltyStampsManifest from "./loyalty-stamps/manifest";

// ── tenant_manager ──────────────────────────────────────────────────────────
import taskBoardManifest from "./task-board/manifest";

// ── Variant A (Phase 3) — growth plugins ────────────────────────────────────
import reviewCollectorManifest from "./review-collector/manifest";

// ── Variant A (Phase 3) — operations plugins ────────────────────────────────
import inventoryLiteManifest from "./inventory-lite/manifest";

const RAW_MANIFESTS: readonly PluginManifest[] = [
  // tenant_owner
  loyaltyStampsManifest,
  // tenant_manager
  taskBoardManifest,
  // Variant A growth
  reviewCollectorManifest,
  // Variant A operations
  inventoryLiteManifest,
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
