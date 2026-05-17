/**
 * Phase 2: salon staff (tenant_manager) management.
 *
 * Tenant owners can:
 *   - invite a new tenant_manager by email (creates web_users row + sends
 *     verification code like a normal registration)
 *   - list managers and their permission sets
 *   - update permissions (default subset applies immediately; granting any
 *     sensitive permission emits a 6-digit code to the OWNER'S email; owner
 *     then calls `confirmElevation` with the code to apply)
 *   - revoke a manager
 *
 * Tenant managers can:
 *   - create action requests when they lack a permission; owner approves/denies
 *
 * Tenant managers CANNOT elevate their own permissions — elevation is
 * always initiated by the tenant_owner and the code goes to the owner's email.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  tenantMemberPermissions,
  tenantActionRequests,
  permissionElevationCodes,
  webUsers,
  auditLog,
} from "~/server/db/schema";
import {
  TENANT_PERMISSION_KEYS,
  TENANT_MANAGER_DEFAULT,
  SENSITIVE_PERMISSIONS,
  type PermissionKey,
} from "~/server/api/permissions";
import { hashPassword } from "~/server/auth/password";
import { hashToken, timingSafeEqualHex } from "~/server/auth/tokens";
import { checkRateLimit } from "~/server/auth/rateLimit";
import { sendPermissionElevationCodeEmail, sendVerificationCodeEmail } from "~/server/email/emailService";
import { isResendConfigured } from "~/server/email/resend";

const PermissionKeyZ = z.enum(TENANT_PERMISSION_KEYS);

const ACTION_TYPES = ["master.create", "service.add", "service.edit", "other"] as const;
const ACTION_STATUS = ["pending", "approved", "denied", "executed"] as const;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function generateVerificationCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0]! % 900000) + 100000);
}

function randomPassword(len = 24): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}

async function ownerOnlyForTenant(ctx: any, tenantId: string): Promise<void> {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const role = ctx.webUser.webRole;
  if (role === "system_admin") return;
  if (role === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Only the tenant owner may perform this action." });
}

async function managerSelfOrOwnerForTenant(ctx: any, tenantId: string, targetUserId: string): Promise<"owner" | "self"> {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const role = ctx.webUser.webRole;
  if (role === "system_admin") return "owner";
  if (role === "tenant_owner" && ctx.webUser.tenantId === tenantId) return "owner";
  if (role === "tenant_manager" && ctx.webUser.tenantId === tenantId && ctx.webUser.id === targetUserId) return "self";
  throw new TRPCError({ code: "FORBIDDEN" });
}

export const tenantStaffRouter = createTRPCRouter({
  /**
   * List every staff member of a tenant: both `tenant_manager` accounts and
   * salon-invited `master` accounts (web_users.role IN ('tenant_manager',
   * 'master')). Owner-only.
   *
   * Each row carries its role + permission set so the unified Staff UI can
   * render manager/master badges side-by-side. Synthetic-Telegram-only
   * masters (without a web_user row) are intentionally excluded — they
   * don't use the web admin and have no permission rows to manage.
   */
  listMembers: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownerOnlyForTenant(ctx, input.tenantId);
      const members = await ctx.db
        .select({
          id: webUsers.id,
          email: webUsers.email,
          name: webUsers.name,
          role: webUsers.role,
          emailVerified: webUsers.emailVerified,
          createdAt: webUsers.createdAt,
        })
        .from(webUsers)
        .where(
          and(
            eq(webUsers.tenantId, input.tenantId),
            inArray(webUsers.role, ["tenant_manager", "master"]),
          ),
        );

      if (members.length === 0) return [];

      const perms = await ctx.db
        .select({ webUserId: tenantMemberPermissions.webUserId, permission: tenantMemberPermissions.permission })
        .from(tenantMemberPermissions)
        .where(eq(tenantMemberPermissions.tenantId, input.tenantId));

      const byUser = new Map<string, PermissionKey[]>();
      for (const p of perms) {
        if (!(TENANT_PERMISSION_KEYS as readonly string[]).includes(p.permission)) continue;
        const arr = byUser.get(p.webUserId) ?? [];
        arr.push(p.permission as PermissionKey);
        byUser.set(p.webUserId, arr);
      }

      return members.map((m) => ({
        ...m,
        permissions: byUser.get(m.id) ?? [],
      }));
    }),

  /** Invite a new tenant_manager. Owner-only. Sends verification email + default permissions. */
  inviteMember: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      email: z.string().email(),
      name: z.string().min(1).max(200).nullish(),
      lang: z.enum(["ru", "ua", "en", "pl"]).default("en"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ownerOnlyForTenant(ctx, input.tenantId);
      if (!isResendConfigured()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Email service not configured" });
      }
      const email = input.email.toLowerCase().trim();
      const existing = await ctx.db.select({ id: webUsers.id }).from(webUsers).where(eq(webUsers.email, email)).limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists" });
      }

      const id = crypto.randomUUID();
      const tempPassword = randomPassword();
      const passwordHash = await hashPassword(tempPassword);
      const code = generateVerificationCode();
      const codeHash = await hashToken(code);
      const now = nowSec();

      await ctx.db.insert(webUsers).values({
        id,
        email,
        passwordHash,
        role: "tenant_manager",
        tenantId: input.tenantId,
        name: input.name ?? null,
        lang: input.lang,
        emailVerified: 0,
        verificationToken: codeHash,
        verificationTokenExpiresAt: now + 15 * 60,
        tosAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Grant default permissions
      for (const p of TENANT_MANAGER_DEFAULT) {
        await ctx.db.insert(tenantMemberPermissions).values({
          tenantId: input.tenantId,
          webUserId: id,
          permission: p,
          grantedAt: now,
          grantedBy: ctx.webUser!.id,
        }).onConflictDoUpdate({
          target: [tenantMemberPermissions.tenantId, tenantMemberPermissions.webUserId, tenantMemberPermissions.permission],
          set: { grantedAt: now, grantedBy: ctx.webUser!.id },
        });
      }

      const sent = await sendVerificationCodeEmail(email, code, input.lang);
      if (!sent.ok) {
        await ctx.db.delete(webUsers).where(eq(webUsers.id, id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not send invite email" });
      }

      await ctx.db.insert(auditLog).values({
        tenantId: input.tenantId,
        actor: ctx.webUser!.email,
        action: "staff.invited",
        detail: JSON.stringify({ targetUserId: id, email }),
        ip: null,
        createdAt: now,
      });

      return { id, email, tempPassword };
    }),

  /** Revoke manager: delete permission grants and flip their role to `client`. */
  revokeMember: protectedProcedure
    .input(z.object({ tenantId: z.string(), webUserId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ownerOnlyForTenant(ctx, input.tenantId);
      const now = nowSec();
      await ctx.db
        .delete(tenantMemberPermissions)
        .where(and(
          eq(tenantMemberPermissions.tenantId, input.tenantId),
          eq(tenantMemberPermissions.webUserId, input.webUserId),
        ));
      await ctx.db
        .update(webUsers)
        .set({ role: "client", tenantId: null, updatedAt: now })
        .where(eq(webUsers.id, input.webUserId));

      await ctx.db.insert(auditLog).values({
        tenantId: input.tenantId,
        actor: ctx.webUser!.email,
        action: "staff.revoked",
        detail: JSON.stringify({ targetUserId: input.webUserId }),
        ip: null,
        createdAt: now,
      });
      return { success: true };
    }),

  /**
   * Update permissions. Default-set additions apply immediately. Any sensitive
   * permission triggers email-verified elevation: emits a 6-digit code to the
   * owner's email, returns `{ elevationRequired: true, elevationId }`.
   */
  updatePermissions: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      webUserId: z.string(),
      permissions: z.array(PermissionKeyZ),
    }))
    .mutation(async ({ ctx, input }) => {
      await ownerOnlyForTenant(ctx, input.tenantId);

      const requested = new Set(input.permissions);
      const sensitive = input.permissions.filter((p) => SENSITIVE_PERMISSIONS.includes(p));

      // Always apply default-set adjustments immediately (they can only be the standard CRUD).
      const current = await ctx.db
        .select({ permission: tenantMemberPermissions.permission })
        .from(tenantMemberPermissions)
        .where(and(
          eq(tenantMemberPermissions.tenantId, input.tenantId),
          eq(tenantMemberPermissions.webUserId, input.webUserId),
        ));
      const currentSet = new Set(current.map((r) => r.permission as PermissionKey));
      const now = nowSec();

      // Remove any permissions not in `requested` (owner can always revoke)
      for (const existing of currentSet) {
        if (!requested.has(existing)) {
          await ctx.db
            .delete(tenantMemberPermissions)
            .where(and(
              eq(tenantMemberPermissions.tenantId, input.tenantId),
              eq(tenantMemberPermissions.webUserId, input.webUserId),
              eq(tenantMemberPermissions.permission, existing),
            ));
        }
      }

      // Add non-sensitive permissions immediately
      for (const p of input.permissions) {
        if (currentSet.has(p)) continue;
        if (SENSITIVE_PERMISSIONS.includes(p)) continue;
        await ctx.db.insert(tenantMemberPermissions).values({
          tenantId: input.tenantId,
          webUserId: input.webUserId,
          permission: p,
          grantedAt: now,
          grantedBy: ctx.webUser!.id,
        });
      }

      // If there are new sensitive permissions, request elevation
      const newSensitive = sensitive.filter((p) => !currentSet.has(p));
      if (newSensitive.length === 0) {
        await ctx.db.insert(auditLog).values({
          tenantId: input.tenantId,
          actor: ctx.webUser!.email,
          action: "staff.permissions_updated",
          detail: JSON.stringify({ targetUserId: input.webUserId, permissions: input.permissions }),
          ip: null,
          createdAt: now,
        });
        return { success: true, elevationRequired: false as const };
      }

      if (!isResendConfigured()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email verification required for sensitive permissions, but email service is not configured.",
        });
      }

      // Rate-limit elevation requests per owner
      const rl = await checkRateLimit(ctx.db, ctx.webUser!.id, "elevation_request", 3, 10 * 60 * 1000);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many elevation attempts. Try again later." });
      }

      const elevationId = crypto.randomUUID();
      const code = generateVerificationCode();
      const codeHash = await hashToken(code);
      const expiresAt = now + 15 * 60;

      await ctx.db.insert(permissionElevationCodes).values({
        id: elevationId,
        tenantId: input.tenantId,
        ownerUserId: ctx.webUser!.id,
        targetUserId: input.webUserId,
        permissions: JSON.stringify(newSensitive),
        codeHash,
        expiresAt,
        attempts: 0,
        createdAt: now,
      });

      // Look up target user for the email body + owner's lang
      const [target] = await ctx.db
        .select({ email: webUsers.email })
        .from(webUsers)
        .where(eq(webUsers.id, input.webUserId))
        .limit(1);
      const [me] = await ctx.db
        .select({ email: webUsers.email, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser!.id))
        .limit(1);

      const sent = await sendPermissionElevationCodeEmail(
        me?.email ?? ctx.webUser!.email,
        code,
        target?.email ?? "(unknown)",
        newSensitive,
        (me?.lang ?? "en") as any,
      );
      if (!sent.ok) {
        await ctx.db.delete(permissionElevationCodes).where(eq(permissionElevationCodes.id, elevationId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not send elevation email" });
      }

      return {
        success: false,
        elevationRequired: true as const,
        elevationId,
        pendingPermissions: newSensitive,
      };
    }),

  /** Confirm pending elevation by entering the 6-digit code. Owner-only. */
  confirmElevation: protectedProcedure
    .input(z.object({ elevationId: z.string(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

      const rl = await checkRateLimit(ctx.db, ctx.webUser.id, "elevation_verify", 5, 10 * 60 * 1000);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again later." });
      }

      const rows = await ctx.db
        .select()
        .from(permissionElevationCodes)
        .where(eq(permissionElevationCodes.id, input.elevationId))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Elevation request not found" });

      const row = rows[0]!;
      if (row.ownerUserId !== ctx.webUser.id && ctx.webUser.webRole !== "system_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner who initiated this elevation can confirm it" });
      }
      if (row.consumedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Code already used" });
      }
      const now = nowSec();
      if (now > row.expiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Code expired" });
      }

      const inputHash = await hashToken(input.code);
      if (!timingSafeEqualHex(inputHash, row.codeHash)) {
        // Increment attempts
        await ctx.db
          .update(permissionElevationCodes)
          .set({ attempts: (row.attempts ?? 0) + 1 })
          .where(eq(permissionElevationCodes.id, input.elevationId));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid code" });
      }

      const permissions = JSON.parse(row.permissions) as PermissionKey[];
      for (const p of permissions) {
        if (!TENANT_PERMISSION_KEYS.includes(p)) continue;
        await ctx.db.insert(tenantMemberPermissions).values({
          tenantId: row.tenantId,
          webUserId: row.targetUserId,
          permission: p,
          grantedAt: now,
          grantedBy: ctx.webUser.id,
        }).onConflictDoUpdate({
          target: [tenantMemberPermissions.tenantId, tenantMemberPermissions.webUserId, tenantMemberPermissions.permission],
          set: { grantedAt: now, grantedBy: ctx.webUser.id },
        });
      }

      await ctx.db
        .update(permissionElevationCodes)
        .set({ consumedAt: now })
        .where(eq(permissionElevationCodes.id, input.elevationId));

      await ctx.db.insert(auditLog).values({
        tenantId: row.tenantId,
        actor: ctx.webUser.email,
        action: "staff.permissions_elevated",
        detail: JSON.stringify({ targetUserId: row.targetUserId, permissions }),
        ip: null,
        createdAt: now,
      });

      return { success: true, grantedPermissions: permissions };
    }),

  // ── Action requests (manager → owner) ────────────────────────────────────

  /** tenant_manager creates a request for the owner to approve. */
  createActionRequest: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      action: z.enum(ACTION_TYPES),
      payload: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (ctx.webUser.webRole !== "tenant_manager" || ctx.webUser.tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only tenant_manager can create action requests" });
      }
      const id = crypto.randomUUID();
      const now = nowSec();
      await ctx.db.insert(tenantActionRequests).values({
        id,
        tenantId: input.tenantId,
        requesterId: ctx.webUser.id,
        action: input.action,
        payload: input.payload ? JSON.stringify(input.payload) : null,
        status: "pending",
        createdAt: now,
      });
      return { id };
    }),

  /** Owner lists pending (or other status) action requests. */
  listActionRequests: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      status: z.enum(ACTION_STATUS).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await ownerOnlyForTenant(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(tenantActionRequests)
        .where(
          input.status
            ? and(eq(tenantActionRequests.tenantId, input.tenantId), eq(tenantActionRequests.status, input.status))
            : eq(tenantActionRequests.tenantId, input.tenantId),
        )
        .orderBy(desc(tenantActionRequests.createdAt))
        .limit(100);
      return rows;
    }),

  /** Owner approves/denies an action request. On approve, owner still executes
   *  the actual action via the relevant router (masters.create, services.add).
   *  This mutation only flips status + records the decision. */
  reviewActionRequest: protectedProcedure
    .input(z.object({
      requestId: z.string(),
      decision: z.enum(["approved", "denied", "executed"]),
      ownerNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      const [req] = await ctx.db
        .select()
        .from(tenantActionRequests)
        .where(eq(tenantActionRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      await ownerOnlyForTenant(ctx, req.tenantId);

      const now = nowSec();
      await ctx.db
        .update(tenantActionRequests)
        .set({
          status: input.decision,
          ownerNote: input.ownerNote ?? null,
          reviewedBy: ctx.webUser.id,
          reviewedAt: now,
        })
        .where(eq(tenantActionRequests.id, input.requestId));

      await ctx.db.insert(auditLog).values({
        tenantId: req.tenantId,
        actor: ctx.webUser.email,
        action: `staff.request_${input.decision}`,
        detail: JSON.stringify({ requestId: input.requestId, action: req.action }),
        ip: null,
        createdAt: now,
      });
      return { success: true };
    }),

  /** tenant_manager views own pending requests. */
  listMyRequests: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await managerSelfOrOwnerForTenant(ctx, input.tenantId, ctx.webUser!.id);
      const where = role === "self"
        ? and(eq(tenantActionRequests.tenantId, input.tenantId), eq(tenantActionRequests.requesterId, ctx.webUser!.id))
        : eq(tenantActionRequests.tenantId, input.tenantId);
      return ctx.db
        .select()
        .from(tenantActionRequests)
        .where(where)
        .orderBy(desc(tenantActionRequests.createdAt))
        .limit(50);
    }),
});
