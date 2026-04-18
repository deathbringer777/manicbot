"use client";

import { useEffect, useState } from "react";
import { useLang } from "~/components/LangContext";
import {
  COOKIE_BANNER_APPEAR_DELAY_MS,
  readCookieConsent,
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
 */
export function CookieBanner() {
  const { lang } = useLang();
  const [shouldShow, setShouldShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isTelegramInAppContext(window)) return;
    setShouldShow(!readCookieConsent());
  }, []);

  useEffect(() => {
    if (!shouldShow) return;
    const id = window.setTimeout(
      () => setMounted(true),
      COOKIE_BANNER_APPEAR_DELAY_MS,
    );
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
        <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 shadow-lg backdrop-blur-md sm:mb-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-2.5">
          <p
            id="mb-admin-cookie-body"
            className="flex-1 text-xs leading-relaxed text-slate-300/90 sm:text-sm"
          >
            <span id="mb-admin-cookie-title" className="sr-only">
              {t("cookies.title", lang)}
            </span>
            {t("cookies.body", lang)}{" "}
            <a
              href={`https://manicbot.com/cookies?lang=${lang}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-violet-300"
            >
              {t("cookies.policy", lang)}
            </a>
            <span className="mt-1.5 block text-[11px] leading-snug text-slate-400/95 sm:text-xs">
              {t("cookies.necessaryDisclaimer", lang)}
            </span>
          </p>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => decide(false)}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-medium text-white/90 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500 sm:flex-none sm:text-sm"
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
