"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

export interface CollapsibleSectionProps {
  icon: LucideIcon;
  iconClass?: string;
  title: string;
  desc?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  icon: Icon,
  iconClass = "text-brand-400",
  title,
  desc,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="glass-card rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full text-left p-4 flex items-start gap-2 rounded-2xl hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
          {desc && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>}
        </div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 mt-0.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={bodyId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
