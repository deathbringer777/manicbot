/**
 * Runtime panel registry for plugins.
 *
 * A plugin can ship a working UI ("runtime") that renders inside its detail
 * page. Panels are lazy-loaded via next/dynamic so bundle stays light.
 *
 * To wire a plugin: declare `capabilities.settingsPanel.componentId` in its
 * manifest (kept as the single entry point for MVP — same id is reused for
 * both the /settings?section=plugin:<slug> route and the /plugins/<slug>
 * inline runtime). Then add one loader entry here.
 *
 * Panels receive one prop: { installationId }.
 *
 * 2026-05-16 — dropped 6 runtime entries whose plugins were removed in the
 * marketplace cleanup: google-calendar, quick-notes, ticket-templates,
 * dark-plus, client-crm-lite, booking-reminder. See plugins/registry.ts
 * header for the full rationale.
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

export interface PluginRuntimeProps {
  installationId: string;
  slug: string;
}

type RuntimeLoader = () => Promise<{ default: ComponentType<PluginRuntimeProps> }>;

const RUNTIME_LOADERS: Record<string, RuntimeLoader> = {
  "task-board": () => import("./runtimes/TaskBoardRuntime"),
  "export-hub": () => import("./runtimes/ExportHubRuntime"),
  "availability-share": () => import("./runtimes/AvailabilityShareRuntime"),
  "earnings-goal": () => import("./runtimes/EarningsGoalRuntime"),
  "message-templates": () => import("./runtimes/MessageTemplatesRuntime"),
};

export function loadRuntime(slug: string): ComponentType<PluginRuntimeProps> | null {
  const loader = RUNTIME_LOADERS[slug];
  if (!loader) return null;
  return dynamic(loader, {
    ssr: false,
    loading: () => null,
  }) as unknown as ComponentType<PluginRuntimeProps>;
}

export function hasRuntime(slug: string): boolean {
  return !!RUNTIME_LOADERS[slug];
}

export function listRuntimeSlugs(): string[] {
  return Object.keys(RUNTIME_LOADERS);
}
