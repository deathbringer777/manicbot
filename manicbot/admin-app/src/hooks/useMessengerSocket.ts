"use client";

import { useEffect, useRef } from "react";
import { api } from "~/trpc/react";

type Frame = {
  type: string;
  tenantId?: string;
  threadId?: string;
  messageId?: string;
  [k: string]: unknown;
};

/**
 * Connect to the per-tenant MessengerHub Durable Object via WebSocket and
 * invalidate the relevant tRPC queries on incoming frames.
 *
 * Falls back to polling (already on each query) when:
 *   - WS_TOKEN_SECRET isn't configured (issueWsToken throws → swallowed)
 *   - Connection fails (reconnects with exponential backoff up to 30s)
 *   - Browser is offline (the socket stays closed; polling carries the UI)
 *
 * Mounting this hook is additive — it never breaks the polling story.
 *
 * @param tenantId - effective tenantId; null disables the socket entirely
 */
export function useMessengerSocket(tenantId: string | null): {
  status: "idle" | "connecting" | "open" | "closed" | "error";
} {
  const utils = api.useUtils();
  const issueToken = api.messenger.issueWsToken.useMutation();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const attempts = useRef(0);
  const statusRef = useRef<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  // Sticky flag: when the server returns PRECONDITION_FAILED (WS_TOKEN_SECRET
  // is unset on the deploy), realtime is permanently unavailable for this
  // session. Without this, exponential backoff would keep firing
  // issueWsToken every 1→2→4→…→30s, spamming the console + tRPC inspector.
  const realtimeDisabled = useRef(false);

  useEffect(() => {
    if (!tenantId || typeof window === "undefined") return;
    let cancelled = false;

    async function connect() {
      if (cancelled || realtimeDisabled.current) return;
      statusRef.current = "connecting";
      try {
        const { token } = await issueToken.mutateAsync({ tenantId: tenantId! });
        if (cancelled) return;
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${proto}//${window.location.host}/ws/messenger/${encodeURIComponent(
          tenantId!,
        )}?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          attempts.current = 0;
          statusRef.current = "open";
        });

        ws.addEventListener("message", (event) => {
          let frame: Frame | null = null;
          try {
            frame = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (!frame || typeof frame !== "object") return;
          // Defense-in-depth: the DO is per-tenant, but verify regardless.
          if (frame.tenantId && frame.tenantId !== tenantId) return;
          if (frame.type === "message.new") {
            // New message — refresh the affected thread and the inbox list.
            if (frame.threadId) {
              void utils.messenger.getThread.invalidate({
                tenantId: tenantId!,
                threadId: frame.threadId,
              });
            }
            void utils.messenger.listThreads.invalidate({ tenantId: tenantId! });
          } else if (frame.type === "thread.updated") {
            void utils.messenger.listThreads.invalidate({ tenantId: tenantId! });
          }
        });

        ws.addEventListener("close", () => {
          statusRef.current = "closed";
          if (cancelled) return;
          scheduleReconnect();
        });

        ws.addEventListener("error", () => {
          statusRef.current = "error";
          // close handler will schedule the reconnect
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        });
      } catch (e) {
        // tRPC PRECONDITION_FAILED → WS_TOKEN_SECRET unset → realtime is
        // disabled by config, NOT a transient failure. Stop reconnecting so
        // we don't burn a token-mint round-trip every backoff tick.
        const code =
          (e as { data?: { code?: string } } | null)?.data?.code ??
          (e as { shape?: { data?: { code?: string } } } | null)?.shape?.data?.code;
        if (code === "PRECONDITION_FAILED") {
          if (!realtimeDisabled.current) {
            realtimeDisabled.current = true;
            // eslint-disable-next-line no-console
            console.warn(
              "[messenger ws] realtime disabled (WS_TOKEN_SECRET unset); polling fallback active",
            );
          }
          statusRef.current = "closed";
          return;
        }
        // Transient failure (network, server error, etc.) — back off and retry.
        statusRef.current = "error";
        // eslint-disable-next-line no-console
        console.warn("[messenger ws] token mint failed; polling fallback", e);
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      attempts.current += 1;
      const backoff = Math.min(30_000, 1000 * Math.pow(2, attempts.current - 1));
      // On reconnect, also invalidate caches so the UI catches up on
      // anything that happened during the gap.
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(() => {
        void utils.messenger.listThreads.invalidate({ tenantId: tenantId! });
        void connect();
      }, backoff);
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      statusRef.current = "idle";
    };
    // We intentionally do NOT include `utils` / `issueToken` — those are
    // stable references from tRPC's hook factory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return { status: statusRef.current };
}
