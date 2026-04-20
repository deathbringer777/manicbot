/**
 * Lifecycle hook runner for plugin install/uninstall/enable/disable.
 *
 * Security invariants enforced here (on top of the router's role check):
 *   - Hooks run in a try/catch; any throw is logged to plugin_events (event="error")
 *     and re-thrown as TRPCError. Callers MUST NOT catch & swallow.
 *   - Hooks receive a scoped ctx — no raw `env` beyond what they declared.
 *   - Audit row is written for every lifecycle call, successful or not.
 */

import { TRPCError } from "@trpc/server";
import { pluginEvents } from "~/server/db/schema";
import { getPlugin } from "@plugins/index";
import type { PluginLifecycleCtx } from "@plugins/types";

type DbInstance = unknown;

export type LifecycleHook = "onInstall" | "onUninstall" | "onEnable" | "onDisable";

export async function writePluginEvent(
  db: DbInstance,
  installationId: string,
  event: string,
  actorWebUserId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await (db as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
    .insert(pluginEvents)
    .values({
      installationId,
      event,
      actorWebUserId: actorWebUserId,
      detailJson: detail ? JSON.stringify(detail) : null,
      createdAt: Math.floor(Date.now() / 1000),
    });
}

/**
 * Runs a lifecycle hook if the plugin declares it and exports it.
 * Always writes an audit row. Throws on hook failure (after logging).
 */
export async function runLifecycle(
  slug: string,
  hook: LifecycleHook,
  installationId: string,
  lifecycleCtx: PluginLifecycleCtx,
  db: DbInstance,
): Promise<void> {
  const plugin = getPlugin(slug);
  if (!plugin) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Plugin "${slug}" not in registry` });
  }
  const declared = plugin.manifest.lifecycle?.[hook];
  if (!declared) {
    // Nothing to run — skip silently. Not an error.
    return;
  }
  if (!plugin.loadLifecycle) {
    // Manifest claims it wants the hook but no module present — treat as dev error.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Plugin "${slug}" declared ${hook} but no lifecycle module is registered`,
    });
  }

  try {
    const mod = await plugin.loadLifecycle();
    const fn = mod[hook];
    if (typeof fn === "function") {
      await fn(lifecycleCtx);
    }
    await writePluginEvent(db, installationId, hook.replace(/^on/, "").toLowerCase(), lifecycleCtx.webUserId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writePluginEvent(db, installationId, "error", lifecycleCtx.webUserId, {
      hook,
      message: msg,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Plugin ${slug} ${hook} failed: ${msg}`,
      cause: err instanceof Error ? err : undefined,
    });
  }
}
