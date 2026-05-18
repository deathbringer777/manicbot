"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Instagram, Loader2, CheckCircle, AlertCircle, ChevronDown, ExternalLink,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { MetaGuide } from "~/components/settings/MetaGuide";

type PickerPage = { id: string; name: string; igBusinessId: string | null; igUsername: string | null };

interface Props {
  tenantId: string;
  onConnected: () => void;
}

/**
 * OAuth-first Instagram connect surface. Replaces the manual token-paste
 * form. Two primary actions: "Sign in with Instagram" (IGAA tokens via
 * graph.instagram.com) and "Sign in with Facebook Page" (legacy
 * EAA-via-Page route). The user-friendly path puts Instagram first; the
 * "Advanced" details block at the bottom keeps the manual token paste as
 * an escape hatch for tenants who already have a token in hand.
 *
 * Wire flow (popup mode, default):
 *
 *   click → window.open('about:blank', 'meta-oauth') synchronously (avoids
 *           the popup-blocker) → tRPC.metaOAuth.start({popup:true}) →
 *           popup.location = data.authUrl
 *   Meta redirects popup → /meta/{provider}/callback → Worker renders HTML
 *           that postMessages the opener and closes itself
 *   message handler verifies event.origin === callbackOrigin AND
 *           event.data.meta_state matches the pending state → consume
 *     - autoFinalized: true → success, onConnected()
 *     - autoFinalized: false (FB multi-page) → open Page picker modal →
 *       user picks → tRPC.metaOAuth.finalize → onConnected()
 *
 * Fallback (popup blocked):
 *   click → window.open returns null/closed → tRPC.metaOAuth.start({popup:false}) →
 *           window.location.href = data.authUrl (legacy top-level flow);
 *           mount-time useSearchParams handler picks up the round-trip.
 */
type PendingFlow = {
  state: string;
  callbackOrigin: string;
  popupWindow: Window | null;
  popupTimer: ReturnType<typeof setInterval> | null;
};

export function InstagramConnect({ tenantId, onConnected }: Props) {
  const { lang } = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pendingProvider, setPendingProvider] = useState<"instagram" | "facebook" | null>(null);
  const [phase, setPhase] = useState<"idle" | "opening" | "completing" | "picking" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ state: string; pages: PickerPage[] } | null>(null);

  const startMut = api.metaOAuth.start.useMutation();
  const consumeMut = api.metaOAuth.consume.useMutation();
  const finalizeMut = api.metaOAuth.finalize.useMutation();

  // Holds the in-flight popup flow so the message handler can validate
  // origin + state and the close-watcher can detect user-cancelled popups.
  const pendingRef = useRef<PendingFlow | null>(null);

  // Compute returnTo from the current window (must match AUTH_URL origin
  // server-side). We strip oauth-related params so a refresh during
  // consume doesn't re-trigger the loop.
  const buildReturnTo = useCallback(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.delete("meta_state");
    url.searchParams.delete("meta_ok");
    url.searchParams.delete("meta_error");
    url.searchParams.delete("meta_error_description");
    // Ensure the user lands back on the Channels tab after the round-trip.
    if (!url.searchParams.get("tab")) url.searchParams.set("tab", "channels");
    return url.toString();
  }, []);

  const clearMetaParams = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let touched = false;
    for (const k of ["meta_state", "meta_ok", "meta_error", "meta_error_description"]) {
      if (url.searchParams.has(k)) { url.searchParams.delete(k); touched = true; }
    }
    if (touched) router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  // Shared consume runner — same code path for both the popup postMessage
  // intake AND the legacy mount-time URL-params intake. Centralizing it
  // means the two surfaces can never drift on behaviour.
  const consumedStateRef = useRef<string | null>(null);
  const runConsume = useCallback((state: string) => {
    if (consumedStateRef.current === state) return;
    consumedStateRef.current = state;
    setPhase("completing");
    consumeMut.mutate(
      { tenantId, state },
      {
        onSuccess: (data) => {
          if (data.autoFinalized) {
            setPhase("success");
            onConnected();
          } else if (Array.isArray(data.pages)) {
            setPicker({ state, pages: data.pages as PickerPage[] });
            setPhase("picking");
          } else {
            setPhase("error");
            setErrorMessage("unexpected_consume_response");
          }
        },
        onError: (e) => {
          if (e.data?.code === "NOT_FOUND") {
            setErrorMessage(t("channels.ig.oauth.expired", lang));
          } else {
            setErrorMessage(e.message);
          }
          setPhase("error");
        },
      },
    );
  }, [tenantId, consumeMut, onConnected, lang]);

  const finishPendingFlow = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.popupTimer) clearInterval(pending.popupTimer);
    // Belt-and-suspenders close — the popup HTML calls window.close() itself
    // but some browsers ignore that for non-script-opened or off-screen
    // windows. Closing from the opener side guarantees no orphan popup.
    if (pending.popupWindow && !pending.popupWindow.closed) {
      try { pending.popupWindow.close(); } catch { /* ignore */ }
    }
    pendingRef.current = null;
  }, []);

  // ── postMessage bridge: popup -> opener ─────────────────────────────────

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const pending = pendingRef.current;
      if (!pending) return;
      // Trust gates — both must pass:
      //   (a) origin must match the Worker callback origin we minted with
      //   (b) the state must be the one we're waiting for
      // Either one alone is enough on paper, but doing both means a
      // misbehaving extension or a same-origin XSS still can't ride this.
      if (event.origin !== pending.callbackOrigin) return;
      const data = (event.data ?? {}) as {
        source?: string;
        meta_ok?: string;
        meta_state?: string;
        meta_error?: string;
        meta_error_description?: string;
      };
      if (data.source !== "manicbot-meta-oauth") return;
      if (data.meta_state !== pending.state) return;

      finishPendingFlow();

      if (data.meta_ok !== "1") {
        setErrorMessage(
          data.meta_error === "access_denied"
            ? t("channels.ig.oauth.cancelledByUser", lang)
            : (data.meta_error_description || data.meta_error || t("channels.ig.oauth.expired", lang)),
        );
        setPhase("error");
        return;
      }
      runConsume(pending.state);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [runConsume, finishPendingFlow, lang]);

  useEffect(() => () => finishPendingFlow(), [finishPendingFlow]);

  // ── Mount-time URL params intake (popup-blocker fallback path) ──────────

  useEffect(() => {
    const state = searchParams.get("meta_state");
    const ok = searchParams.get("meta_ok");
    const err = searchParams.get("meta_error");

    if (!state) return;
    if (consumedStateRef.current === state) return;

    if (ok !== "1") {
      consumedStateRef.current = state;
      setErrorMessage(err === "access_denied"
        ? t("channels.ig.oauth.cancelledByUser", lang)
        : (searchParams.get("meta_error_description") || err || t("channels.ig.oauth.expired", lang)));
      setPhase("error");
      clearMetaParams();
      return;
    }

    runConsume(state);
    clearMetaParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tenantId]);

  // ── Start OAuth ─────────────────────────────────────────────────────────

  /**
   * Opens an OAuth popup synchronously (must happen inside the user-gesture
   * callback or the browser blocks it), then asynchronously navigates the
   * popup to the Meta authorize URL once the start mutation comes back.
   * If the popup is blocked → graceful fallback to top-level navigation
   * with `popup:false`, where the mount-time handler picks up the round-trip.
   */
  const handleStart = useCallback((provider: "instagram" | "facebook") => {
    setPendingProvider(provider);
    setPhase("opening");
    setErrorMessage(null);

    // 1. Open the placeholder popup synchronously so popup-blockers see a
    //    user gesture. We navigate it to authUrl below once start resolves.
    let popupWindow: Window | null = null;
    try {
      popupWindow = window.open(
        "about:blank",
        "meta-oauth",
        "width=600,height=720,menubar=no,toolbar=no,location=no,status=no",
      );
    } catch {
      popupWindow = null;
    }
    const popupOk = !!popupWindow && !popupWindow.closed;
    const usePopup = popupOk;

    startMut.mutate(
      { tenantId, provider, returnTo: buildReturnTo(), popup: usePopup },
      {
        onSuccess: (data) => {
          if (usePopup && popupWindow) {
            try {
              popupWindow.location.href = data.authUrl;
            } catch {
              // Cross-origin write can fail in some environments; fall through
              // to top-level navigation so the user can still finish.
              try { popupWindow.close(); } catch { /* ignore */ }
              window.location.href = data.authUrl;
              return;
            }
            // Watch for the user closing the popup without authorizing.
            const timer = setInterval(() => {
              const pending = pendingRef.current;
              if (!pending) {
                clearInterval(timer);
                return;
              }
              if (pending.popupWindow && pending.popupWindow.closed) {
                clearInterval(timer);
                // Only flip to error if we never received a message — the
                // postMessage handler nulls pendingRef on success.
                if (pendingRef.current && pendingRef.current.state === data.state) {
                  pendingRef.current = null;
                  setPhase((p) => (p === "completing" || p === "picking" || p === "success" ? p : "idle"));
                  setPendingProvider(null);
                }
              }
            }, 500);
            pendingRef.current = {
              state: data.state,
              callbackOrigin: data.callbackOrigin,
              popupWindow,
              popupTimer: timer,
            };
          } else {
            // No popup available (blocked / about:blank refused / inside a
            // strict embed) — full-page navigation, mount-time handler picks
            // up the round-trip.
            window.location.href = data.authUrl;
          }
        },
        onError: (e) => {
          // Close any popup we opened pre-flight so it doesn't dangle.
          if (popupWindow && !popupWindow.closed) { try { popupWindow.close(); } catch { /* ignore */ } }
          setErrorMessage(e.message);
          setPhase("error");
          setPendingProvider(null);
        },
      },
    );
  }, [tenantId, startMut, buildReturnTo]);

  const handlePagePick = useCallback((pageId: string) => {
    if (!picker) return;
    setPhase("completing");
    finalizeMut.mutate(
      { tenantId, state: picker.state, pageId },
      {
        onSuccess: () => {
          setPicker(null);
          setPhase("success");
          onConnected();
        },
        onError: (e) => {
          setErrorMessage(e.message);
          setPhase("error");
        },
      },
    );
  }, [picker, tenantId, finalizeMut, onConnected]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
            <Instagram className="h-5 w-5 text-pink-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("channels.ig.oauth.title", lang)}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("channels.ig.oauth.subtitle", lang)}</p>
          </div>
        </div>

        {/* Status surface — single source of truth for in-flight UX */}
        {phase === "opening" && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-white/[0.06] px-3 py-2.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("channels.ig.oauth.opening", lang)}
          </div>
        )}
        {phase === "completing" && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-white/[0.06] px-3 py-2.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("channels.ig.oauth.completing", lang)}
          </div>
        )}
        {phase === "success" && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle className="h-3.5 w-3.5" /> {t("channels.ig.oauth.success", lang)}
          </div>
        )}
        {phase === "error" && errorMessage && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 flex items-start gap-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* OAuth buttons — Instagram primary, Facebook secondary */}
        <div className="space-y-2.5">
          <button
            type="button"
            disabled={phase === "opening" || phase === "completing"}
            onClick={() => handleStart("instagram")}
            data-testid="ig-oauth-instagram-btn"
            className="w-full group relative flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm font-semibold shadow-lg shadow-pink-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pendingProvider === "instagram" && phase === "opening"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Instagram className="h-4 w-4" />}
            <span className="flex-1 text-left">{t("channels.ig.oauth.signInIg", lang)}</span>
            <span className="text-[10px] bg-white/20 rounded-full px-2 py-0.5">{t("channels.ig.oauth.recommended", lang)}</span>
          </button>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">{t("channels.ig.oauth.igHint", lang)}</p>

          <button
            type="button"
            disabled={phase === "opening" || phase === "completing"}
            onClick={() => handleStart("facebook")}
            data-testid="ig-oauth-facebook-btn"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/50 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pendingProvider === "facebook" && phase === "opening"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <svg className="h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.198 21.5h4v-8.01h3.604l.396-3.98h-4V7.5a1 1 0 011-1h3v-4h-3a5 5 0 00-5 5v2.01h-2l-.396 3.98h2.396v8.01z"/></svg>}
            <span className="flex-1 text-left">{t("channels.ig.oauth.signInFb", lang)}</span>
          </button>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">{t("channels.ig.oauth.fbHint", lang)}</p>
        </div>
      </section>

      {/* Manual paste — collapsed escape hatch for tenants with a ready token. */}
      <details className="glass-card rounded-2xl overflow-hidden">
        <summary className="cursor-pointer list-none flex items-center gap-2 px-5 py-3.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          {t("channels.ig.manual.title", lang)}
        </summary>
        <div className="border-t border-slate-200 dark:border-white/[0.06] px-5 py-4 space-y-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("channels.ig.manual.note", lang)}</p>
          <ManualPasteForm tenantId={tenantId} onConnected={onConnected} />
        </div>
      </details>

      <MetaGuide channel="instagram" />

      {picker && (
        <PagePickerModal
          pages={picker.pages}
          onPick={handlePagePick}
          onClose={() => { setPicker(null); setPhase("idle"); }}
          busy={finalizeMut.isPending}
        />
      )}
    </div>
  );
}

// ─── Manual paste form (escape hatch, unchanged behavior) ────────────────────

function ManualPasteForm({ tenantId, onConnected }: { tenantId: string; onConnected: () => void }) {
  const { lang } = useLang();
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [igAccountId, setIgAccountId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connectMut = api.salon.connectInstagram.useMutation({
    onSuccess: () => {
      setToken(""); setPageId(""); setIgAccountId(""); setBusinessId(""); setError(null);
      onConnected();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        connectMut.mutate({
          tenantId,
          token: token.trim(),
          pageId: pageId.trim(),
          igAccountId: igAccountId.trim() || undefined,
          instagramBusinessId: businessId.trim() || undefined,
        });
      }}
      className="space-y-3"
    >
      {[
        { label: "Page Access Token", value: token, onChange: setToken, placeholder: "EAAxxxxx or IGAAxxxxx", required: true },
        { label: "Facebook Page ID", value: pageId, onChange: setPageId, placeholder: "123456789012345", required: true },
        { label: t("channels.igAccountId", lang), value: igAccountId, onChange: setIgAccountId, placeholder: "17841437...", required: false },
        { label: t("channels.igBusinessId", lang), value: businessId, onChange: setBusinessId, placeholder: "25881183...", required: false },
      ].map((f) => (
        <div key={f.label}>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{f.label}</label>
          <input
            type="text" value={f.value} onChange={(e) => f.onChange(e.target.value)}
            placeholder={f.placeholder} required={f.required}
            className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-pink-500/60 text-slate-900 dark:text-white font-mono"
          />
        </div>
      ))}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={connectMut.isPending || !token.trim() || !pageId.trim()}
        className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 text-sm font-medium rounded-xl transition-all disabled:opacity-70"
      >
        {connectMut.isPending
          ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("channels.connecting", lang)}</>
          : <><Instagram className="h-4 w-4" /> {t("channels.connectIg", lang)}</>}
      </button>
    </form>
  );
}

// ─── Page picker modal (FB multi-page flow) ──────────────────────────────────

function PagePickerModal({
  pages, onPick, onClose, busy,
}: {
  pages: PickerPage[];
  onPick: (pageId: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { lang } = useLang();
  return (
    <div
      data-testid="meta-page-picker"
      className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md flex items-center justify-center px-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-black/5 shadow-2xl p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{t("channels.ig.picker.title", lang)}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("channels.ig.picker.subtitle", lang)}</p>
        </div>

        {pages.length === 0 ? (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-3 text-xs text-amber-400 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-px shrink-0" />
            <span>{t("channels.ig.picker.empty", lang)}</span>
          </div>
        ) : (
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
            {pages.map((p) => {
              const hasIg = !!p.igBusinessId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!hasIg || busy}
                    onClick={() => onPick(p.id)}
                    className={`w-full text-left rounded-xl border px-3.5 py-3 transition-colors ${
                      hasIg
                        ? "border-slate-200 dark:border-slate-700/60 hover:border-pink-500/40 hover:bg-pink-500/5"
                        : "border-slate-200 dark:border-slate-800 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {hasIg
                            ? <>@{p.igUsername || p.igBusinessId} · {t("channels.ig.picker.linked", lang)}</>
                            : t("channels.ig.picker.noIg", lang)}
                        </p>
                      </div>
                      {hasIg && (
                        <span className="shrink-0 text-[10px] font-medium rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-400 inline-flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> IG
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-50"
          >
            {t("common.cancel", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
