/**
 * Plugin Marketplace — core tRPC router.
 *
 * Security invariants enforced in this router:
 *   1. Only `system_admin` may install with `tenantId === null` (platform install).
 *   2. Tenant-scoped install requires the caller to be `tenant_owner` for that
 *      tenant (tenantId match) OR `system_admin` (can install on behalf of any).
 *   3. `master` may install tenant-scoped plugins only when their tenant is
 *      `isPersonal = 1` (they own it).
 *   4. Enable/disable/uninstall/updateSettings enforce the same scoping.
 *   5. `coming_soon` plugins cannot be installed — 403.
 *   6. All mutations write a row to `plugin_events` (audit trail).
 *   7. `listCatalog` is readable by any authenticated web user — but the
 *      `lock` reason is computed per-viewer so leaked details are minimal.
 *   8. Settings JSON has a hard 8 KB ceiling; per-plugin schema validation
 *      happens inside the lifecycle hook (which owns the semantic shape).
 *   9. No dynamic code execution anywhere — lazy imports are static paths
 *      resolved by the bundler, not constructed at runtime.
 */

import { z } from "zod";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  createTRPCRouter,
  adminProcedure,
  protectedProcedure,
  managerProcedure,
} from "~/server/api/trpc";
import { pluginEvents, pluginInstallations, tenants } from "~/server/db/schema";
import { listManifests, getPlugin } from "@plugins/index";
import type {
  PluginLang,
  PluginRole,
  CatalogCard,
  PluginBillingState,
} from "@plugins/types";
import { PLUGIN_LANGS } from "@plugins/types";
import { runLifecycle, writePluginEvent } from "~/server/plugins/lifecycle";
import { computeLockReason, type ViewerContext } from "~/server/plugins/lockReason";
import { env } from "~/env";

const MAX_SETTINGS_BYTES = 8 * 1024;

// ─── Helpers ────────────────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function newId(): string {
  // Web Crypto is available on Cloudflare edge runtime — prefer randomUUID.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `pi_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function normalizeLang(lang: string | undefined): PluginLang {
  return (PLUGIN_LANGS as readonly string[]).includes(lang ?? "")
    ? (lang as PluginLang)
    : "ru";
}

function billingLabel(manifest: ReturnType<typeof listManifests>[number], lang: PluginLang): string {
  if (manifest.billing.label) return manifest.billing.label[lang];
  const model = manifest.billing.model;
  if (model === "free") return { ru: "Бесплатно", ua: "Безкоштовно", en: "Free", pl: "Bezpłatnie" }[lang];
  if (model === "included_in_plan") return { ru: "В вашем тарифе", ua: "У вашому тарифі", en: "Included in plan", pl: "W Twoim planie" }[lang];
  if (model === "paid_addon_monthly") {
    return manifest.billing.priceHintUsd
      ? `$${manifest.billing.priceHintUsd}/mo`
      : { ru: "Платно", ua: "Платно", en: "Paid", pl: "Płatne" }[lang];
  }
  // paid_addon_onetime
  return manifest.billing.priceHintUsd
    ? `$${manifest.billing.priceHintUsd}`
    : { ru: "Единоразово", ua: "Одноразово", en: "One-time", pl: "Jednorazowo" }[lang];
}

async function assertCanWriteScope(
  ctx: { webUser: { webRole: string; tenantId: string | null }; db: unknown },
  tenantId: string | null,
): Promise<void> {
  const role = ctx.webUser.webRole;
  if (tenantId === null) {
    if (role !== "system_admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Platform-wide plugin installs require system_admin",
      });
    }
    return;
  }
  if (role === "system_admin") return;
  if (role === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;
  if (role === "master" && ctx.webUser.tenantId === tenantId) {
    const [t] = await (ctx.db as {
      select: (fields: unknown) => {
        from: (t: unknown) => {
          where: (c: unknown) => {
            limit: (n: number) => Promise<Array<{ isPersonal: number }>>;
          };
        };
      };
    })
      .select({ isPersonal: tenants.isPersonal })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (t?.isPersonal === 1) return;
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You cannot manage plugins for this tenant",
  });
}

async function loadInstallation(
  db: unknown,
  installationId: string,
): Promise<typeof pluginInstallations.$inferSelect | null> {
  const rows = await (db as {
    select: () => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          limit: (n: number) => Promise<Array<typeof pluginInstallations.$inferSelect>>;
        };
      };
    };
  })
    .select()
    .from(pluginInstallations)
    .where(eq(pluginInstallations.id, installationId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Router ────────────────────────────────────────────────────────────────

export const pluginsRouter = createTRPCRouter({
  // ---------------------------------------------------------------------
  // listCatalog — returns every manifest, localized + annotated with the
  // viewer's lock state. All authenticated users can query this.
  // ---------------------------------------------------------------------
  listCatalog: protectedProcedure
    .input(
      z
        .object({ lang: z.string().optional(), installedOnly: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<CatalogCard[]> => {
      const lang = normalizeLang(input?.lang);

      const role = (ctx.webUser?.webRole ?? null) as PluginRole | null;
      const tenantId = ctx.webUser?.tenantId ?? null;

      let tenantPlan: string | null = null;
      if (tenantId) {
        const [t] = await ctx.db
          .select({ plan: tenants.plan })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        tenantPlan = t?.plan ?? null;
      }

      const allSlugs = listManifests().map((m) => m.slug);
      const conds = [isNull(pluginInstallations.tenantId)];
      if (tenantId) conds.push(eq(pluginInstallations.tenantId, tenantId));
      const installs = allSlugs.length
        ? await ctx.db
            .select()
            .from(pluginInstallations)
            .where(
              and(
                inArray(pluginInstallations.pluginSlug, allSlugs),
                conds.length === 1 ? conds[0] : (await import("drizzle-orm")).or(...conds),
              ) as never,
            )
        : [];

      const installedSlugs = new Set<string>();
      const installIndex = new Map<string, typeof pluginInstallations.$inferSelect>();
      for (const row of installs) {
        const existing = installIndex.get(row.pluginSlug);
        // platform install wins over tenant install (matches guard behaviour)
        if (!existing || (existing.tenantId !== null && row.tenantId === null)) {
          installIndex.set(row.pluginSlug, row);
        }
        installedSlugs.add(row.pluginSlug);
      }

      const viewer: ViewerContext = { role, tenantPlan, tenantId };

      const cards: CatalogCard[] = [];
      for (const m of listManifests()) {
        const installed = installedSlugs.has(m.slug);
        if (input?.installedOnly && !installed) continue;
        const installRow = installIndex.get(m.slug) ?? null;
        cards.push({
          slug: m.slug,
          category: m.category,
          status: m.status,
          iconName: m.icon.name,
          iconTint: m.icon.tint,
          name: m.name[lang],
          tagline: m.tagline[lang],
          description: m.description[lang],
          keywords: m.keywords[lang],
          billingLabel: billingLabel(m, lang),
          billingModel: m.billing.model,
          priceHintUsd: m.billing.priceHintUsd,
          lock: computeLockReason(m, viewer),
          installed,
          installationId: installRow?.id ?? null,
          enabled: installRow ? installRow.enabled === 1 : false,
        });
      }
      return cards;
    }),

  // ---------------------------------------------------------------------
  // getInstalled — list installs visible to caller (tenant + platform).
  // ---------------------------------------------------------------------
  getInstalled: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.webUser?.tenantId ?? null;
    const conds = [isNull(pluginInstallations.tenantId)];
    if (tenantId) conds.push(eq(pluginInstallations.tenantId, tenantId));
    const rows = await ctx.db
      .select()
      .from(pluginInstallations)
      .where(conds.length === 1 ? conds[0] : (await import("drizzle-orm")).or(...conds));
    return rows;
  }),

  // ---------------------------------------------------------------------
  // install — create a new install row + run onInstall.
  // ---------------------------------------------------------------------
  install: managerProcedure
    .input(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z][a-z0-9-]{2,40}$/, "Invalid slug shape"),
        tenantId: z.string().nullable().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plugin = getPlugin(input.slug);
      if (!plugin) throw new TRPCError({ code: "NOT_FOUND", message: "Plugin not found" });
      const m = plugin.manifest;
      if (m.status === "coming_soon") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Plugin is not yet available" });
      }

      // resolve target scope — null when not provided means "my tenant if I have one, else platform"
      let scope: string | null;
      if (input.tenantId === undefined) {
        scope = ctx.webUser!.webRole === "system_admin" && !ctx.webUser!.tenantId
          ? null
          : ctx.webUser!.tenantId;
      } else {
        scope = input.tenantId;
      }

      if (m.scope === "platform" && scope !== null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Plugin can only be installed platform-wide" });
      }
      if (m.scope === "tenant" && scope === null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Plugin can only be installed per-tenant" });
      }

      await assertCanWriteScope(ctx as never, scope);

      // role-availability gate (based on who's clicking Install)
      if (!(m.availableForRoles as string[]).includes(ctx.webUser!.webRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Plugin is not available for role "${ctx.webUser!.webRole}"`,
        });
      }

      // plan gate
      if (scope !== null && m.minPlan !== "any") {
        const [t] = await ctx.db
          .select({ plan: tenants.plan })
          .from(tenants)
          .where(eq(tenants.id, scope))
          .limit(1);
        const plan = t?.plan ?? null;
        const { meetsPlanGate } = await import("~/server/plugins/assertPluginEnabled");
        if (!meetsPlanGate(plan, m.minPlan)) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: `Plugin requires plan "${m.minPlan}" (current: ${plan ?? "none"})`,
          });
        }
      }

      // settings: cap size
      let settingsJson: string | null = null;
      if (input.settings) {
        settingsJson = JSON.stringify(input.settings);
        if (settingsJson.length > MAX_SETTINGS_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Settings payload too large" });
        }
      }

      // duplicate check — unique (tenant_id, slug)
      const conds: unknown[] = [eq(pluginInstallations.pluginSlug, input.slug)];
      conds.push(scope === null ? isNull(pluginInstallations.tenantId) : eq(pluginInstallations.tenantId, scope));
      const existing = await ctx.db
        .select()
        .from(pluginInstallations)
        .where(and(...(conds as [never, never])))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Plugin already installed for this scope" });
      }

      const id = newId();
      const t = now();
      const initialBillingState: PluginBillingState =
        m.billing.model === "paid_addon_monthly" || m.billing.model === "paid_addon_onetime"
          ? "trialing" // will flip to 'paid' when Stripe webhook confirms (Sprint 4)
          : m.billing.model === "included_in_plan"
          ? "included"
          : "not_applicable";

      await ctx.db.insert(pluginInstallations).values({
        id,
        tenantId: scope,
        pluginSlug: input.slug,
        enabled: 1,
        version: m.version,
        installedBy: ctx.webUser!.id,
        installedAt: t,
        updatedAt: t,
        settingsJson,
        billingState: initialBillingState,
      });

      await writePluginEvent(ctx.db, id, "installed", ctx.webUser!.id, {
        slug: input.slug,
        scope,
        version: m.version,
        billingState: initialBillingState,
      });

      if (m.lifecycle.onInstall) {
        await runLifecycle(input.slug, "onInstall", id, {
          db: ctx.db,
          tenantId: scope,
          webUserId: ctx.webUser!.id,
          settings: input.settings ?? null,
        }, ctx.db);
      }

      return { id, billingState: initialBillingState };
    }),

  // ---------------------------------------------------------------------
  // uninstall — delete row + run onUninstall.
  // ---------------------------------------------------------------------
  uninstall: managerProcedure
    .input(z.object({ installationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadInstallation(ctx.db, input.installationId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Installation not found" });
      await assertCanWriteScope(ctx as never, row.tenantId);

      // Run hook BEFORE delete so it can still read DB state.
      if (getPlugin(row.pluginSlug)?.manifest.lifecycle.onUninstall) {
        await runLifecycle(row.pluginSlug, "onUninstall", row.id, {
          db: ctx.db,
          tenantId: row.tenantId,
          webUserId: ctx.webUser!.id,
          settings: row.settingsJson ? safeParse(row.settingsJson) : null,
        }, ctx.db);
      }

      await ctx.db.delete(pluginInstallations).where(eq(pluginInstallations.id, row.id));

      await writePluginEvent(ctx.db, row.id, "uninstalled", ctx.webUser!.id, { slug: row.pluginSlug });
      return { ok: true };
    }),

  // ---------------------------------------------------------------------
  // enable / disable — flip the toggle, fire hook.
  // ---------------------------------------------------------------------
  enable: managerProcedure
    .input(z.object({ installationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadInstallation(ctx.db, input.installationId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanWriteScope(ctx as never, row.tenantId);
      await ctx.db
        .update(pluginInstallations)
        .set({ enabled: 1, updatedAt: now() })
        .where(eq(pluginInstallations.id, row.id));
      if (getPlugin(row.pluginSlug)?.manifest.lifecycle.onEnable) {
        await runLifecycle(row.pluginSlug, "onEnable", row.id, {
          db: ctx.db, tenantId: row.tenantId, webUserId: ctx.webUser!.id,
          settings: row.settingsJson ? safeParse(row.settingsJson) : null,
        }, ctx.db);
      }
      await writePluginEvent(ctx.db, row.id, "enabled", ctx.webUser!.id);
      return { ok: true };
    }),

  disable: managerProcedure
    .input(z.object({ installationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadInstallation(ctx.db, input.installationId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanWriteScope(ctx as never, row.tenantId);
      await ctx.db
        .update(pluginInstallations)
        .set({ enabled: 0, updatedAt: now() })
        .where(eq(pluginInstallations.id, row.id));
      if (getPlugin(row.pluginSlug)?.manifest.lifecycle.onDisable) {
        await runLifecycle(row.pluginSlug, "onDisable", row.id, {
          db: ctx.db, tenantId: row.tenantId, webUserId: ctx.webUser!.id,
          settings: row.settingsJson ? safeParse(row.settingsJson) : null,
        }, ctx.db);
      }
      await writePluginEvent(ctx.db, row.id, "disabled", ctx.webUser!.id);
      return { ok: true };
    }),

  // ---------------------------------------------------------------------
  // updateSettings — swap the settings_json (size-capped).
  // ---------------------------------------------------------------------
  updateSettings: managerProcedure
    .input(
      z.object({
        installationId: z.string().min(1),
        settings: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadInstallation(ctx.db, input.installationId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanWriteScope(ctx as never, row.tenantId);
      const json = JSON.stringify(input.settings);
      if (json.length > MAX_SETTINGS_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Settings payload too large" });
      }
      await ctx.db
        .update(pluginInstallations)
        .set({ settingsJson: json, updatedAt: now() })
        .where(eq(pluginInstallations.id, row.id));
      await writePluginEvent(ctx.db, row.id, "settings_updated", ctx.webUser!.id);
      return { ok: true };
    }),

  // ---------------------------------------------------------------------
  // checkoutAddon — creates a Stripe Checkout Session URL for paid addons.
  //
  // The admin-app runs on CF Pages and delegates to the Worker's
  // /admin/plugin-addon-checkout endpoint (which holds STRIPE_SECRET_KEY).
  // The caller gets back a URL to redirect to; after payment, a webhook
  // flips billing_state via handleAddonInvoicePaid / handleAddonCheckoutCompleted.
  // ---------------------------------------------------------------------
  checkoutAddon: managerProcedure
    .input(
      z.object({
        slug: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
        cycle: z.enum(["monthly", "onetime"]).default("monthly"),
        returnUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plugin = getPlugin(input.slug);
      if (!plugin) throw new TRPCError({ code: "NOT_FOUND" });
      const m = plugin.manifest;
      const validCycle =
        (input.cycle === "monthly" && m.billing.model === "paid_addon_monthly") ||
        (input.cycle === "onetime" && m.billing.model === "paid_addon_onetime");
      if (!validCycle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Plugin "${input.slug}" does not support ${input.cycle} checkout`,
        });
      }
      if (!m.billing.stripePriceIdEnv) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Plugin billing block is missing stripePriceIdEnv",
        });
      }

      const workerUrl = (env as { WORKER_PUBLIC_URL?: string }).WORKER_PUBLIC_URL;
      const adminKey = (env as { ADMIN_KEY?: string }).ADMIN_KEY;
      if (!workerUrl || !adminKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "WORKER_PUBLIC_URL / ADMIN_KEY not configured",
        });
      }
      const tenantId = ctx.webUser!.tenantId;
      if (!tenantId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant required for addon checkout" });
      }

      const r = await fetch(`${workerUrl.replace(/\/$/, "")}/admin/plugin-addon-checkout`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${adminKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: input.slug,
          tenantId,
          cycle: input.cycle,
          priceIdEnv: m.billing.stripePriceIdEnv,
          returnUrl: input.returnUrl ?? `${workerUrl}/plugins/${input.slug}`,
        }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Worker checkout failed: ${r.status} ${txt}`,
        });
      }
      const data = (await r.json()) as { url?: string; error?: string };
      if (data.error || !data.url) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: data.error ?? "No URL" });
      }
      return { url: data.url };
    }),

  // ---------------------------------------------------------------------
  // auditTrail — list recent plugin_events (system_admin only).
  // ---------------------------------------------------------------------
  auditTrail: adminProcedure
    .input(
      z.object({
        installationId: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 100;
      const rows = input?.installationId
        ? await ctx.db
            .select()
            .from(pluginEvents)
            .where(eq(pluginEvents.installationId, input.installationId))
            .orderBy(desc(pluginEvents.createdAt))
            .limit(limit)
        : await ctx.db
            .select()
            .from(pluginEvents)
            .orderBy(desc(pluginEvents.createdAt))
            .limit(limit);
      return rows;
    }),
});

// ─── internal ─────────────────────────────────────────────────────────────

function safeParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
