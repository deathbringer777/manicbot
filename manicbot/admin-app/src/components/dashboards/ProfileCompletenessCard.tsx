"use client";

/**
 * ProfileCompletenessCard — Booksy-parity gamification widget on the
 * salon Overview tab.
 *
 *   ┌─ Профиль готов на 5/8 ────────────────────── 62% ──┐
 *   │ ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░ │
 *   │ Уровень: «Apprentice»                              │
 *   │                                                    │
 *   │ Доделай чтобы стать «Pro»:                         │
 *   │   ◯ Логотип салона      → Настройки →              │
 *   │   ◯ Обложка             → Настройки →              │
 *   │   ◯ Активируй публ. проф → Публичный профиль →     │
 *   └────────────────────────────────────────────────────┘
 *
 * Reads from `salon.getOverview.profileCompleteness`. Each step is a
 * boolean signal (or count threshold). Score = filled count, level
 * derived from score brackets (Booksy uses Novice / Apprentice / Pro /
 * Master / Legend; we use the same vocabulary, localized).
 *
 * Each unfilled step has a deep-link target tab so the salon owner can
 * click straight into the section to fix it.
 */

import { useMemo } from "react";
import { CheckCircle2, Circle, ChevronRight, Sparkles } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

interface Signals {
  hasName: boolean;
  hasDescription: boolean;
  hasCity: boolean;
  hasLogo: boolean;
  hasCoverPhoto: boolean;
  publicActive: boolean;
  servicesCount: number;
  mastersCount: number;
}

interface Step {
  id: string;
  filled: boolean;
  labelKey: string;
  /** target tab name in SalonDashboard so the owner can jump there */
  targetTab: string;
}

interface Props {
  lang: Lang;
  signals: Signals;
  onJumpToTab: (tab: string) => void;
}

function levelForScore(score: number, total: number): "novice" | "apprentice" | "pro" | "master" | "legend" {
  const pct = total > 0 ? score / total : 0;
  if (pct >= 1) return "legend";
  if (pct >= 0.8) return "master";
  if (pct >= 0.6) return "pro";
  if (pct >= 0.3) return "apprentice";
  return "novice";
}

const LEVEL_TONE: Record<string, { ring: string; text: string; bg: string }> = {
  novice:     { ring: "ring-slate-300 dark:ring-slate-600",   text: "text-slate-500 dark:text-slate-400", bg: "from-slate-400/40 to-slate-500/40" },
  apprentice: { ring: "ring-cyan-400 dark:ring-cyan-500",     text: "text-cyan-600 dark:text-cyan-400",   bg: "from-cyan-400 to-sky-500" },
  pro:        { ring: "ring-brand-500 dark:ring-brand-400",   text: "text-brand-600 dark:text-brand-400", bg: "from-brand-500 to-purple-500" },
  master:     { ring: "ring-emerald-400 dark:ring-emerald-500", text: "text-emerald-600 dark:text-emerald-400", bg: "from-emerald-400 to-teal-500" },
  legend:     { ring: "ring-amber-400 dark:ring-amber-500",   text: "text-amber-600 dark:text-amber-400", bg: "from-amber-400 to-orange-500" },
};

export function ProfileCompletenessCard({ lang, signals, onJumpToTab }: Props) {
  const steps: Step[] = useMemo(
    () => [
      { id: "name",        filled: signals.hasName,                labelKey: "completeness.name",        targetTab: "settings" },
      { id: "description", filled: signals.hasDescription,         labelKey: "completeness.description", targetTab: "settings" },
      { id: "city",        filled: signals.hasCity,                labelKey: "completeness.city",        targetTab: "settings" },
      { id: "logo",        filled: signals.hasLogo,                labelKey: "completeness.logo",        targetTab: "settings" },
      { id: "cover",       filled: signals.hasCoverPhoto,          labelKey: "completeness.cover",       targetTab: "public_profile" },
      { id: "services",    filled: signals.servicesCount >= 3,     labelKey: "completeness.services",    targetTab: "services" },
      { id: "masters",     filled: signals.mastersCount >= 1,      labelKey: "completeness.masters",     targetTab: "masters" },
      { id: "public",      filled: signals.publicActive,           labelKey: "completeness.public",      targetTab: "public_profile" },
    ],
    [signals],
  );
  const total = steps.length;
  const score = steps.filter((s) => s.filled).length;
  const pct = Math.round((score / total) * 100);
  const level = levelForScore(score, total);
  const tone = LEVEL_TONE[level]!;

  if (score === total) {
    // Hide the card once the salon hits 8/8 — the gamification is done.
    return null;
  }

  const unfilled = steps.filter((s) => !s.filled);

  return (
    <section
      data-testid="profile-completeness-card"
      data-level={level}
      data-score={score}
      className="glass-card rounded-2xl p-4 sm:p-5 space-y-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ring-2 ring-offset-0 ${tone.ring} bg-white/40 dark:bg-white/[0.04]`}>
            <Sparkles className={`h-4 w-4 ${tone.text}`} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {t("completeness.title", lang)}{" "}
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                {score}/{total}
              </span>
            </p>
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${tone.text}`}>
              {t(`completeness.level.${level}` as any, lang)}
            </p>
          </div>
        </div>
        <span className="text-xl font-bold tabular-nums text-slate-900 dark:text-white shrink-0">
          {pct}%
        </span>
      </header>

      <div className="h-2 rounded-full bg-slate-200 dark:bg-white/[0.06] overflow-hidden" data-testid="profile-completeness-bar">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone.bg} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {unfilled.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            {t("completeness.toDo", lang)}
          </p>
          <ul className="space-y-1">
            {unfilled.slice(0, 4).map((step) => (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onJumpToTab(step.targetTab)}
                  data-testid="profile-completeness-step"
                  data-step-id={step.id}
                  data-filled="0"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
                >
                  <Circle className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                  <span className="flex-1 truncate">{t(step.labelKey as any, lang)}</span>
                  <ChevronRight className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
                </button>
              </li>
            ))}
            {unfilled.length > 4 && (
              <li className="text-[10px] text-slate-400 dark:text-slate-500 px-3 pt-1">
                +{unfilled.length - 4}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Filled steps for psychological reinforcement — collapsed details */}
      <details className="group">
        <summary className="text-[11px] text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform">▸</span>
          {t("completeness.alreadyDone", lang)}: {score}
        </summary>
        <ul className="mt-2 space-y-0.5 pl-2">
          {steps.filter((s) => s.filled).map((step) => (
            <li
              key={step.id}
              data-testid="profile-completeness-step"
              data-step-id={step.id}
              data-filled="1"
              className="flex items-center gap-2 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
              <span className="truncate">{t(step.labelKey as any, lang)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
