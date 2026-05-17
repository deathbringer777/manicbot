"use client";

/**
 * usePushSubscription — Web Push opt-in / opt-out hook for the bell UI.
 *
 * Three states the consumer cares about:
 *   - `support`:      browser supports the Push API at all
 *   - `permission`:   "granted" | "denied" | "default" (browser-level)
 *   - `enabled`:      true when we have an active push_subscriptions row
 *                     for THIS browser endpoint
 *
 * Side-effects:
 *   - `subscribe()` registers /sw.js, calls PushManager.subscribe, then
 *     POSTs the keys to the pushSubscriptions.subscribe mutation.
 *   - `unsubscribe()` calls subscription.unsubscribe + removes the D1 row.
 *
 * The hook never throws. Every failure mode lands in `error` as a short
 * machine string so the UI can decide whether to surface it.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "~/trpc/react";

type PushPermission = "granted" | "denied" | "default";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export interface PushSubscriptionState {
  support: boolean;
  permission: PushPermission;
  enabled: boolean;
  loading: boolean;
  error: string | null;
  vapidEnabled: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushSubscription(): PushSubscriptionState {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const support =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const vapidQuery = api.pushSubscriptions.getVapidPublicKey.useQuery(undefined, {
    enabled: support,
    staleTime: 5 * 60 * 1000,
  });

  const subscribeMut = api.pushSubscriptions.subscribe.useMutation();
  const unsubscribeMut = api.pushSubscriptions.unsubscribe.useMutation();

  // Hydrate permission + existing subscription endpoint on mount.
  useEffect(() => {
    if (!support) return;
    setPermission(Notification.permission as PushPermission);
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) setEndpoint(sub.endpoint);
      } catch (_e) {
        // Best-effort — the UI will offer subscribe again.
      }
    })();
  }, [support]);

  const subscribe = useCallback(async () => {
    if (!support) {
      setError("not_supported");
      return;
    }
    if (!vapidQuery.data?.publicKey) {
      setError("vapid_key_missing");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== "granted") {
        setError(perm === "denied" ? "permission_denied" : "permission_dismissed");
        return;
      }

      const reg =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));

      const existing = await reg.pushManager.getSubscription();
      let sub = existing;
      if (!sub) {
        const key = urlBase64ToUint8Array(vapidQuery.data.publicKey);
        // PushSubscriptionOptionsInit.applicationServerKey is typed as
        // BufferSource (which expects ArrayBuffer, not ArrayBufferLike).
        // Cast through the underlying buffer; runtime accepts any TypedArray.
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key.buffer as ArrayBuffer,
        });
      }
      const json = sub.toJSON();
      const p256dh = (json.keys && json.keys.p256dh) || arrayBufferToBase64(sub.getKey("p256dh"));
      const auth = (json.keys && json.keys.auth) || arrayBufferToBase64(sub.getKey("auth"));
      if (!p256dh || !auth) {
        setError("missing_keys");
        return;
      }
      await subscribeMut.mutateAsync({
        endpoint: sub.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent?.slice(0, 500),
      });
      setEndpoint(sub.endpoint);
    } catch (e: any) {
      setError(e?.message?.slice(0, 200) ?? "subscribe_failed");
    } finally {
      setLoading(false);
    }
  }, [support, vapidQuery.data?.publicKey, subscribeMut]);

  const unsubscribe = useCallback(async () => {
    if (!support) return;
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          try { await sub.unsubscribe(); } catch (_e) { /* ignore */ }
          await unsubscribeMut.mutateAsync({ endpoint: sub.endpoint });
        }
      }
      setEndpoint(null);
    } catch (e: any) {
      setError(e?.message?.slice(0, 200) ?? "unsubscribe_failed");
    } finally {
      setLoading(false);
    }
  }, [support, unsubscribeMut]);

  return {
    support,
    permission,
    enabled: !!endpoint,
    loading,
    error,
    vapidEnabled: !!vapidQuery.data?.enabled,
    subscribe,
    unsubscribe,
  };
}
