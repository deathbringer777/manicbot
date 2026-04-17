"use client";

import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
}

const STEPS = [
  { id: "add_service" as const, label: "Добавьте услугу", href: "?tab=services" },
  { id: "connect_bot" as const, label: "Подключите бота", href: "?tab=channels" },
  { id: "invite_master" as const, label: "Пригласите мастера", href: "?tab=masters" },
  { id: "set_schedule" as const, label: "Настройте расписание", href: "?tab=masters" },
  { id: "share_link" as const, label: "Поделитесь ссылкой", href: "?tab=channels" },
  { id: "first_booking" as const, label: "Примите первую запись", href: "?tab=appointments" },
];

export function OnboardingChecklist({ tenantId }: Props) {
  const { data, isLoading } = api.onboarding.getStatus.useQuery({ tenantId });

  if (isLoading || !data) return null;
  if (data.completedSteps.length >= STEPS.length) return null;

  const completed = new Set<string>(data.completedSteps);
  const progress = completed.size / STEPS.length;

  return (
    <div className="glass-card rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-cyan-500/5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Настройте салон за 10 минут</h3>
        <span className="text-xs font-mono text-white/60">
          {completed.size}/{STEPS.length}
        </span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
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
                    : "bg-white/[0.06] text-white/30"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              <a
                href={step.href}
                className={`flex-1 transition ${
                  done ? "text-white/40 line-through" : "text-white/80 hover:text-violet-300"
                }`}
              >
                {step.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
