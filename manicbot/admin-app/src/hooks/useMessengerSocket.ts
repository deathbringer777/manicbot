"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";

type Frame = {
  type: string;
  tenantId?: string;
  threadId?: string;
  messageId?: string;
  memberRef?: string;
  displayName?: string;
  until?: number;
  [k: string]: unknown;
};

export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface TypingEntry {
  threadId: string;
  memberRef: string;
  displayName: string | null;
  expiresAt: number;
}

export interface MessengerSocket {
  status: WsStatus;
  /** Emit an ephemeral typing hint for a thread (no-op when the socket is down). */
  sendTyping: (threadId: string, memberRef: string, displayName: string | null) => void;
  /** Live typing entries across threads; consumers filter by threadId + self. */
  typing: TypingEntry[];
}

const TYPING_TTL_MS = 6000;

/**
 * Connect to the per-tenant MessengerHub Durable Object via WebSocket and
 * invalidate the relevant tRPC queries on incoming frames. Also relays
 * ephemeral `typing` frames.
 *
 * Falls back to polling (already on each query) when WS_TOKEN_SECRET isn't
 * configured, the connection fails (exponential backoff up to 30s), or the
 * browser is offline. Mounting this hook is additive — it never breaks polling.
 *
 * @param tenantId effective tenantId; null disables the socket entirely
 */
export function useMessengerSocket(tenantId: string | null): MessengerSocket {
  const utils = api.useUtils();
  const issueToken = api.messenger.issueWsToken.useMutation();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const attempts = useRef(0);
  const [status, setStatus] = useState<WsStatus>("idle");
  const [typing, setTyping] = useState<TypingEntry[]>([]);
  // Sticky flag: PRECONDITION_FAILED (WS_TOKEN_SECRET unset) means realtime is
  // permanently unavailable this session — stop reconnect spam.
  const realtimeDisabled = useRef(false);

  const sendTyping = useCallback(
    (threadId: string, memberRef: string, displayName: string | null) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            type: "typing",
            threadId,
            memberRef,
            displayName,
            until: Date.now() + TYPING_TTL_MS,
          }),
        );
      } catch {
        /* socket closing — drop */
      }
    },
    [],
  );

  // Prune expired typing entries while any are present (no idle timer).
  useEffect(() => {
    if (typing.length === 0) return;
    const id = window.setInterval(() => {
      setTyping((prev) => prev.filter((e) => e.expiresAt > Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [typing.length]);

  useEffect(() => {
    if (!tenantId || typeof window === "undefined") return;
    let cancelled = false;

    async function connect() {
      if (cancelled || realtimeDisabled.current) return;
      setStatus("connecting");
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
          setStatus("open");
        });

        ws.addEventListener("message", (event) => {
          let frame: Frame | null = null;
          try {
            frame = JSON.parse(String(event.data)) as Frame;
          } catch {
            return;
          }
          if (!frame || typeof frame !== "object") return;
          if (frame.tenantId && frame.tenantId !== tenantId) return;
          if (frame.type === "message.new") {
            if (frame.threadId) {
              void utils.messenger.getThread.invalidate({
                tenantId: tenantId!,
                threadId: frame.threadId,
              });
            }
            void utils.messenger.listThreads.invalidate({ tenantId: tenantId! });
          } else if (frame.type === "thread.updated") {
            void utils.messenger.listThreads.invalidate({ tenantId: tenantId! });
          } else if (frame.type === "typing" && frame.threadId && frame.memberRef) {
            const entry: TypingEntry = {
              threadId: String(frame.threadId),
              memberRef: String(frame.memberRef),
              displayName: typeof frame.displayName === "string" ? frame.displayName : null,
              expiresAt: typeof frame.until === "number" ? frame.until : Date.now() + TYPING_TTL_MS,
            };
            setTyping((prev) => [
              ...prev.filter(
                (e) => !(e.threadId === entry.threadId && e.memberRef === entry.memberRef),
              ),
              entry,
            ]);
          }
        });

        ws.addEventListener("close", () => {
          setStatus("closed");
          if (cancelled) return;
          scheduleReconnect();
        });

        ws.addEventListener("error", () => {
          setStatus("error");
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        });
      } catch (e) {
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
          setStatus("closed");
          return;
        }
        setStatus("error");
        // eslint-disable-next-line no-console
        console.warn("[messenger ws] token mint failed; polling fallback", e);
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      attempts.current += 1;
      const backoff = Math.min(30_000, 1000 * Math.pow(2, attempts.current - 1));
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
      setStatus("idle");
    };
    // `utils` / `issueToken` are stable tRPC hook refs — intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return { status, sendTyping, typing };
}
