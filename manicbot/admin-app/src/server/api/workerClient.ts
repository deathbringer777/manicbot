/**
 * Thin HTTP client for calling Worker admin endpoints from tRPC routers.
 * All calls use `Authorization: Bearer ADMIN_KEY` and expect JSON responses.
 */

import { TRPCError } from "@trpc/server";
import { env } from "~/env";

export function workerConfigOrThrow(): { workerUrl: string; adminKey: string } {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Server not configured: WORKER_PUBLIC_URL and ADMIN_KEY are required.",
    });
  }
  return { workerUrl, adminKey };
}

export async function callWorker<T = Record<string, unknown>>(
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
    signal: AbortSignal.timeout(30_000),
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
