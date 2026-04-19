import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { timingSafeEqualStr } from "~/server/auth/telegram";
import {
  tenants,
  bots,
  platformRoles,
  supportAgents,
  tenantRoles,
  appointments,
  users,
  webUsers,
  masters,
} from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "~/server/auth/password";

function randomId(len = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => chars[b % chars.length])
    .join("");
}

function slugify(name: string): string {
  const map: Record<string, string> = {
    а:"a",б:"b",в:"v",г:"g",ґ:"g",д:"d",е:"e",є:"ie",ё:"e",ж:"zh",з:"z",и:"y",
    і:"i",ї:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",
    у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"iu",я:"ia",
  };
  return name
    .toLowerCase()
    .replace(/[а-яёіїєґ]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function generatePassword(len = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => chars[b % chars.length])
    .join("");
}

export const provisioningRouter = createTRPCRouter({
  // ─── TEST ACCOUNT PROVISIONING ──────────────────────────────
  /**
   * Provision a fully-formed test account: tenant + (master row, if kind=master)
   * + verified web_user with the supplied password. The tenant is flagged
   * `is_test=1` and made publicly visible. Idempotent by lower-cased email:
   * a second call with the same email returns the existing account untouched.
   *
   * Plan handling:
   *   - start | pro | max → billing_status='active', current_period_end = now + 365d
   *   - expired_trial    → billing_status='trialing', trial_ends_at = now - 86400
   */
  provisionTestAccount: adminProcedure
    .input(
      z.object({
        kind: z.enum(["salon", "master"]),
        plan: z.enum(["start", "pro", "max", "expired_trial"]),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        name: z.string().min(1).max(100),
        city: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const now = Math.floor(Date.now() / 1000);

      // Idempotency: if a web user with this email exists and is bound to a
      // test tenant, return the existing record unchanged.
      const existing = await ctx.db
        .select({ id: webUsers.id, tenantId: webUsers.tenantId, role: webUsers.role })
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      if (existing[0]) {
        const tid = existing[0].tenantId;
        if (tid) {
          const [trow] = await ctx.db.select().from(tenants).where(eq(tenants.id, tid)).limit(1);
          if (trow?.isTest) {
            return {
              tenantId: tid,
              webUserId: existing[0].id,
              role: existing[0].role,
              plan: trow.plan ?? "start",
              billingStatus: trow.billingStatus ?? "trialing",
              currentPeriodEnd: trow.currentPeriodEnd,
              trialEndsAt: trow.trialEndsAt,
              isTest: true,
              skipped: true as const,
            };
          }
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: `Email ${email} is already used by a non-test account`,
        });
      }

      const tenantId = "t_" + randomId(6);
      const slugBase = slugify(input.name) || "test";
      const slug = `${slugBase}-${randomId(4)}`;
      const isPersonal = input.kind === "master" ? 1 : 0;

      const isExpiredTrial = input.plan === "expired_trial";
      const planValue = isExpiredTrial ? "start" : input.plan;
      const billingStatus = isExpiredTrial ? "trialing" : "active";
      const currentPeriodEnd = isExpiredTrial ? null : now + 365 * 86400;
      const trialEndsAt = isExpiredTrial ? now - 86400 : null;

      await ctx.db.insert(tenants).values({
        id: tenantId,
        name: input.name.trim(),
        active: 1,
        plan: planValue,
        billingStatus,
        trialEndsAt,
        graceEndsAt: null,
        currentPeriodEnd,
        cancelAtPeriodEnd: 0,
        slug,
        city: input.city ?? null,
        publicActive: 1,
        isPersonal,
        isTest: 1,
        createdAt: now,
        updatedAt: now,
      });

      let masterId: number | null = null;
      if (input.kind === "master") {
        // Synthetic chatId in the 10B+ range (no Telegram collision).
        masterId = 10_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
        await ctx.db.insert(masters).values({
          tenantId,
          chatId: masterId,
          name: input.name.trim(),
          active: 1,
          addedAt: now,
        });
      }

      const webUserId = crypto.randomUUID();
      const passwordHash = await hashPassword(input.password);
      try {
        await ctx.db.insert(webUsers).values({
          id: webUserId,
          email,
          passwordHash,
          role: input.kind === "master" ? "master" : "tenant_owner",
          tenantId,
          name: input.name.trim(),
          emailVerified: 1,
          tosAcceptedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        // Roll back tenant + master on failure.
        try { await ctx.db.delete(masters).where(eq(masters.tenantId, tenantId)); } catch {}
        try { await ctx.db.delete(tenants).where(eq(tenants.id, tenantId)); } catch {}
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create test web user: ${e instanceof Error ? e.message : "unknown"}`,
        });
      }

      return {
        tenantId,
        webUserId,
        role: input.kind === "master" ? ("master" as const) : ("tenant_owner" as const),
        plan: planValue,
        billingStatus,
        currentPeriodEnd,
        trialEndsAt,
        masterId,
        isTest: true,
        skipped: false as const,
      };
    }),

  // ─── QUICK ONBOARD ──────────────────────────────────────────

  quickOnboard: adminProcedure
    .input(
      z.object({
        salonName: z.string().min(1).max(100),
        plan: z.enum(["start", "pro", "max"]).default("pro"),
        botToken: z.string().min(10),
        ownerEmail: z.string().email(),
        webhookSecret: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const workerUrl = env.WORKER_PUBLIC_URL;
      const adminKey = env.ADMIN_KEY;
      if (!workerUrl || !adminKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "WORKER_PUBLIC_URL and ADMIN_KEY must be configured",
        });
      }

      const email = input.ownerEmail.toLowerCase().trim();

      // Check email uniqueness
      const existing = await ctx.db
        .select({ id: webUsers.id })
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "User with this email already exists" });
      }

      const tenantId = "t_" + randomId(6);
      const botId = input.botToken.split(":")[0]!;
      const webhookSecret = input.webhookSecret || randomId(16);
      const tempPassword = generatePassword(16);
      const now = Math.floor(Date.now() / 1000);
      const trialEndsAt = now + 14 * 24 * 3600;

      // 1. Create tenant
      await ctx.db.insert(tenants).values({
        id: tenantId,
        name: input.salonName.trim(),
        active: 1,
        plan: input.plan,
        billingStatus: "trialing",
        trialEndsAt,
        cancelAtPeriodEnd: 0,
        createdAt: now,
        updatedAt: now,
      });

      // 2. Call Worker /admin/provision for bot registration (encryption + webhook)
      let webhookUrl = "";
      let webhookOk = false;
      try {
        // #S9: ADMIN_KEY moved from query string to Authorization: Bearer header.
        const res = await fetch(`${workerUrl}/admin/provision`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminKey}`,
          },
          body: JSON.stringify({
            bots: [{ botToken: input.botToken, tenantId, tenantName: input.salonName.trim(), webhookSecret }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          results?: Array<{ botId: string; tenantId?: string; webhook?: boolean; webhookUrl?: string; error?: string; skip?: string }>;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Worker returned ${res.status}`);
        }
        const botResult = data.results?.[0];
        if (botResult?.error) {
          throw new Error(botResult.error);
        }
        webhookUrl = botResult?.webhookUrl ?? "";
        webhookOk = botResult?.webhook ?? false;
      } catch (e) {
        // Rollback tenant
        try { await ctx.db.delete(tenants).where(eq(tenants.id, tenantId)); } catch {}
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Bot provisioning failed: ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }

      // 3. Upsert local bot record
      await ctx.db
        .insert(bots)
        .values({ botId, tenantId, webhookSecret, active: 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: bots.botId,
          set: { tenantId, webhookSecret, updatedAt: now },
        });

      // 4. Create web user with temp password
      try {
        const passwordHash = await hashPassword(tempPassword);
        await ctx.db.insert(webUsers).values({
          id: crypto.randomUUID(),
          email,
          passwordHash,
          role: "tenant_owner",
          tenantId,
          emailVerified: 1,
          tosAcceptedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        // Rollback tenant + bot
        try {
          await ctx.db.delete(bots).where(eq(bots.botId, botId));
          await ctx.db.delete(tenants).where(eq(tenants.id, tenantId));
        } catch {}
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `User creation failed: ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }

      return { ok: true, tenantId, botId, webhookUrl, webhookOk, ownerEmail: email, tempPassword };
    }),

  // ─── TENANTS ────────────────────────────────────────────────

  createTenant: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        plan: z.enum(["start", "pro", "max"]).default("pro"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = "t_" + randomId(6);
      const now = Math.floor(Date.now() / 1000);
      const trialEndsAt = now + 14 * 24 * 3600; // 14 days — matches Worker TRIAL_DURATION_MS

      await ctx.db.insert(tenants).values({
        id: tenantId,
        name: input.name.trim(),
        active: 1,
        plan: input.plan,
        billingStatus: "trialing",
        trialEndsAt,
        cancelAtPeriodEnd: 0,
        createdAt: now,
        updatedAt: now,
      });

      return { ok: true, tenantId, name: input.name.trim() };
    }),

  // ─── BOTS ────────────────────────────────────────────────────

  linkBot: adminProcedure
    .input(
      z.object({
        botId: z.string().min(1),
        botUsername: z.string().optional(),
        tenantId: z.string().optional(),
        webhookSecret: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .insert(bots)
        .values({
          botId: input.botId,
          tenantId: input.tenantId ?? null,
          botUsername: input.botUsername ?? null,
          webhookSecret: input.webhookSecret ?? null,
          active: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: bots.botId,
          set: {
            tenantId: input.tenantId ?? null,
            botUsername: input.botUsername ?? null,
            updatedAt: now,
          },
        });
      return { ok: true };
    }),

  // ─── CONFIRM ALL PENDING ─────────────────────────────────────

  confirmAllPending: adminProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const confirmedBy = ctx.user?.id ? Number(ctx.user.id) : Number(env.ADMIN_CHAT_ID ?? 0);
      await ctx.db
        .update(appointments)
        .set({ status: "confirmed", confirmedBy })
        .where(
          and(
            eq(appointments.tenantId, input.tenantId),
            eq(appointments.status, "pending"),
            eq(appointments.cancelled, 0)
          )
        );
      return { ok: true };
    }),

  cancelAllPending: adminProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(appointments)
        .set({ status: "cancelled", cancelled: 1, cancelReason: "Cancelled by admin" })
        .where(
          and(
            eq(appointments.tenantId, input.tenantId),
            eq(appointments.status, "pending"),
            eq(appointments.cancelled, 0)
          )
        );
      return { ok: true };
    }),

  // ─── PLATFORM SUPPORT AGENTS ─────────────────────────────────

  listAgents: adminProcedure.query(async ({ ctx }) => {
    const agents = await ctx.db.select().from(supportAgents);
    const roles = await ctx.db.select().from(platformRoles);

    // Resolve names from users table for all agent chat IDs
    const allChatIds = [
      ...agents.map((a) => a.chatId),
      ...roles.filter((r) => r.role === "system_admin").map((r) => r.chatId),
    ];
    const uniqueIds = [...new Set(allChatIds)];
    const nameMap = new Map<number, { name: string | null; username: string | null }>();
    for (const cid of uniqueIds) {
      const row = await ctx.db
        .select({ name: users.name, tgUsername: users.tgUsername })
        .from(users)
        .where(eq(users.chatId, cid))
        .limit(1);
      if (row[0]) nameMap.set(cid, { name: row[0].name, username: row[0].tgUsername });
    }

    const resolveAgent = (chatId: number) => ({
      chatId,
      name: nameMap.get(chatId)?.name ?? null,
      username: nameMap.get(chatId)?.username ?? null,
    });

    return {
      support: agents.filter((a) => a.type === "support").map((a) => resolveAgent(a.chatId)),
      techSupport: agents.filter((a) => a.type === "technical_support").map((a) => resolveAgent(a.chatId)),
      /** Legacy rows only — system_admin is never assignable via API. */
      platformAdmins: roles.filter((r) => r.role === "system_admin").map((r) => resolveAgent(r.chatId)),
    };
  }),

  addAgent: adminProcedure
    .input(
      z.object({
        chatId: z.number(),
        type: z.enum(["support", "technical_support"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .insert(supportAgents)
        .values({ chatId: input.chatId, type: input.type })
        .onConflictDoUpdate({
          target: supportAgents.chatId,
          set: { type: input.type },
        });
      const role = input.type === "support" ? "support" : "technical_support";
      await ctx.db
        .insert(platformRoles)
        .values({ chatId: input.chatId, role, createdAt: now })
        .onConflictDoUpdate({
          target: platformRoles.chatId,
          set: { role },
        });
      return { ok: true };
    }),

  removeAgent: adminProcedure
    .input(z.object({ chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        env.ADMIN_CHAT_ID &&
        timingSafeEqualStr(String(input.chatId), env.ADMIN_CHAT_ID)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot remove platform owner.",
        });
      }
      await ctx.db
        .delete(supportAgents)
        .where(eq(supportAgents.chatId, input.chatId));
      await ctx.db
        .delete(platformRoles)
        .where(eq(platformRoles.chatId, input.chatId));
      return { ok: true };
    }),

  // ─── TENANT ROLES ─────────────────────────────────────────────

  setTenantRole: adminProcedure
    .input(
      z.object({
        tenantId: z.string(),
        chatId: z.number(),
        role: z.enum(["tenant_owner", "master"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .insert(tenantRoles)
        .values({
          tenantId: input.tenantId,
          chatId: input.chatId,
          role: input.role,
          createdAt: now,
        })
        .onConflictDoNothing();
      return { ok: true };
    }),

  removeTenantRole: adminProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(tenantRoles)
        .where(
          and(
            eq(tenantRoles.tenantId, input.tenantId),
            eq(tenantRoles.chatId, input.chatId)
          )
        );
      return { ok: true };
    }),

  listTenantRoles: adminProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(tenantRoles)
        .where(eq(tenantRoles.tenantId, input.tenantId));
    }),
});
