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

// ── test fixtures (hidden from production catalog via status) ───────────────
import helloWorldManifest from "./_hello-world/manifest";
import liveTestManifest from "./_live-test/manifest";
import platformTestManifest from "./_platform-test/manifest";

// ── system_admin (3) ────────────────────────────────────────────────────────
import aiAbuseMonitorManifest from "./ai-abuse-monitor/manifest";
import fraudShieldManifest from "./fraud-shield/manifest";
import gdprCenterManifest from "./gdpr-center/manifest";

// ── productivity / integrations ─────────────────────────────────────────────
import googleCalendarManifest from "./google-calendar/manifest";

// ── tenant_owner (4) ────────────────────────────────────────────────────────
import loyaltyStampsManifest from "./loyalty-stamps/manifest";
import birthdayCampaignsManifest from "./birthday-campaigns/manifest";
import noShowShieldManifest from "./no-show-shield/manifest";
import multiLangBotManifest from "./multi-lang-bot/manifest";

// ── tenant_manager (4) ──────────────────────────────────────────────────────
import shiftPlannerManifest from "./shift-planner/manifest";
import taskBoardManifest from "./task-board/manifest";
import inventoryLiteManifest from "./inventory-lite/manifest";
import dailyCloseManifest from "./daily-close/manifest";

// ── master (5) ──────────────────────────────────────────────────────────────
import portfolioGalleryManifest from "./portfolio-gallery/manifest";
import tipJarManifest from "./tip-jar/manifest";
import clientCrmLiteManifest from "./client-crm-lite/manifest";
import availabilityShareManifest from "./availability-share/manifest";
import earningsGoalManifest from "./earnings-goal/manifest";

// ── support / technical_support (5) ─────────────────────────────────────────
import ticketTemplatesManifest from "./ticket-templates/manifest";
import escalationPlaybookManifest from "./escalation-playbook/manifest";
import slaTrackerManifest from "./sla-tracker/manifest";
import customerHealthScoreManifest from "./customer-health-score/manifest";
import kbSearchManifest from "./kb-search/manifest";

// ── universal (8) ───────────────────────────────────────────────────────────
import commandPaletteManifest from "./command-palette/manifest";
import activityFeedManifest from "./activity-feed/manifest";
import keyboardShortcutsManifest from "./keyboard-shortcuts/manifest";
import darkPlusManifest from "./dark-plus/manifest";
import exportHubManifest from "./export-hub/manifest";
import quickNotesManifest from "./quick-notes/manifest";

// ── master + tenant_owner (2) ───────────────────────────────────────────────
import bookingReminderManifest from "./booking-reminder/manifest";
import messageTemplatesManifest from "./message-templates/manifest";

const RAW_MANIFESTS: readonly PluginManifest[] = [
  // fixtures
  helloWorldManifest,
  liveTestManifest,
  platformTestManifest,
  // system_admin
  aiAbuseMonitorManifest,
  fraudShieldManifest,
  gdprCenterManifest,
  // productivity / integrations
  googleCalendarManifest,
  // tenant_owner
  loyaltyStampsManifest,
  birthdayCampaignsManifest,
  noShowShieldManifest,
  multiLangBotManifest,
  // tenant_manager
  shiftPlannerManifest,
  taskBoardManifest,
  inventoryLiteManifest,
  dailyCloseManifest,
  // master
  portfolioGalleryManifest,
  tipJarManifest,
  clientCrmLiteManifest,
  availabilityShareManifest,
  earningsGoalManifest,
  // support
  ticketTemplatesManifest,
  escalationPlaybookManifest,
  slaTrackerManifest,
  customerHealthScoreManifest,
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
