import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";

const WORKER_URL = () => (env.WORKER_PUBLIC_URL ?? "").replace(/\/$/, "");
const adminKey = () => env.ADMIN_KEY ?? "";

export const eventsRouter = createTRPCRouter({
  getRecent: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
        type: z.string().optional(),
        tenantId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const base = WORKER_URL();
      const key = adminKey();
      if (!base || !key) {
        // Return empty list when worker URL not configured (dev mode)
        return { events: [] };
      }
      // #S9: ADMIN_KEY moved from query string to Authorization: Bearer header
      // (was leaking to Cloudflare Logpush, browser history, Referer headers).
      const params = new URLSearchParams({ limit: String(input.limit) });
      if (input.type) params.set("type", input.type);
      if (input.tenantId) params.set("tenantId", input.tenantId);

      const res = await fetch(`${base}/admin/events?${params.toString()}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Worker returned ${res.status}`,
        });
      }
      const data = (await res.json()) as { events: unknown[] };
      return data;
    }),

  clear: adminProcedure.mutation(async () => {
    const base = WORKER_URL();
    const key = adminKey();
    if (!base || !key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "WORKER_PUBLIC_URL / ADMIN_KEY not set" });

    const res = await fetch(`${base}/admin/events/clear`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Worker returned ${res.status}` });
    }
    return { ok: true };
  }),
});
