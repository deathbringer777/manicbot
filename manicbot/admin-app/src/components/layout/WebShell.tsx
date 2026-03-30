"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, UserCog, MessageSquare,
  LogOut, Menu, X, Zap, ChevronLeft, ChevronRight,
  ScrollText, CalendarCheck, UserRound, Wallet, LayoutGrid,
  HeadphonesIcon, Scissors,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { RoleSwitcherInline, LangPickerInline } from "~/components/layout/Shell";

/** When true, inner <Shell> renders only children (no double sidebar). */
export const WebShellContext = createContext(false);
export const useInWebShell = () => useContext(WebShellContext);

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GOD_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", icon: Home, label: "Dashboard" },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/users", icon: Users, label: "Users" },
      { href: "/tenants", icon: Building2, label: "Tenants" },
      { href: "/appointments", icon: CalendarDays, label: "Appointments" },
      { href: "/conversations", icon: MessageSquare, label: "Inbox" },
      { href: "/agents", icon: UserCog, label: "Agents" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/billing", icon: CreditCard, label: "Billing" },
      { href: "/events", icon: ScrollText, label: "Events" },
      { href: "/system", icon: Activity, label: "System" },
      { href: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

const GOD_FLAT: NavItem[] = GOD_GROUPS.flatMap(g => g.items);

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

function getNavGroups(role: string | null): NavGroup[] {
  if (role === "system_admin") return GOD_GROUPS;
  const flat = role === "tenant_owner" ? SALON_NAV
    : role === "master" ? MASTER_NAV
    : role === "support" || role === "technical_support" ? SUPPORT_NAV
    : [{ href: "/", icon: Home, label: "Dashboard" }];
  return [{ label: "", items: flat }];
}

function getFlatNav(role: string | null): NavItem[] {
  return getNavGroups(role).flatMap(g => g.items);
}

function getRoleInfo(role: string | null): { title: string; subtitle: string; badge?: string } {
  switch (role) {
    case "system_admin": return { title: "ManicBot", subtitle: "Admin Panel", badge: "God Mode" };
    case "tenant_owner": return { title: "My Salon", subtitle: "Dashboard" };
    case "master": return { title: "My Schedule", subtitle: "Master" };
    case "support": return { title: "Support", subtitle: "Agent Hub" };
    case "technical_support": return { title: "Tech Support", subtitle: "Agent Hub" };
    default: return { title: "ManicBot", subtitle: "Dashboard" };
  }
}

function getPageTitle(pathname: string, role: string | null): string {
  const flat = role === "system_admin" ? GOD_FLAT : getFlatNav(role);
  const exact = flat.find(n => n.href === pathname);
  if (exact) return exact.label;
  const match = flat.find(n => n.href !== "/" && pathname.startsWith(n.href));
  return match?.label ?? "Dashboard";
}

function NavLink({ item, active, collapsed, onClick }: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 relative ${
        active
          ? "bg-brand-500/10 text-brand-400 font-medium border-l-2 border-brand-400"
          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 border-l-2 border-transparent"
      } ${collapsed ? "justify-center px-0 border-l-0" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${
        active ? "text-brand-400" : "group-hover:text-slate-300"
      }`} />
      {!collapsed && <span className="text-[13px]">{item.label}</span>}
    </Link>
  );
}

export function WebShell({ children, userEmail }: { children: React.ReactNode; userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const navGroups = getNavGroups(effectiveRole);
  const flatNav = getFlatNav(effectiveRole);
  const roleInfo = getRoleInfo(effectiveRole);
  const showRoleSwitcher = role === "system_admin";
  const pageTitle = getPageTitle(pathname, effectiveRole);

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  const isActive = (item: NavItem) => {
    if (item.href.includes("?")) return false;
    return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  };

  // Mobile nav: max 5
  const mobileNav = flatNav.length <= 5
    ? flatNav
    : [...flatNav.slice(0, 4), flatNav.find(n => n.href.includes("settings")) ?? flatNav[flatNav.length - 1]!];

  // User avatar initial
  const avatarLetter = (userEmail ?? "G").charAt(0).toUpperCase();

  return (
    <WebShellContext.Provider value={true}>
      <div className="flex h-screen w-full bg-slate-950 overflow-hidden">

        {/* ═══ Desktop Sidebar ═══ */}
        <aside
          className={`hidden lg:flex flex-col border-r border-white/[0.06] bg-[rgba(10,13,28,0.65)] backdrop-blur-2xl transition-all duration-300 ease-out shrink-0 ${
            collapsed ? "w-[72px]" : "w-64"
          }`}
        >
          {/* Logo */}
          <div className={`flex items-center gap-3 h-16 border-b border-white/[0.06] ${collapsed ? "px-4 justify-center" : "px-5"}`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-700 shadow-lg shadow-brand-500/25 shrink-0">
              <Zap className="h-5 w-5 text-white" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <h1 className="text-sm font-bold text-white tracking-tight">{roleInfo.title}</h1>
                <p className="text-[10px] text-slate-500">{roleInfo.subtitle}</p>
              </div>
            )}
          </div>

          {/* Nav groups */}
          <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto scrollbar-none">
            {navGroups.map((group) => (
              <div key={group.label}>
                {group.label && !collapsed && (
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.href + item.label} item={item} active={isActive(item)} collapsed={collapsed} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Bottom: user info + controls */}
          <div className="border-t border-white/[0.06] p-3 space-y-2">
            {showRoleSwitcher && !collapsed && <RoleSwitcherInline />}
            {!collapsed && <LangPickerInline />}

            {/* User info */}
            {!collapsed && (
              <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/[0.03]">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {avatarLetter}
                </div>
                <div className="min-w-0 flex-1">
                  {roleInfo.badge && (
                    <span className="inline-block text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-brand-500/20 text-brand-300 mb-0.5">
                      {roleInfo.badge}
                    </span>
                  )}
                  <p className="text-[11px] text-slate-400 truncate">{userEmail ?? "admin"}</p>
                </div>
              </div>
            )}

            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full ${
                collapsed ? "justify-center px-0" : ""
              }`}
              title="Logout"
            >
              <LogOut className="h-[17px] w-[17px] shrink-0" />
              {!collapsed && <span className="text-[13px]">Logout</span>}
            </button>

            <button
              onClick={() => setCollapsed(v => !v)}
              className="flex items-center gap-2 px-3 py-1 text-slate-700 hover:text-slate-500 transition-colors w-full justify-center"
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
            <aside className="relative w-72 max-w-[85vw] bg-[rgba(10,13,28,0.98)] border-r border-white/[0.06] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between h-16 px-5 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-700">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-sm font-bold text-white">{roleInfo.title}</h1>
                    <p className="text-[10px] text-slate-500">{roleInfo.subtitle}</p>
                  </div>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-slate-400">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Nav groups */}
              <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto scrollbar-none">
                {navGroups.map((group) => (
                  <div key={group.label}>
                    {group.label && (
                      <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        {group.label}
                      </p>
                    )}
                    <div className="space-y-0.5">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.href + item.label}
                          item={item}
                          active={isActive(item)}
                          onClick={() => setSidebarOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </nav>

              {/* Bottom */}
              <div className="border-t border-white/[0.06] p-3 space-y-2">
                {showRoleSwitcher && <RoleSwitcherInline />}
                <LangPickerInline />
                {userEmail && (
                  <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/[0.03]">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand-500 to-purple-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {avatarLetter}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate flex-1">{userEmail}</p>
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full"
                >
                  <LogOut className="h-[17px] w-[17px]" />
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
            {/* Mobile logo + title */}
            <div className="lg:hidden flex items-center gap-2 min-w-0 flex-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-700 shrink-0">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-bold text-white truncate">{pageTitle}</span>
            </div>
            {/* Desktop: page title */}
            <div className="hidden lg:block flex-1">
              <h2 className="text-sm font-semibold text-white">{pageTitle}</h2>
            </div>
            {/* Right controls (desktop) */}
            <div className="flex items-center gap-2">
              {showRoleSwitcher && <RoleSwitcherInline />}
              <LangPickerInline />
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto relative">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-brand-500/[0.05] blur-[120px]" />
              <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-500/[0.05] blur-[120px]" />
            </div>
            <div className="relative z-10 p-4 lg:p-6 pb-24 lg:pb-6 mx-auto max-w-7xl w-full">
              {children}
            </div>
          </main>

          {/* ═══ Mobile Bottom Nav ═══ */}
          <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[rgba(2,6,23,0.92)] backdrop-blur-xl border-t border-white/[0.06]">
            <div className="flex items-center justify-around px-1 py-1.5">
              {mobileNav.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    className={`flex flex-col items-center justify-center py-1 flex-1 transition-colors ${
                      active ? "text-brand-400" : "text-slate-600"
                    }`}
                  >
                    <div className={`p-1.5 rounded-xl transition-all ${active ? "bg-brand-500/15 scale-110" : ""}`}>
                      <item.icon className="h-5 w-5" />
                    </div>
                    <span className={`text-[9px] font-medium mt-0.5 ${active ? "text-brand-400" : "text-slate-700"}`}>
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
