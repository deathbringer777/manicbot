"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shell } from "~/components/layout/Shell";
import {
  Megaphone, Users, Mail, MessageSquare, Workflow, FileText, Plug,
  type LucideIcon,
} from "lucide-react";

const SUB_NAV: Array<{ href: string; icon: LucideIcon; label: string }> = [
  { href: "/marketing",              icon: Megaphone,     label: "Overview" },
  { href: "/marketing/contacts",     icon: Users,         label: "Contacts" },
  { href: "/marketing/campaigns",    icon: Mail,          label: "Campaigns" },
  { href: "/marketing/sms",          icon: MessageSquare, label: "SMS" },
  { href: "/marketing/automations",  icon: Workflow,      label: "Automations" },
  { href: "/marketing/templates",    icon: FileText,      label: "Templates" },
  { href: "/marketing/providers",    icon: Plug,          label: "Providers" },
];

export function MarketingShell({
  children,
  title = "Marketing",
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const pathname = usePathname();

  return (
    <Shell title={title} subtitle={subtitle ?? "CRM • Campaigns • Automations"}>
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3 mb-5 overflow-x-auto">
        {SUB_NAV.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/marketing" ? pathname === "/marketing" : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap
                ${active
                  ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent"
                }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>
      {children}
    </Shell>
  );
}

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30">
      Coming Soon
    </span>
  );
}

export function StubCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <ComingSoonBadge />
      </div>
      {description && <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{description}</p>}
      {children}
    </div>
  );
}
