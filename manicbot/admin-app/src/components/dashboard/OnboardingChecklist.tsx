"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  tenantId: string;
}

type Step = {
  id: string;
  labelKey:
    | "onboarding.checklist.connect_bot"
    | "onboarding.checklist.add_master"
    | "onboarding.checklist.set_master_schedule"
    | "onboarding.checklist.add_service"
    | "onboarding.checklist.fill_salon_info"
    | "onboarding.checklist.add_branding"
    | "onboarding.checklist.activate_public"
    | "onboarding.checklist.share_link";
  href: string;
};

// Order matters — first incomplete essential becomes the visible "next action".
// Essentials map 1:1 to what blocks `getSlots()` from returning a bookable slot.
const ESSENTIAL_STEPS: Step[] = [
  { id: "connect_bot",         labelKey: "onboarding.checklist.connect_bot",         href: "?tab=channels" },
  { id: "add_master",          labelKey: "onboarding.checklist.add_master",          href: "?tab=masters" },
  { id: "set_master_schedule", labelKey: "onboarding.checklist.set_master_schedule", href: "?tab=masters" },
  { id: "add_service",         labelKey: "onboarding.checklist.add_service",         href: "?tab=services" },
];

// Optional polish — everything that only affects /salon/{slug}.
// `add_branding` lives in /settings?section=salon (logo + cover + brand color
// all live in SalonSettingsEditor). `share_link` lives on the public-profile
// surface, not channels — the legacy ?tab=channels target was a routing bug.
const OPTIONAL_STEPS: Step[] = [
  { id: "fill_salon_info", labelKey: "onboarding.checklist.fill_salon_info", href: "/settings?section=salon" },
  { id: "add_branding",    labelKey: "onboarding.checklist.add_branding",    href: "/settings?section=salon" },
  { id: "activate_public", labelKey: "onboarding.checklist.activate_public", href: "/settings?section=public" },
  { id: "share_link",      labelKey: "onboarding.checklist.share_link",      href: "?tab=public_profile" },
];

const ALL_STEPS: Step[] = [...ESSENTIAL_STEPS, ...OPTIONAL_STEPS];

const COLLAPSE_LS_KEY = "manicbot_onboarding_optional_collapsed";

function readUserCollapsePreference(): boolean | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(COLLAPSE_LS_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  return null;
}

function writeUserCollapsePreference(collapsed: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(COLLAPSE_LS_KEY, collapsed ? "1" : "0");
}

export function OnboardingChecklist({ tenantId }: Props) {
  const { lang } = useLang();
  const { data, isLoading } = api.onboarding.getStatus.useQuery({ tenantId });

  const completed = useMemo(
    () => new Set<string>(data?.completedSteps ?? []),
    [data?.completedSteps],
  );
  const essentialsDoneCount = ESSENTIAL_STEPS.reduce(
    (n, s) => n + (completed.has(s.id) ? 1 : 0),
    0,
  );
  const allEssentialsDone = essentialsDoneCount === ESSENTIAL_STEPS.length;
  const allDone = ALL_STEPS.every((s) => completed.has(s.id));

  // Auto-open the optional tier mid-flow (1..3 essentials done) so the user
  // knows it's there. Stay closed at 0/4 (focus on the basics) and at 4/4
  // (don't nag once the salon is operational). The user's explicit toggle
  // wins via localStorage.
  const autoOpen = essentialsDoneCount > 0 && !allEssentialsDone;
  const [userPref, setUserPref] = useState<boolean | null>(null);
  useEffect(() => {
    setUserPref(readUserCollapsePreference());
  }, []);
  const optionalCollapsed = userPref !== null ? userPref : !autoOpen;

  const nextEssential = ESSENTIAL_STEPS.find((s) => !completed.has(s.id));

  if (isLoading || !data) return null;
  if (allDone) return null;

  const essentialProgress = essentialsDoneCount / ESSENTIAL_STEPS.length;
  const headlineKey = allEssentialsDone
    ? "onboarding.checklist.headline.ready"
    : "onboarding.checklist.headline.setup";

  const toggleOptional = () => {
    const next = !optionalCollapsed;
    setUserPref(next);
    writeUserCollapsePreference(next);
  };

  return (
    <div
      data-testid="onboarding-checklist"
      className="glass-card rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/15 to-cyan-500/10 dark:from-violet-500/10 dark:to-cyan-500/5 p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3
          data-testid="onboarding-headline"
          className="text-sm font-semibold text-foreground"
        >
          {t(headlineKey, lang)}
        </h3>
        <span
          data-testid="onboarding-counter"
          className="text-xs font-mono text-muted-foreground"
        >
          {essentialsDoneCount}/{ESSENTIAL_STEPS.length}
        </span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          data-testid="onboarding-progress-fill"
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: essentialProgress === 0 ? "4px" : `${essentialProgress * 100}%`,
            background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
          }}
        />
      </div>

      <ul className="space-y-2">
        {ESSENTIAL_STEPS.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            done={completed.has(step.id)}
            isNext={nextEssential?.id === step.id}
            lang={lang}
          />
        ))}
      </ul>

      <div className="mt-4 border-t border-foreground/10 pt-3">
        <button
          type="button"
          data-testid="onboarding-optional-toggle"
          onClick={toggleOptional}
          className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition hover:text-foreground"
          aria-expanded={!optionalCollapsed}
        >
          <span className="flex items-center gap-2">
            {t("onboarding.checklist.tier.optional", lang)}
            <span className="font-mono text-[10px] opacity-70">
              {OPTIONAL_STEPS.reduce((n, s) => n + (completed.has(s.id) ? 1 : 0), 0)}/
              {OPTIONAL_STEPS.length}
            </span>
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${optionalCollapsed ? "" : "rotate-180"}`}
          />
        </button>

        {!optionalCollapsed && (
          <ul className="mt-3 space-y-2">
            {OPTIONAL_STEPS.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                done={completed.has(step.id)}
                isNext={false}
                lang={lang}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StepRow({
  step,
  done,
  isNext,
  lang,
}: {
  step: Step;
  done: boolean;
  isNext: boolean;
  lang: ReturnType<typeof useLang>["lang"];
}) {
  return (
    <li
      data-step-id={step.id}
      data-next-action={isNext ? "true" : undefined}
      className={`flex items-center gap-3 text-sm transition-colors ${
        isNext ? "-mx-2 rounded-lg bg-violet-500/[0.04] px-2 py-1" : ""
      }`}
    >
      <span className="relative flex flex-shrink-0">
        {isNext && (
          <span
            aria-hidden="true"
            data-testid="onboarding-next-halo"
            className="absolute inset-[-3px] rounded-full ring-2 ring-violet-500/40 animate-pulse [animation-duration:2.4s]"
          />
        )}
        <span
          data-testid="onboarding-step-circle"
          className={`relative flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300 ${
            done
              ? "bg-emerald-500/20 text-emerald-400"
              : isNext
              ? "border-2 border-violet-500 bg-violet-500/10 text-violet-500"
              : "border-2 border-foreground/25 bg-transparent text-transparent"
          }`}
        >
          {done ? (
            <span className="inline-block animate-in zoom-in-50 duration-300">✓</span>
          ) : (
            ""
          )}
        </span>
      </span>
      <a
        href={step.href}
        className={`flex-1 transition ${
          done
            ? "text-muted-foreground/60 line-through"
            : isNext
            ? "font-semibold text-foreground hover:text-violet-600 dark:hover:text-violet-300"
            : "text-foreground/80 hover:text-violet-600 dark:hover:text-violet-300"
        }`}
      >
        {t(step.labelKey, lang)}
      </a>
    </li>
  );
}
