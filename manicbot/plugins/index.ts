/**
 * Barrel export for the Plugin Marketplace.
 * Consumers should import types from here, not from individual plugin files.
 */

export * from "./types";
export { PLUGINS, getPlugin, listPlugins, listManifests, findDuplicateSlugs } from "./registry";
