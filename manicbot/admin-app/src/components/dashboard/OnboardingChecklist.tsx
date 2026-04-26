"use client";

import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  tenantId: string;
}

const STEPS = [
  { id: "add_service" as const,    labelKey: "onboarding.checklist.add_service" as const,    href: "?tab=services" },
  { id: "connect_bot" as const,    labelKey: "onboarding.checklist.connect_bot" as const,    href: "?tab=channels" },
  { id: "invite_master" as const,  labelKey: "onboarding.checklist.invite_master" as const,  href: "?tab=masters" },
  { id: "set_schedule" as const,   labelKey: "onboarding.checklist.set_schedule" as const,   href: "?tab=masters" },
  { id: "share_link" as const,     labelKey: "onboarding.checklist.share_link" as const,     href: "?tab=channels" },
  { id: "first_booking" as const,  labelKey: "onboarding.checklist.first_booking" as const,  href: "?tab=appointments" },
];

export function OnboardingChecklist({ tenantId }: Props) {
  const { lang } = useLang();
  const { data, isLoading } = api.onboarding.getStatus.useQuery({ tenantId });

  if (isLoading || !data) return null;
  if (data.completedSteps.length >= STEPS.length) return null;

  const completed = new Set<string>(data.completedSteps);
  const progress = completed.size / STEPS.length;

  return (
    <div className="glass-card rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/15 to-cyan-500/10 dark:from-violet-500/10 dark:to-cyan-500/5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("onboarding.checklist.title", lang)}</h3>
        <span className="text-xs font-mono text-muted-foreground">
          {completed.size}/{STEPS.length}
        </span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress * 100}%`,
            background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
          }}
        />
      </div>

      <ul className="space-y-2">
        {STEPS.map((step) => {
          const done = completed.has(step.id);
          return (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition ${
                  done
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-foreground/[0.06] text-muted-foreground/50"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              <a
                href={step.href}
                className={`flex-1 transition ${
                  done ? "text-muted-foreground/60 line-through" : "text-foreground/90 hover:text-violet-600 dark:hover:text-violet-300"
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
