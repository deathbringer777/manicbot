"use client";

/**
 * SystemMarketingShell — sub-nav for the platform marketing center.
 *
 * Sibling of `MarketingShell` but for the system_admin surface served at
 * `/system/marketing/*`. The salon-owner `MarketingShell` shows "your CRM";
 * this one shows "platform CRM" — cross-tenant aggregates, lead funnel, and
 * the campaigns that ManicBot itself runs against its salon-owner base.
 *
 * Visual cue: amber accent + "PLATFORM" badge so the sysadmin instantly
 * knows they are NOT looking at a tenant's data.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shell } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";
import {
  Megaphone, Mail, Users,
  type LucideIcon,
} from "lucide-react";

type SubNavItem = { href: string; icon: LucideIcon; label: string };

const SUB_NAV: Array<SubNavItem> = [
  { href: "/system/marketing",            icon: Megaphone, label: "Обзор" },
  { href: "/system/marketing/campaigns",  icon: Mail,      label: "Кампании" },
  { href: "/system/marketing/leads",      icon: Users,     label: "Лиды" },
];

export function SystemMarketingShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const { role } = useRole();

  // Defensive: this shell is sysadmin-only by URL convention, but layered
  // gating never hurts. Non-sysadmin should never reach this client at all
  // (layout intercepts), but if they typed the URL directly, show nothing.
  if (role !== "system_admin") {
    return (
      <Shell title="Центр маркетинга" subtitle="Платформа">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-700 dark:text-red-300">
          Эта страница доступна только системному администратору.
        </div>
      </Shell>
    );
  }

  const resolvedTitle = title ?? "Центр маркетинга";
  const resolvedSubtitle = subtitle ?? "Платформенный CRM · Кросс-тенантные кампании · Лиды";

  return (
    <Shell title={resolvedTitle} subtitle={resolvedSubtitle}>
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          Platform
        </span>
        <div className="ml-1 flex flex-wrap gap-1.5 overflow-x-auto">
          {SUB_NAV.map(({ href, icon: Icon, label }) => {
            const active =
              href === "/system/marketing"
                ? pathname === "/system/marketing"
                : pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </Shell>
  );
}
