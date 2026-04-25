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
 */

import type { PluginManifest, PluginModule } from "./types";

// ─── Manifest imports ────────────────────────────────────────────────────────

// ── system_admin ────────────────────────────────────────────────────────────
import aiAbuseMonitorManifest from "./ai-abuse-monitor/manifest";
import gdprCenterManifest from "./gdpr-center/manifest";

// ── productivity / integrations ─────────────────────────────────────────────
import googleCalendarManifest from "./google-calendar/manifest";

// ── tenant_owner ────────────────────────────────────────────────────────────
import loyaltyStampsManifest from "./loyalty-stamps/manifest";
import birthdayCampaignsManifest from "./birthday-campaigns/manifest";
import multiLangBotManifest from "./multi-lang-bot/manifest";

// ── tenant_manager ──────────────────────────────────────────────────────────
import shiftPlannerManifest from "./shift-planner/manifest";
import taskBoardManifest from "./task-board/manifest";

// ── master ──────────────────────────────────────────────────────────────────
import portfolioGalleryManifest from "./portfolio-gallery/manifest";
import clientCrmLiteManifest from "./client-crm-lite/manifest";
import availabilityShareManifest from "./availability-share/manifest";
import earningsGoalManifest from "./earnings-goal/manifest";

// ── support / technical_support ─────────────────────────────────────────────
import ticketTemplatesManifest from "./ticket-templates/manifest";
import escalationPlaybookManifest from "./escalation-playbook/manifest";
import slaTrackerManifest from "./sla-tracker/manifest";
import kbSearchManifest from "./kb-search/manifest";

// ── universal ───────────────────────────────────────────────────────────────
import commandPaletteManifest from "./command-palette/manifest";
import activityFeedManifest from "./activity-feed/manifest";
import keyboardShortcutsManifest from "./keyboard-shortcuts/manifest";
import darkPlusManifest from "./dark-plus/manifest";
import exportHubManifest from "./export-hub/manifest";
import quickNotesManifest from "./quick-notes/manifest";

// ── master + tenant_owner ───────────────────────────────────────────────────
import bookingReminderManifest from "./booking-reminder/manifest";
import messageTemplatesManifest from "./message-templates/manifest";

const RAW_MANIFESTS: readonly PluginManifest[] = [
  // system_admin
  aiAbuseMonitorManifest,
  gdprCenterManifest,
  // productivity / integrations
  googleCalendarManifest,
  // tenant_owner
  loyaltyStampsManifest,
  birthdayCampaignsManifest,
  multiLangBotManifest,
  // tenant_manager
  shiftPlannerManifest,
  taskBoardManifest,
  // master
  portfolioGalleryManifest,
  clientCrmLiteManifest,
  availabilityShareManifest,
  earningsGoalManifest,
  // support
  ticketTemplatesManifest,
  escalationPlaybookManifest,
  slaTrackerManifest,
  kbSearchManifest,
  // universal
  commandPaletteManifest,
  activityFeedManifest,
  keyboardShortcutsManifest,
  darkPlusManifest,
  exportHubManifest,
  quickNotesManifest,
  // master + tenant_owner
  bookingReminderManifest,
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
