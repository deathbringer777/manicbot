"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLang } from "~/components/LangContext";
import {
  COOKIE_BANNER_APPEAR_DELAY_MS,
  markCookieBannerShown,
  readCookieConsent,
  wasCookieBannerShownThisSession,
  writeCookieConsent,
} from "~/lib/cookieConsentStorage";
import { isTelegramInAppContext } from "~/lib/telegramInApp";
import { t } from "~/lib/i18n";

/**
 * Cookie notice — bottom bar, appears after 10s (web and mobile). Choice is stored
 * in localStorage (12 months) so the bar does not re-spam after mobile/WebView
 * sessionStorage resets.
 * Not shown in Telegram (mini app / in-app browser / Telegram WebView) — not all
 * of those expose WebApp.initData, so we use a broader isTelegramInAppContext() check.
 * Not shown to authenticated web users — the banner only targets anonymous visitors.
 */
export function CookieBanner() {
  const { lang } = useLang();
  const { status } = useSession();
  const [shouldShow, setShouldShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isTelegramInAppContext(window)) return;
    if (status === "loading") return;
    if (status === "authenticated") return;
    // Show the banner only if:
    //  1) user has not already made a persistent choice (localStorage), AND
    //  2) the banner has not already been presented in this tab/session.
    // If the user navigated away without deciding, we treat that as "seen"
    // for the rest of the session and won't re-pop on every route change —
    // this matches the one-impression-per-session behaviour used by most
    // major sites. A fresh session (new tab/browser) will show it again
    // until an explicit choice is saved.
    if (readCookieConsent()) return;
    if (wasCookieBannerShownThisSession()) return;
    setShouldShow(true);
  }, [status]);

  useEffect(() => {
    if (!shouldShow) return;
    const id = window.setTimeout(() => {
      setMounted(true);
      markCookieBannerShown();
    }, COOKIE_BANNER_APPEAR_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [shouldShow]);

  if (!shouldShow) return null;

  const decide = (acceptAll: boolean) => {
    writeCookieConsent(acceptAll);
    setMounted(false);
    window.setTimeout(() => setShouldShow(false), 350);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="mb-admin-cookie-title"
      aria-describedby="mb-admin-cookie-body"
      className={[
        "fixed inset-x-0 bottom-0 z-50",
        "transition-all duration-500 ease-out",
        mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <div className="mx-auto max-w-6xl px-3 pb-[env(safe-area-inset-bottom)] sm:px-6">
        <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-md sm:mb-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-2.5 dark:border-white/10 dark:bg-slate-950/70">
          <p
            id="mb-admin-cookie-body"
            className="flex-1 text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300/90"
          >
            <span id="mb-admin-cookie-title" className="sr-only">
              {t("cookies.title", lang)}
            </span>
            {t("cookies.body", lang)}{" "}
            <a
              href={`https://manicbot.com/cookies?lang=${lang}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-violet-600 dark:hover:text-violet-300"
            >
              {t("cookies.policy", lang)}
            </a>
            <span className="mt-1.5 block text-[11px] leading-snug text-slate-500 sm:text-xs dark:text-slate-400/95">
              {t("cookies.necessaryDisclaimer", lang)}
            </span>
          </p>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => decide(false)}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-500 sm:flex-none sm:text-sm dark:border-white/15 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
            >
              {t("cookies.onlyNecessary", lang)}
            </button>
            <button
              type="button"
              onClick={() => decide(true)}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-gradient-to-r from-violet-600 to-cyan-500 px-3 text-xs font-semibold text-white shadow-sm transition hover:from-violet-500 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-violet-500 sm:flex-none sm:text-sm"
            >
              {t("cookies.acceptAll", lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CookieBanner;
