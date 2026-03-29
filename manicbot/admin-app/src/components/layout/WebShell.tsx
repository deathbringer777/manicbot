"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, UserCog, MessageSquare,
  LogOut, Menu, X, Zap, ChevronLeft, ChevronRight,
  Scissors, HeadphonesIcon, CalendarCheck, Palette,
  UserRound, Wallet, LayoutGrid, Clock, Star,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { RoleSwitcherInline, LangPickerInline } from "~/components/layout/Shell";

/** When true, inner <Shell> renders only children (no double sidebar). */
export const WebShellContext = createContext(false);
export const useInWebShell = () => useContext(WebShellContext);

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const GOD_NAV: NavItem[] = [
  { href: "/", icon: Home, label: "Dashboard" },
  { href: "/users", icon: Users, label: "Users" },
  { href: "/tenants", icon: Building2, label: "Tenants" },
  { href: "/appointments", icon: CalendarDays, label: "Appointments" },
  { href: "/conversations", icon: MessageSquare, label: "Inbox" },
  { href: "/agents", icon: UserCog, label: "Agents" },
  { href: "/billing", icon: CreditCard, label: "Billing" },
  { href: "/system", icon: Activity, label: "System" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

const SALON_NAV: NavItem[] = [
  { href: "/", icon: LayoutGrid, label: "Overview" },
  { href: "/?tab=appointments", icon: CalendarDays, label: "Appointments" },
  { href: "/?tab=services", icon: Scissors, label: "Services" },
  { href: "/?tab=masters", icon: UserRound, label: "Masters" },
  { href: "/?tab=clients", icon: Users, label: "Clients" },
  { href: "/?tab=billing", icon: Wallet, label: "Billing" },
  { href: "/?tab=channels", icon: MessageSquare, label: "Channels" },
  { href: "/?tab=settings", icon: Settings, label: "Settings" },
];

const MASTER_NAV: NavItem[] = [
  { href: "/", icon: Home, label: "Today" },
  { href: "/?tab=schedule", icon: CalendarCheck, label: "Schedule" },
  { href: "/?tab=clients", icon: Users, label: "Clients" },
  { href: "/?tab=earnings", icon: Wallet, label: "Earnings" },
  { href: "/?tab=profile", icon: UserRound, label: "Profile" },
];

const SUPPORT_NAV: NavItem[] = [
  { href: "/", icon: HeadphonesIcon, label: "Tickets" },
];

function getNavItems(role: string | null): NavItem[] {
  switch (role) {
    case "system_admin": return GOD_NAV;
    case "tenant_owner": return SALON_NAV;
    case "master": return MASTER_NAV;
    case "support":
    case "technical_support": return SUPPORT_NAV;
    default: return [{ href: "/", icon: Home, label: "Dashboard" }];
  }
}

function getRoleTitle(role: string | null): { title: string; subtitle: string } {
  switch (role) {
    case "system_admin": return { title: "ManicBot", subtitle: "God Mode" };
    case "tenant_owner": return { title: "My Salon", subtitle: "Dashboard" };
    case "master": return { title: "My Schedule", subtitle: "Master" };
    case "support":
    case "technical_support": return { title: "Support", subtitle: "Agent Hub" };
    default: return { title: "ManicBot", subtitle: "Dashboard" };
  }
}

export function WebShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const navItems = getNavItems(effectiveRole);
  const { title, subtitle } = getRoleTitle(effectiveRole);
  const showRoleSwitcher = role === "system_admin";

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  const isActive = (item: NavItem) => {
    if (item.href.includes("?tab=")) return false; // tab items handled differently
    return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  };

  // Mobile nav: max 5 items
  const mobileNav = navItems.length <= 5
    ? navItems
    : [...navItems.slice(0, 4), navItems.find(n => n.href.includes("settings")) ?? navItems[navItems.length - 1]!];

  return (
    <WebShellContext.Provider value={true}>
      <div className="flex h-screen w-full bg-slate-950 overflow-hidden">
        {/* ═══ Desktop Sidebar ═══ */}
        <aside
          className={`hidden lg:flex flex-col border-r border-white/[0.06] bg-[rgba(10,13,28,0.6)] backdrop-blur-2xl transition-all duration-300 ease-out shrink-0 ${
            collapsed ? "w-[72px]" : "w-64"
          }`}
        >
          {/* Logo */}
          <div className={`flex items-center gap-3 h-16 border-b border-white/[0.06] ${collapsed ? "px-4 justify-center" : "px-5"}`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-lg shadow-brand-500/20 shrink-0">
              <Zap className="h-5 w-5 text-white" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <h1 className="text-sm font-bold text-white tracking-tight">{title}</h1>
                <p className="text-[10px] text-slate-500">{subtitle}</p>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-none">
            {navItems.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 ${
                    active
                      ? "bg-brand-500/15 text-brand-400 font-medium shadow-sm shadow-brand-500/5"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                  } ${collapsed ? "justify-center px-0" : ""}`}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                    active ? "text-brand-400" : "group-hover:text-slate-300"
                  }`} />
                  {!collapsed && <span className="text-[13px]">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* Bottom */}
          <div className="border-t border-white/[0.06] p-3 space-y-1.5">
            {showRoleSwitcher && !collapsed && <RoleSwitcherInline />}
            {!collapsed && <LangPickerInline />}
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full ${
                collapsed ? "justify-center px-0" : ""
              }`}
              title="Logout"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="text-[13px]">Logout</span>}
            </button>
            <button
              onClick={() => setCollapsed(v => !v)}
              className="flex items-center gap-3 px-3 py-1.5 text-slate-600 hover:text-slate-400 transition-colors w-full justify-center lg:justify-start"
            >
              {collapsed
                ? <ChevronRight className="h-4 w-4" />
                : <><ChevronLeft className="h-4 w-4" /><span className="text-[11px]">Collapse</span></>
              }
            </button>
          </div>
        </aside>

        {/* ═══ Mobile Drawer ═══ */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <aside className="relative w-72 max-w-[85vw] bg-slate-900 border-r border-white/[0.06] flex flex-col animate-in slide-in-from-left-full duration-200">
              {/* Header */}
              <div className="flex items-center justify-between h-16 px-5 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-sm font-bold text-white">{title}</h1>
                    <p className="text-[10px] text-slate-500">{subtitle}</p>
                  </div>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-slate-400">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Nav */}
              <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                {navItems.map((item) => {
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                        active
                          ? "bg-brand-500/15 text-brand-400 font-medium"
                          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}
                    >
                      <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-brand-400" : ""}`} />
                      <span className="text-[13px]">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              {/* Bottom */}
              <div className="border-t border-white/[0.06] p-3 space-y-2">
                {showRoleSwitcher && <RoleSwitcherInline />}
                <LangPickerInline />
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                  <span className="text-[13px]">Logout</span>
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* ═══ Main area ═══ */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header className="h-16 flex items-center gap-3 px-4 lg:px-6 border-b border-white/[0.06] bg-slate-950/80 backdrop-blur-xl shrink-0 z-30">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-white/5 text-slate-400"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Mobile title */}
            <div className="lg:hidden flex items-center gap-2 min-w-0 flex-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 shrink-0">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-bold text-white truncate">{title}</span>
            </div>
            {/* Spacer for desktop */}
            <div className="hidden lg:block flex-1" />
            {/* Desktop right side */}
            <div className="hidden lg:flex items-center gap-2">
              <LangPickerInline />
              {showRoleSwitcher && <RoleSwitcherInline />}
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto relative">
            {/* Decorative gradient orbs */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-brand-500/[0.06] blur-[100px]" />
              <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-purple-500/[0.06] blur-[100px]" />
            </div>
            <div className="relative z-10 p-4 lg:p-6 pb-24 lg:pb-6 mx-auto max-w-7xl w-full">
              {children}
            </div>
          </main>

          {/* ═══ Mobile Bottom Nav ═══ */}
          <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur-xl border-t border-white/[0.06] safe-area-pb">
            <div className="flex items-center justify-around px-1 py-1.5">
              {mobileNav.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    className={`flex flex-col items-center justify-center py-1 flex-1 transition-colors ${
                      active ? "text-brand-400" : "text-slate-500"
                    }`}
                  >
                    <div className={`p-1.5 rounded-xl transition-all ${active ? "bg-brand-500/20 scale-110" : ""}`}>
                      <item.icon className="h-5 w-5" />
                    </div>
                    <span className={`text-[9px] font-medium mt-0.5 ${active ? "text-brand-400" : "text-slate-600"}`}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </WebShellContext.Provider>
  );
}
