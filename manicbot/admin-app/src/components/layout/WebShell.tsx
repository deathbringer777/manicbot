"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, UserCog, MessageSquare,
  LogOut, Menu, X, Zap, ChevronLeft, ChevronRight,
  ScrollText, CalendarCheck, UserRound, Wallet, LayoutGrid,
  HeadphonesIcon, Scissors, Sun, Moon,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { DashboardOnboarding } from "~/components/onboarding/DashboardOnboarding";
import { PublicFooter } from "~/components/public/PublicFooter";

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

/** Per-language label sets for nav items and groups. */
const NAV_LABELS: Record<string, Record<string, string>> = {
  ru: {
    // God Mode groups
    "Overview": "Обзор",
    "Management": "Управление",
    "Platform": "Платформа",
    // God Mode items
    "Dashboard": "Дашборд",
    "Users": "Пользователи",
    "Tenants": "Салоны",
    "Appointments": "Записи",
    "Inbox": "Омниканал",
    "Platform tickets": "Тикеты платформы",
    "Agents": "Агенты",
    "Billing": "Биллинг",
    "Events": "События",
    "System": "Система",
    "Settings": "Настройки",
    // Salon nav
    "Services": "Услуги",
    "Masters": "Мастера",
    "Clients": "Клиенты",
    "Channels": "Каналы",
    // Master nav
    "Today": "Сегодня",
    "Schedule": "Расписание",
    "Earnings": "Доходы",
    "Profile": "Профиль",
    // Support
    "Tickets": "Тикеты",
    // Role info
    "Admin Panel": "Панель администратора",
    "God Mode": "Админ",
    "My Salon": "Мой салон",
    "My Schedule": "Моё расписание",
    "Master": "Мастер",
    "Support": "Поддержка",
    "Tech Support": "Тех. поддержка",
    "Agent Hub": "Центр агентов",
    "Logout": "Выйти",
    "Collapse": "Свернуть",
    // Logout dialog
    "LogoutConfirmTitle": "Выйти из аккаунта?",
    "LogoutConfirmDesc": "Вы уверены, что хотите выйти?",
    "Cancel": "Отмена",
  },
  ua: {
    "Overview": "Огляд",
    "Management": "Управління",
    "Platform": "Платформа",
    "Dashboard": "Дашборд",
    "Users": "Користувачі",
    "Tenants": "Салони",
    "Appointments": "Записи",
    "Inbox": "Омніканал",
    "Platform tickets": "Тикети платформи",
    "Agents": "Агенти",
    "Billing": "Білінг",
    "Events": "Події",
    "System": "Система",
    "Settings": "Налаштування",
    "Services": "Послуги",
    "Masters": "Майстри",
    "Clients": "Клієнти",
    "Channels": "Канали",
    "Today": "Сьогодні",
    "Schedule": "Розклад",
    "Earnings": "Доходи",
    "Profile": "Профіль",
    "Tickets": "Тікети",
    "Admin Panel": "Панель адміністратора",
    "God Mode": "Адмін",
    "My Salon": "Мій салон",
    "My Schedule": "Мій розклад",
    "Master": "Майстер",
    "Support": "Підтримка",
    "Tech Support": "Тех. підтримка",
    "Agent Hub": "Центр агентів",
    "Logout": "Вийти",
    "Collapse": "Згорнути",
    "LogoutConfirmTitle": "Вийти з акаунту?",
    "LogoutConfirmDesc": "Ви впевнені, що хочете вийти?",
    "Cancel": "Скасувати",
  },
  pl: {
    "Overview": "Przegląd",
    "Management": "Zarządzanie",
    "Platform": "Platforma",
    "Dashboard": "Panel",
    "Users": "Użytkownicy",
    "Tenants": "Salony",
    "Appointments": "Wizyty",
    "Inbox": "Omnichannel",
    "Platform tickets": "Zgłoszenia platformy",
    "Agents": "Agenci",
    "Billing": "Płatności",
    "Events": "Zdarzenia",
    "System": "System",
    "Settings": "Ustawienia",
    "Services": "Usługi",
    "Masters": "Mistrzowie",
    "Clients": "Klienci",
    "Channels": "Kanały",
    "Today": "Dziś",
    "Schedule": "Harmonogram",
    "Earnings": "Zarobki",
    "Profile": "Profil",
    "Tickets": "Zgłoszenia",
    "Admin Panel": "Panel administratora",
    "God Mode": "Admin",
    "My Salon": "Mój salon",
    "My Schedule": "Mój harmonogram",
    "Master": "Mistrz",
    "Support": "Wsparcie",
    "Tech Support": "Wsparcie tech.",
    "Agent Hub": "Centrum agentów",
    "Logout": "Wyloguj",
    "Collapse": "Zwiń",
    "LogoutConfirmTitle": "Wylogować się?",
    "LogoutConfirmDesc": "Czy na pewno chcesz się wylogować?",
    "Cancel": "Anuluj",
  },
  en: {
    "Overview": "Overview",
    "Management": "Management",
    "Platform": "Platform",
    "Dashboard": "Dashboard",
    "Users": "Users",
    "Tenants": "Salons",
    "Appointments": "Appointments",
    "Inbox": "Omnichannel",
    "Platform tickets": "Platform tickets",
    "Agents": "Agents",
    "Billing": "Billing",
    "Events": "Events",
    "System": "System",
    "Settings": "Settings",
    "Services": "Services",
    "Masters": "Masters",
    "Clients": "Clients",
    "Channels": "Channels",
    "Today": "Today",
    "Schedule": "Schedule",
    "Earnings": "Earnings",
    "Profile": "Profile",
    "Tickets": "Tickets",
    "Admin Panel": "Admin Panel",
    "God Mode": "Admin",
    "My Salon": "My Salon",
    "My Schedule": "My Schedule",
    "Master": "Master",
    "Support": "Support",
    "Tech Support": "Tech Support",
    "Agent Hub": "Agent Hub",
    "Logout": "Sign out",
    "Collapse": "Collapse",
    "LogoutConfirmTitle": "Sign out?",
    "LogoutConfirmDesc": "Are you sure you want to sign out?",
    "Cancel": "Cancel",
  },
};

function tNav(key: string, lang: string): string {
  return NAV_LABELS[lang]?.[key] ?? NAV_LABELS["ru"]?.[key] ?? key;
}

function buildGodGroups(lang: string): NavGroup[] {
  return [
    {
      label: tNav("Overview", lang),
      items: [
        { href: "/dashboard", icon: Home, label: tNav("Dashboard", lang) },
      ],
    },
    {
      label: tNav("Management", lang),
      items: [
        { href: "/tenants", icon: Building2, label: tNav("Tenants", lang) },
        { href: "/users", icon: Users, label: tNav("Users", lang) },
        { href: "/appointments", icon: CalendarDays, label: tNav("Appointments", lang) },
        { href: "/conversations", icon: MessageSquare, label: tNav("Inbox", lang) },
        { href: "/agents", icon: UserCog, label: tNav("Agents", lang) },
      ],
    },
    {
      label: tNav("Platform", lang),
      items: [
        { href: "/platform-support", icon: HeadphonesIcon, label: tNav("Platform tickets", lang) },
        { href: "/billing", icon: CreditCard, label: tNav("Billing", lang) },
        { href: "/events", icon: ScrollText, label: tNav("Events", lang) },
        { href: "/system", icon: Activity, label: tNav("System", lang) },
      ],
    },
  ];
}

function buildSalonNav(lang: string): NavItem[] {
  return [
    { href: "/dashboard", icon: LayoutGrid, label: tNav("Dashboard", lang) },
    { href: "/dashboard?tab=appointments", icon: CalendarDays, label: tNav("Appointments", lang) },
    { href: "/dashboard?tab=services", icon: Scissors, label: tNav("Services", lang) },
    { href: "/dashboard?tab=masters", icon: UserRound, label: tNav("Masters", lang) },
    { href: "/dashboard?tab=clients", icon: Users, label: tNav("Clients", lang) },
    { href: "/dashboard?tab=billing", icon: Wallet, label: tNav("Billing", lang) },
    { href: "/dashboard?tab=channels", icon: MessageSquare, label: tNav("Channels", lang) },
  ];
}

function buildMasterNav(lang: string): NavItem[] {
  return [
    { href: "/dashboard", icon: Home, label: tNav("Today", lang) },
    { href: "/dashboard?tab=schedule", icon: CalendarCheck, label: tNav("Schedule", lang) },
    { href: "/dashboard?tab=clients", icon: Users, label: tNav("Clients", lang) },
    { href: "/dashboard?tab=earnings", icon: Wallet, label: tNav("Earnings", lang) },
    { href: "/dashboard?tab=profile", icon: UserRound, label: tNav("Profile", lang) },
  ];
}

function buildSupportNav(lang: string): NavItem[] {
  return [{ href: "/dashboard", icon: HeadphonesIcon, label: tNav("Tickets", lang) }];
}

function getNavGroups(role: string | null, lang: string): NavGroup[] {
  if (role === "system_admin") return buildGodGroups(lang);
  const flat = role === "tenant_owner" ? buildSalonNav(lang)
    : role === "master" ? buildMasterNav(lang)
    : role === "support" || role === "technical_support" ? buildSupportNav(lang)
    : [{ href: "/dashboard", icon: Home, label: tNav("Dashboard", lang) }];
  return [{ label: "", items: flat }];
}

function getFlatNav(role: string | null, lang: string): NavItem[] {
  return getNavGroups(role, lang).flatMap(g => g.items);
}

function getRoleInfo(role: string | null, lang: string): { title: string; subtitle: string; badge?: string } {
  switch (role) {
    case "system_admin": return { title: "ManicBot", subtitle: tNav("Admin Panel", lang), badge: tNav("God Mode", lang) };
    case "tenant_owner": return { title: tNav("My Salon", lang), subtitle: tNav("Dashboard", lang) };
    case "master": return { title: tNav("My Schedule", lang), subtitle: tNav("Master", lang) };
    case "support": return { title: tNav("Support", lang), subtitle: tNav("Agent Hub", lang) };
    case "technical_support": return { title: tNav("Tech Support", lang), subtitle: tNav("Agent Hub", lang) };
    default: return { title: "ManicBot", subtitle: tNav("Dashboard", lang) };
  }
}

function getPageTitle(pathname: string, role: string | null, lang: string): string {
  if (pathname.startsWith("/settings")) return tNav("Settings", lang);
  const flat = role === "system_admin" ? buildGodGroups(lang).flatMap(g => g.items) : getFlatNav(role, lang);
  const exact = flat.find(n => n.href === pathname);
  if (exact) return exact.label;
  const match = flat.find(n => n.href !== "/" && pathname.startsWith(n.href));
  return match?.label ?? tNav("Dashboard", lang);
}

function NavLink({ item, active, collapsed, onClick, dataTour }: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  /** Product tour anchor (e.g. settings link). */
  dataTour?: string;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      data-tour={dataTour}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 relative ${
        active
          ? "bg-brand-500/10 text-brand-500 dark:text-brand-400 font-medium border-l-2 border-brand-500 dark:border-brand-400"
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-slate-200 border-l-2 border-transparent"
      } ${collapsed ? "justify-center px-0 border-l-0" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${
        active ? "text-brand-500 dark:text-brand-400" : "group-hover:text-slate-600 dark:group-hover:text-slate-300"
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
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  // Light/dark theme — default dark
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("manicbot_web_theme");
    return stored !== "light";
  });
  // Sync with document.documentElement so CSS variables (:root:not(.dark)) respond to theme toggle
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);
  const toggleTheme = () => {
    setIsDark(v => {
      const next = !v;
      localStorage.setItem("manicbot_web_theme", next ? "dark" : "light");
      return next;
    });
  };

  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const navGroups = getNavGroups(effectiveRole, lang);
  const flatNav = getFlatNav(effectiveRole, lang);
  const roleInfo = getRoleInfo(effectiveRole, lang);
  const pageTitle = getPageTitle(pathname, effectiveRole, lang);

  const handleLogout = async () => {
    setShowLogoutDialog(false);
    await signOut({ redirect: false });
    window.location.replace("/login");
  };

  const isActive = (item: NavItem) => {
    if (item.href.includes("?")) return false;
    return item.href === "/dashboard" ? pathname === "/dashboard" || pathname === "/" : pathname.startsWith(item.href);
  };

  // Mobile nav: max 5
  const mobileNav = flatNav.length <= 5
    ? flatNav
    : [...flatNav.slice(0, 4), flatNav.find(n => n.href.includes("settings")) ?? flatNav[flatNav.length - 1]!];

  // User avatar initial
  const avatarLetter = (userEmail ?? "G").charAt(0).toUpperCase();

  return (
    <WebShellContext.Provider value={true}>
      <div className={`${isDark ? "dark" : ""} flex h-screen w-full overflow-hidden bg-slate-50 dark:bg-slate-900`}>

        {/* ═══ Desktop Sidebar ═══ */}
        <aside
          data-tour="web-sidebar"
          className={`hidden lg:flex flex-col border-r border-slate-200 dark:border-white/[0.06] bg-white/90 dark:bg-slate-900/70 backdrop-blur-2xl transition-all duration-300 ease-out shrink-0 ${
            collapsed ? "w-[72px]" : "w-64"
          }`}
        >
          {/* Logo — clickable */}
          <div className={`relative flex items-center gap-3 h-16 border-b border-slate-200 dark:border-white/[0.06] ${collapsed ? "px-4 justify-center" : "px-5"}`}>
            <Link href="/dashboard" className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-700 shadow-lg shadow-brand-500/25 shrink-0">
                <Zap className="h-5 w-5 text-white" />
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <h1 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">{roleInfo.title}</h1>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">{roleInfo.subtitle}</p>
                </div>
              )}
            </Link>
            {!collapsed ? (
              <button onClick={() => setCollapsed(true)} className="p-1 rounded-lg text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 transition-colors shrink-0">
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={() => setCollapsed(false)} className="absolute -right-3 top-5 z-10 h-6 w-6 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Nav groups */}
          <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto scrollbar-none">
            {navGroups.map((group) => (
              <div key={group.label}>
                {group.label && !collapsed && (
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.href + item.label}
                      item={item}
                      active={isActive(item)}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Bottom: Settings + Logout — always visible */}
          <div className="border-t border-slate-200 dark:border-white/[0.06] p-3">
            {!collapsed ? (
              <div className="space-y-0.5">
                <NavLink
                  item={{ href: "/settings", icon: Settings, label: tNav("Settings", lang) }}
                  active={pathname.startsWith("/settings")}
                  dataTour="web-settings"
                />
                <button
                  onClick={() => setShowLogoutDialog(true)}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 w-full text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-all duration-150 border-l-2 border-transparent"
                >
                  <LogOut className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[13px]">{tNav("Logout", lang)}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <NavLink
                  item={{ href: "/settings", icon: Settings, label: tNav("Settings", lang) }}
                  active={pathname.startsWith("/settings")}
                  collapsed
                  dataTour="web-settings"
                />
                <button
                  onClick={() => setShowLogoutDialog(true)}
                  className="flex items-center justify-center p-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all w-full"
                  title={tNav("Logout", lang)}
                >
                  <LogOut className="h-[17px] w-[17px]" />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ═══ Mobile Drawer ═══ */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900/98 border-r border-slate-200 dark:border-white/[0.06] flex flex-col">
              {/* Header — clickable logo */}
              <div className="flex items-center justify-between h-16 px-5 border-b border-slate-200 dark:border-white/[0.06]">
                <Link href="/dashboard" onClick={() => setSidebarOpen(false)} className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-700 shrink-0">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-sm font-bold text-slate-900 dark:text-white">{roleInfo.title}</h1>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{roleInfo.subtitle}</p>
                  </div>
                </Link>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 shrink-0">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Nav groups */}
              <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto scrollbar-none">
                {navGroups.map((group) => (
                  <div key={group.label}>
                    {group.label && (
                      <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
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

              {/* Mobile drawer bottom: settings + user info */}
              <div className="border-t border-slate-200 dark:border-white/[0.06] p-3 space-y-1">
                <NavLink
                  item={{ href: "/settings", icon: Settings, label: tNav("Settings", lang) }}
                  active={pathname.startsWith("/settings")}
                  onClick={() => setSidebarOpen(false)}
                  dataTour="web-settings"
                />
                <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03]">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {avatarLetter}
                  </div>
                  <div className="min-w-0 flex-1">
                    {roleInfo.badge && (
                      <span className="inline-block text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-brand-500/20 text-brand-600 dark:text-brand-300 mb-0.5">
                        {roleInfo.badge}
                      </span>
                    )}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{userEmail ?? "admin"}</p>
                  </div>
                  <button
                    onClick={() => { setSidebarOpen(false); setShowLogoutDialog(true); }}
                    className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all shrink-0"
                    title={tNav("Logout", lang)}
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ═══ Main area ═══ */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header
            data-tour="web-header"
            className="h-16 flex items-center gap-3 px-4 lg:px-6 border-b border-slate-200 dark:border-white/[0.06] bg-white/95 dark:bg-slate-900/80 backdrop-blur-xl shrink-0 z-30"
          >
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Mobile logo + title */}
            <div className="lg:hidden flex items-center gap-2 min-w-0 flex-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-700 shrink-0">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{pageTitle}</span>
            </div>
            {/* Desktop: page title */}
            <div className="hidden lg:block flex-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{pageTitle}</h2>
            </div>

            {/* Right: theme toggle + user pill */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                title={isDark ? "Light mode" : "Dark mode"}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              {/* User pill — display only */}
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-2.5 py-1.5">
                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-500 to-purple-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                  {avatarLetter}
                </div>
                <span className="hidden sm:block text-xs text-slate-600 dark:text-slate-300 max-w-[120px] truncate">
                  {userEmail ?? "admin"}
                </span>
                {roleInfo.badge && (
                  <span className="hidden sm:inline-block text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-brand-500/15 text-brand-600 dark:text-brand-300">
                    {roleInfo.badge}
                  </span>
                )}
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto relative">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-brand-500/[0.05] blur-[120px]" />
              <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-500/[0.05] blur-[120px]" />
            </div>
            <div data-tour="web-content" className="relative z-10 p-4 lg:p-6 pb-8 lg:pb-6 mx-auto max-w-7xl w-full">
              {children}
            </div>
            {/* Same legal/footer links as auth + public pages; pb clears fixed mobile tab bar */}
            <div className="relative z-10 pb-24 lg:pb-6">
              <PublicFooter />
            </div>
          </main>

          {/* ═══ Mobile Bottom Nav ═══ */}
          <nav
            data-tour="web-mobile-nav"
            className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/92 backdrop-blur-xl border-t border-slate-200 dark:border-white/[0.06]"
          >
            <div className="flex items-center justify-around px-1 py-1.5">
              {mobileNav.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    data-tour={item.href === "/settings" ? "web-settings" : undefined}
                    className={`flex flex-col items-center justify-center py-1 flex-1 transition-colors ${
                      active ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-600"
                    }`}
                  >
                    <div className={`p-1.5 rounded-xl transition-all ${active ? "bg-brand-500/15 scale-110" : ""}`}>
                      <item.icon className="h-5 w-5" />
                    </div>
                    <span className={`text-[9px] font-medium mt-0.5 ${active ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-700"}`}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {/* ═══ Logout confirmation dialog ═══ */}
        {showLogoutDialog && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowLogoutDialog(false); }}
          >
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 p-6 shadow-2xl max-w-sm w-full mx-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                {tNav("LogoutConfirmTitle", lang)}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                {tNav("LogoutConfirmDesc", lang)}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLogoutDialog(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"
                >
                  {tNav("Cancel", lang)}
                </button>
                <button
                  onClick={handleLogout}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 text-white text-sm font-semibold transition-colors"
                >
                  {tNav("Logout", lang)}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <DashboardOnboarding />
    </WebShellContext.Provider>
  );
}
