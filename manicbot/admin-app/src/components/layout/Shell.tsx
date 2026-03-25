"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home,
  Users,
  Settings,
  CreditCard,
  Activity,
  Building2,
  CalendarDays,
  Zap,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { RoleSwitcher } from "~/components/RoleSwitcher";
import { SettingsSheet } from "~/components/SettingsSheet";
import { useRole } from "~/components/RoleContext";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const godModeNavItems: NavItem[] = [
  { href: "/", icon: Home, label: "Dashboard" },
  { href: "/users", icon: Users, label: "Users" },
  { href: "/tenants", icon: Building2, label: "Tenants" },
  { href: "/appointments", icon: CalendarDays, label: "Appts" },
  { href: "/agents", icon: UserCog, label: "Agents" },
  { href: "/billing", icon: CreditCard, label: "Billing" },
  { href: "/system", icon: Activity, label: "System" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

function getAdminInfo() {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.initDataUnsafe?.user) return { name: "God Mode", username: "creator" };
    const u = tg.initDataUnsafe.user;
    return {
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || "Admin",
      username: u.username ?? String(u.id),
    };
  } catch {
    return { name: "God Mode", username: "creator" };
  }
}

interface ShellProps {
  children: React.ReactNode;
  navItems?: NavItem[];
  title?: string;
  subtitle?: string;
}

export function Shell({ children, navItems, title, subtitle }: ShellProps) {
  const pathname = usePathname();
  const [admin, setAdmin] = useState({ name: "God Mode", username: "creator" });
  const { role } = useRole();
  const activeNavItems = navItems ?? godModeNavItems;
  const displayTitle = title ?? "God Mode";
  const displaySubtitle = subtitle ?? "ManicBot Admin";

  useEffect(() => {
    setAdmin(getAdminInfo());
  }, []);

  const mobileNavItems = activeNavItems;

  return (
    <div className="flex h-screen w-full flex-col md:flex-row bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border glass-card m-4 rounded-2xl p-4 shrink-0">
        <div className="mb-6 px-2 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-lg shadow-brand-500/30">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-400 to-purple-400">
              {displayTitle}
            </h1>
            <p className="text-[10px] text-slate-500 font-mono">{displaySubtitle}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {activeNavItems.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 ${
                  isActive
                    ? "bg-brand-500/10 text-brand-400 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-brand-400" : ""}`} />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 border-t border-border/50 pt-4 px-2 space-y-3">
          {role === "system_admin" && <RoleSwitcher />}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-xs font-bold shadow-lg shadow-brand-500/20 shrink-0">
              {admin.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{admin.name}</p>
              <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                @{admin.username}
              </p>
            </div>
            <SettingsSheet />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto w-full p-4 pb-24 md:p-6 md:pb-6 relative">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/10 blur-[80px]" />
          <div className="absolute bottom-0 left-0 h-64 w-64 -translate-x-1/2 translate-y-1/2 rounded-full bg-purple-500/10 blur-[80px]" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl w-full">{children}</div>
      </main>

      {/* Mobile Bottom Nav — scrollable row */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-border">
        <div className="flex overflow-x-auto scrollbar-none px-1 py-1.5 items-center">
          {mobileNavItems.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl shrink-0 transition-all ${
                  isActive ? "text-brand-400" : "text-slate-500"
                }`}
              >
                <div
                  className={`p-1.5 rounded-lg transition-colors ${
                    isActive ? "bg-brand-500/20" : ""
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                </div>
                <span className="text-[9px] font-medium whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
          <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
            <SettingsSheet />
          </div>
        </div>
      </nav>
    </div>
  );
}
