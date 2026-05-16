"use client";

import { Clock, AlertTriangle } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

interface TrialBannerProps {
  trialEndsAt: number | null;
  nowUnix?: number;
  lang: Lang;
}

const TRIAL_TOTAL_SECONDS = 14 * 24 * 60 * 60;

function pluralizeDays(n: number, lang: Lang): string {
  if (lang === "ru" || lang === "ua") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return t("billing.trial.day1", lang);
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t("billing.trial.dayFew", lang).replace("{n}", String(n));
    return t("billing.trial.dayMany", lang).replace("{n}", String(n));
  }
  if (n === 1) return t("billing.trial.day1", lang);
  return t("billing.trial.dayMany", lang).replace("{n}", String(n));
}

export function TrialBanner({ trialEndsAt, nowUnix, lang }: TrialBannerProps) {
  if (!trialEndsAt) return null;
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  const secondsLeft = trialEndsAt - now;

  if (secondsLeft <= 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-trial-state="expired"
        className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-900/20"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">
              {t("billing.trial.expired", lang)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const daysLeft = Math.max(1, Math.ceil(secondsLeft / 86400));
  const hoursLeft = Math.floor(secondsLeft / 3600);
  const isEndsToday = hoursLeft < 24;
  const isUrgent = daysLeft <= 3;
  const pctElapsed = Math.min(100, Math.max(0, ((TRIAL_TOTAL_SECONDS - secondsLeft) / TRIAL_TOTAL_SECONDS) * 100));

  const headline = isEndsToday
    ? t("billing.trial.endsToday", lang)
    : t("billing.trial.daysLeft", lang).replace("{n}", pluralizeDays(daysLeft, lang));

  return (
    <div
      role="status"
      aria-live="polite"
      data-trial-state={isUrgent ? "urgent" : "ok"}
      className={`rounded-2xl border px-4 py-3 ${
        isUrgent
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20"
          : "border-violet-200 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/[0.08]"
      }`}
    >
      <div className="flex items-start gap-3">
        <Clock
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            isUrgent ? "text-amber-600 dark:text-amber-400" : "text-violet-600 dark:text-violet-300"
          }`}
        />
        <div className="flex-1 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p
              className={`text-sm font-semibold ${
                isUrgent ? "text-amber-900 dark:text-amber-200" : "text-violet-900 dark:text-violet-100"
              }`}
            >
              {headline}
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(pctElapsed)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pctElapsed}%`,
                background: isUrgent
                  ? "linear-gradient(90deg,#f59e0b,#f97316)"
                  : "linear-gradient(90deg,#7c3aed,#06b6d4)",
              }}
            />
          </div>
          {isUrgent && (
            <p className="text-xs text-amber-800 dark:text-amber-300/80">
              {t("billing.trial.endingSoon", lang)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
