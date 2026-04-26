/**
 * Send a single error report from the browser to /api/error-report.
 *
 * Design notes:
 *   • Uses navigator.sendBeacon when available — survives page-unload
 *     (the user clicking away from the crashed view) which a normal fetch
 *     would not.
 *   • Falls back to fetch with keepalive:true when sendBeacon isn't there.
 *   • Catches and swallows ALL errors locally — an error reporter that
 *     re-throws is a footgun (it would fire its own error boundary).
 *   • Throttles repeats: identical (source, message) pairs within 5s are
 *     coalesced. Without this, a render-loop crash would spam thousands of
 *     reports per second.
 */

type Source = "global-error" | "dashboard-error" | "auth-error" | "public-error" | "trpc-client";

interface ReportPayload {
  source: Source;
  message: string;
  digest?: string;
  url?: string;
  detail?: unknown;
}

const recentlySent = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5000;

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recentlySent.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  recentlySent.set(key, now);
  // Best-effort GC so the map can't grow unbounded over a long session.
  if (recentlySent.size > 64) {
    for (const [k, t] of recentlySent) {
      if (now - t > DEDUPE_WINDOW_MS * 4) recentlySent.delete(k);
    }
  }
  return true;
}

export function reportClientError(
  source: Source,
  error: Error & { digest?: string },
  extra?: Pick<ReportPayload, "detail">,
): void {
  try {
    if (typeof window === "undefined") return;
    const message = error?.message || String(error);
    if (!message) return;

    const key = `${source}::${message.slice(0, 200)}`;
    if (!shouldSend(key)) return;

    const payload: ReportPayload = {
      source,
      message: message.slice(0, 2000),
      digest: error?.digest,
      url: window.location?.href,
      ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
    };

    const body = JSON.stringify(payload);
    const url = "/api/error-report";

    // Preserve the report across page unload — important when the user clicks
    // "Try again" and the boundary unmounts before fetch resolves.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const queued = navigator.sendBeacon(url, blob);
      if (queued) return;
    }

    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      /* swallow — see file header rationale */
    });
  } catch {
    // Reporter must NEVER throw — a failure here just means we lost telemetry,
    // not that the user should see a different error.
  }
}
