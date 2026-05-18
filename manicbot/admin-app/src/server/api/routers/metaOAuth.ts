/**
 * tRPC router for Meta (Facebook + Instagram) OAuth-based channel connect.
 *
 * The actual OAuth machinery (state KV, code exchange, channel_config write,
 * webhook subscribe) lives in the Worker under `/meta/oauth/*` and
 * `/meta/{provider}/callback`. This router is the trusted gateway between
 * the salon-owner UI and those Worker endpoints — it scopes every call to
 * the calling tenant_owner via `assertTenantOwner` and stamps the
 * web_users.id on the OAuth state so the Worker can enforce IDOR on
 * `consume` / `finalize`.
 *
 * Surface:
 *   - start({ tenantId, provider, returnTo }) → { authUrl, state, expiresAt }
 *   - consume({ tenantId, state })            → { autoFinalized, channelConfigId?, pages? }
 *   - finalize({ tenantId, state, pageId })   → { channelConfigId, ... }
 *
 * Provider enum mirrors `META_OAUTH_PROVIDERS` in the Worker.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { env } from "~/env";

const ProviderEnum = z.enum(["instagram", "facebook"]);

function workerConfigOrThrow(): { workerUrl: string; adminKey: string } {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Server not configured for Meta OAuth. Set WORKER_PUBLIC_URL and ADMIN_KEY.",
    });
  }
  return { workerUrl, adminKey };
}

async function callWorker<T = Record<string, unknown>>(
  workerUrl: string,
  adminKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || json.ok === false) {
    const errCode = String(json.error ?? "worker_call_failed");
    throw new TRPCError({
      code: res.status === 403 ? "FORBIDDEN" : res.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
      message: errCode,
    });
  }
  return json as T;
}

export const metaOAuthRouter = createTRPCRouter({
  /**
   * Begin a Meta OAuth flow. The tenant_owner gets a one-time authorize URL
   * to open in a popup; Meta's callback returns to the Worker, which then
   * 302s the browser back to `returnTo` with `?meta_state=…` so the UI can
   * call `consume`.
   *
   * Security:
   *   - Only `tenant_owner` (or higher) on the target tenant can start a
   *     connect — `assertTenantOwner` is the bottleneck.
   *   - `returnTo` is required and must be on the admin-app's own origin
   *     so a stolen state can't be used to land users on an attacker page.
   */
  start: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        provider: ProviderEnum,
        returnTo: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "missing_web_user" });
      }

      // Lock returnTo to AUTH_URL — defense in depth so a tampered tRPC call
      // can't redirect through a foreign origin even if the Worker is
      // misconfigured.
      const authBase = (process.env.AUTH_URL ?? "https://admin.manicbot.com").replace(/\/+$/, "");
      const returnUrl = new URL(input.returnTo);
      const authUrl = new URL(authBase);
      if (returnUrl.origin !== authUrl.origin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "returnTo must match the admin-app origin",
        });
      }

      const { workerUrl, adminKey } = workerConfigOrThrow();
      const result = await callWorker<{
        ok: true;
        authUrl: string;
        state: string;
        expiresAt: number;
      }>(workerUrl, adminKey, "/meta/oauth/start", {
        provider: input.provider,
        tenantId: input.tenantId,
        webUserId: ctx.webUser.id,
        returnTo: input.returnTo,
      });

      return {
        authUrl: result.authUrl,
        state: result.state,
        expiresAt: result.expiresAt,
      };
    }),

  /**
   * After Meta returns to the admin-app with `?meta_state=…`, the UI calls
   * this to consume the draft. If the provider is Instagram (or FB with a
   * single IG-linked Page), the channel is auto-created and `autoFinalized`
   * is true. Otherwise the UI receives a page picker payload and the user
   * must call `finalize`.
   */
  consume: protectedProcedure
    .input(z.object({ tenantId: z.string(), state: z.string().length(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "missing_web_user" });
      }

      const { workerUrl, adminKey } = workerConfigOrThrow();
      const result = await callWorker<{
        ok: true;
        autoFinalized: boolean;
        channelConfigId?: string;
        provider?: "instagram" | "facebook";
        graphMe?: { id: string; name?: string; username?: string };
        pages?: Array<{ id: string; name: string; igBusinessId: string | null; igUsername: string | null }>;
        subscribed?: boolean;
        subscribeError?: string | null;
        identity?: Record<string, string | null>;
      }>(workerUrl, adminKey, "/meta/oauth/consume", {
        state: input.state,
        tenantId: input.tenantId,
        webUserId: ctx.webUser.id,
      });

      return result;
    }),

  /**
   * Bind a chosen FB Page from a picker session. Only valid for FB-Login
   * drafts; the Worker enforces the IDOR + draft membership check.
   */
  finalize: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        state: z.string().length(64),
        pageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "missing_web_user" });
      }

      const { workerUrl, adminKey } = workerConfigOrThrow();
      const result = await callWorker<{
        ok: true;
        channelConfigId: string;
        provider: "instagram" | "facebook";
        subscribed: boolean;
        subscribeError: string | null;
        identity: Record<string, string | null>;
      }>(workerUrl, adminKey, "/meta/oauth/finalize", {
        state: input.state,
        tenantId: input.tenantId,
        webUserId: ctx.webUser.id,
        pageId: input.pageId,
      });

      return result;
    }),
});
