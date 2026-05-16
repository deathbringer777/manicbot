"use client";

import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  tenantId: string;
}

const STEPS = [
  { id: "add_service" as const,      labelKey: "onboarding.checklist.add_service" as const,      href: "?tab=services" },
  { id: "connect_bot" as const,      labelKey: "onboarding.checklist.connect_bot" as const,      href: "?tab=channels" },
  { id: "invite_master" as const,    labelKey: "onboarding.checklist.invite_master" as const,    href: "?tab=masters" },
  { id: "set_schedule" as const,     labelKey: "onboarding.checklist.set_schedule" as const,     href: "?tab=masters" },
  { id: "share_link" as const,       labelKey: "onboarding.checklist.share_link" as const,       href: "?tab=channels" },
  { id: "first_booking" as const,    labelKey: "onboarding.checklist.first_booking" as const,    href: "?tab=appointments" },
  { id: "fill_description" as const, labelKey: "onboarding.checklist.fill_description" as const, href: "?tab=settings" },
  { id: "add_logo" as const,         labelKey: "onboarding.checklist.add_logo" as const,         href: "?tab=settings" },
  { id: "add_cover" as const,        labelKey: "onboarding.checklist.add_cover" as const,        href: "?tab=public_profile" },
  { id: "activate_public" as const,  labelKey: "onboarding.checklist.activate_public" as const,  href: "?tab=public_profile" },
];

export function OnboardingChecklist({ tenantId }: Props) {
  const { lang } = useLang();
  const { data, isLoading } = api.onboarding.getStatus.useQuery({ tenantId });

  if (isLoading || !data) return null;
  if (data.completedSteps.length >= STEPS.length) return null;

  const completed = new Set<string>(data.completedSteps);
  const progress = completed.size / STEPS.length;
  const nextIndex = STEPS.findIndex((s) => !completed.has(s.id));

  return (
    <div
      data-testid="onboarding-checklist"
      className="glass-card rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/15 to-cyan-500/10 dark:from-violet-500/10 dark:to-cyan-500/5 p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("onboarding.checklist.title", lang)}</h3>
        <span className="text-xs font-mono text-muted-foreground">
          {completed.size}/{STEPS.length}
        </span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          data-testid="onboarding-progress-fill"
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: progress === 0 ? "4px" : `${progress * 100}%`,
            background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
          }}
        />
      </div>

      <ul className="space-y-2">
        {STEPS.map((step, i) => {
          const done = completed.has(step.id);
          const isNext = i === nextIndex;
          return (
            <li
              key={step.id}
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
        })}
      </ul>
    </div>
  );
}
