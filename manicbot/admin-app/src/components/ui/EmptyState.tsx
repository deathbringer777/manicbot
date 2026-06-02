"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Action {
  label: string;
  onClick?: () => void;
  href?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: Action;
  secondaryAction?: Action;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 sm:py-24 text-center px-4">
      {Icon && (
        <div className="relative mb-6">
          {/* Soft animated halo */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[-22px] rounded-full bg-[radial-gradient(circle_at_center,rgba(30,168,150,0.18),rgba(30,168,150,0)_60%)] dark:bg-[radial-gradient(circle_at_center,rgba(52,197,176,0.22),rgba(52,197,176,0)_65%)] animate-empty-halo"
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-muted dark:bg-slate-800/80 ring-1 ring-inset ring-border dark:ring-white/[0.06]">
            <Icon
              className="h-7 w-7 text-muted-foreground dark:text-slate-400"
              strokeWidth={1.6}
            />
          </div>
        </div>
      )}
      <h3 className="text-[20px] font-bold tracking-tight text-foreground dark:text-white">
        {title}
      </h3>
      {description && (
        <p className="mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted-foreground dark:text-slate-400">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action && <PrimaryAction action={action} />}
          {secondaryAction && <SecondaryAction action={secondaryAction} />}
        </div>
      )}
    </div>
  );
}

function PrimaryAction({ action }: { action: Action }) {
  const cls =
    "group inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover hover:shadow-md transition-all";
  const inner = (
    <>
      <span>{action.label}</span>
      <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
    </>
  );
  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={action.onClick} className={cls}>
      {inner}
    </button>
  );
}

function SecondaryAction({ action }: { action: Action }) {
  const cls =
    "inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-white transition-colors";
  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  );
}
