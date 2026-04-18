"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

const STORAGE_KEY = "mb-admin-cookie-consent-v1";
const EXPIRY_MS = 12 * 30 * 24 * 60 * 60 * 1000;

type Record = { version: 1; decidedAt: number; acceptedAll: boolean };

function read(): Record | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Record>;
    if (p.version !== 1 || typeof p.decidedAt !== "number") return null;
    if (Date.now() - p.decidedAt > EXPIRY_MS) return null;
    return p as Record;
  } catch {
    return null;
  }
}

function write(acceptedAll: boolean): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, decidedAt: Date.now(), acceptedAll }),
    );
  } catch {}
}

function isTelegramWebApp(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = (window as any).Telegram?.WebApp;
  return !!tg?.initData;
}

/**
 * GDPR-compliant cookie notice for the admin app.
 *
 * Admin app uses only strictly-necessary cookies (next-auth session, theme, language),
 * but we surface the notice for transparency and parity with the landing.
 * Not shown inside the Telegram WebApp embed.
 */
export function CookieBanner() {
  const { lang } = useLang();
  const [visible, setVisible] = useState(false);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isTelegramWebApp()) return;
    setVisible(!read());
  }, []);

  useEffect(() => {
    if (visible) primaryRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const decide = (acceptAll: boolean) => {
    write(acceptAll);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="mb-admin-cookie-title"
      aria-describedby="mb-admin-cookie-body"
      className="fixed inset-x-3 bottom-3 z-50 md:inset-x-auto md:right-6 md:bottom-6 md:max-w-md"
    >
      <div className="rounded-2xl border border-white/10 bg-slate-900/95 p-5 shadow-2xl backdrop-blur-md">
        <h2 id="mb-admin-cookie-title" className="text-base font-semibold text-white">
          {t("cookies.title", lang)}
        </h2>
        <p id="mb-admin-cookie-body" className="mt-2 text-sm leading-relaxed text-slate-300">
          {t("cookies.body", lang)}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            ref={primaryRef}
            type="button"
            onClick={() => decide(true)}
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-violet-500 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            {t("cookies.acceptAll", lang)}
          </button>
          <button
            type="button"
            onClick={() => decide(false)}
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            {t("cookies.onlyNecessary", lang)}
          </button>
        </div>

        <div className="mt-3 text-xs">
          <a
            href={`https://manicbot.com/cookies?lang=${lang}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 underline-offset-2 hover:underline"
          >
            {t("cookies.policy", lang)}
          </a>
        </div>
      </div>
    </div>
  );
}

export default CookieBanner;
