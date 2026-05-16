/**
 * Plugin Settings Panel Registry.
 *
 * Each plugin that declares `capabilities.settingsPanel` in its manifest
 * registers its lazy-imported panel component here by `componentId`.
 *
 * Keep this file explicit (not auto-generated) — one line per plugin — so
 * the client bundle doesn't include panels for plugins you haven't routed yet.
 *
 * All components must:
 *   - be client components (`"use client"`)
 *   - take a single `{ installationId }: { installationId: string }` prop
 *   - call `api.plugins.updateSettings` on save
 *
 * 2026-05-16 — emptied during the marketplace cleanup (google-calendar
 * settings panel was the sole entry; the underlying capability now lives
 * in the core `googleCalendar.ts` router). Phase 2 plumbing will re-add
 * entries here as new plugins ship their own settings panels.
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

export interface PluginPanelProps {
  installationId: string;
}

type PanelLoader = () => Promise<{ default: ComponentType<PluginPanelProps> }>;

/**
 * Map of `componentId` (as declared in manifest) → dynamic import.
 * When a plugin ships a settings UI, add one entry here.
 */
const PANEL_LOADERS: Record<string, PanelLoader> = {};

/**
 * Returns a Next.js-wrapped component for the given plugin componentId,
 * or null if the id isn't registered.
 */
export function loadPluginPanel(componentId: string): ComponentType<PluginPanelProps> | null {
  const loader = PANEL_LOADERS[componentId];
  if (!loader) return null;
  return dynamic(loader, {
    ssr: false,
    loading: () => null,
  }) as unknown as ComponentType<PluginPanelProps>;
}

export function hasPluginPanel(componentId: string): boolean {
  return !!PANEL_LOADERS[componentId];
}

export function listPanelComponentIds(): string[] {
  return Object.keys(PANEL_LOADERS);
}
