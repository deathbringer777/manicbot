import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";

/**
 * God Mode "Bots" page backend.
 *
 * Thin proxy to the Worker — the Worker owns the bot tokens + crypto, so tokens
 * are NEVER decrypted in the admin-app. `list` surfaces live Telegram webhook
 * status for every bot (so a silently-unregistered webhook — the failure that
 * makes bots go dark — is visible at a glance). `resetWebhook` re-registers a
 * webhook for one bot (per-row button) or all bots (no botId = "fix all").
 *
 * Mirrors the ADMIN_KEY-authenticated Worker-proxy pattern in
 * `marketingAutopilot.ts` (Worker bindings/crypto live in the Worker runtime).
 */

async function callWorker(path: string, init?: RequestInit): Promise<unknown> {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "WORKER_PUBLIC_URL / ADMIN_KEY not configured on admin-app",
    });
  }
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${adminKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new TRPCError({
      code: res.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
      message: `Worker ${path} returned ${res.status}: ${(body as { error?: string }).error ?? text.slice(0, 120)}`,
    });
  }
  return body;
}

const WebhookStatus = z.object({
  ok: z.boolean(),
  set: z.boolean().optional(),
  url: z.string().optional(),
  pending: z.number().optional(),
  lastErrorDate: z.number().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  error: z.string().optional(),
});

const BotRow = z.object({
  botId: z.string(),
  tenantId: z.string().nullable(),
  username: z.string().nullable(),
  active: z.boolean(),
  webhook: WebhookStatus,
});

export type BotRow = z.infer<typeof BotRow>;

export const adminBotsRouter = createTRPCRouter({
  /** All connected bots + their live Telegram webhook status. */
  list: adminProcedure.query(async () => {
    const body = (await callWorker("/admin/bots-status")) as { bots?: unknown };
    const parsed = z.array(BotRow).safeParse(body?.bots ?? []);
    return parsed.success ? parsed.data : [];
  }),

  /** Re-register the Telegram webhook for one bot (botId) or all (omit botId). */
  resetWebhook: adminProcedure
    .input(z.object({ botId: z.string().min(1).max(64).optional() }))
    .mutation(async ({ input }) => {
      const qs = input.botId ? `?botId=${encodeURIComponent(input.botId)}` : "";
      const body = (await callWorker(`/admin/reset-webhooks${qs}`)) as {
        ok?: boolean;
        count?: number;
        results?: unknown;
      };
      return { ok: body?.ok === true, count: body?.count ?? 0, results: body?.results ?? [] };
    }),
});
