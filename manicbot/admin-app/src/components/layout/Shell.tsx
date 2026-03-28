"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, Zap, UserCog, ChevronDown,
  X, Scissors, HeadphonesIcon, Globe,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t, LANGS } from "~/lib/i18n";
import { api } from "~/trpc/react";
import type { AppRole } from "~/server/api/routers/auth";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

// ─── God Mode nav items ──────────────────────────────────────────
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

// ─── Role Switcher (inline in header) ────────────────────────────
const ROLE_OPTIONS: { role: AppRole; icon: React.ElementType; color: string; bg: string }[] = [
  { role: "system_admin",  icon: Zap,            color: "text-blue-400",    bg: "bg-blue-500/20" },
  { role: "tenant_owner",  icon: Building2,       color: "text-purple-400",  bg: "bg-purple-500/20" },
  { role: "master",        icon: Scissors,        color: "text-emerald-400", bg: "bg-emerald-500/20" },
  { role: "support",       icon: HeadphonesIcon,  color: "text-amber-400",   bg: "bg-amber-500/20" },
];

export function RoleSwitcherInline({ placement = "toolbar" }: { placement?: "toolbar" | "settings" }) {
  const { role, previewRole, setPreviewRole } = useRole();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<AppRole>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const tenants = api.tenants.getAll.useQuery(undefined, {
    enabled: role === "system_admin" && open && (pendingRole === "tenant_owner" || pendingRole === "master"),
  });

  if (role !== "system_admin") return null;

  const inSettings = placement === "settings";
  const activePreview = previewRole && previewRole !== "system_admin";
  const currentDisplay = activePreview ? previewRole : "system_admin";
  const opt = ROLE_OPTIONS.find(o => o.role === currentDisplay);
  const Icon = opt?.icon ?? Zap;

  const roleLabel: Record<string, string> = {
    system_admin: t("roleSwitch.godMode", lang),
    tenant_owner: t("roleSwitch.salon", lang),
    master: t("roleSwitch.master", lang),
    support: t("roleSwitch.support", lang),
    technical_support: t("roleSwitch.support", lang),
  };

  function handleSelectRole(r: AppRole) {
    if (r === "system_admin") { setPreviewRole(null); setOpen(false); return; }
    if (r === "support" || r === "technical_support") { setPreviewRole(r); setOpen(false); return; }
    setPendingRole(r); setSelectedTenantId("");
  }

  function confirmTenantPreview() {
    if (!selectedTenantId || !pendingRole) return;
    setPreviewRole(pendingRole, selectedTenantId);
    setPendingRole(null); setOpen(false);
  }

  return (
    <div className={`relative ${inSettings ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setPendingRole(null); }}
        className={`flex items-center gap-1.5 rounded-xl text-xs font-medium transition-all ${
          inSettings ? "w-full justify-between px-3 py-3" : "px-2.5 py-1.5"
        } ${
          activePreview
            ? "bg-amber-500/20 border border-amber-500/30 text-amber-300"
            : "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${opt?.color ?? "text-blue-400"}`} />
          <span className={inSettings ? "truncate" : "max-w-[80px] truncate"}>{roleLabel[currentDisplay ?? "system_admin"]}</span>
        </span>
        <ChevronDown className={`h-3 w-3 text-slate-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Preview exit — toolbar: under control; settings: inline */}
      {activePreview && !open && !inSettings && (
        <button
          type="button"
          onClick={() => setPreviewRole(null)}
          className="absolute -bottom-7 left-0 right-0 flex items-center justify-center gap-1 text-[10px] text-amber-400 hover:text-amber-300"
        >
          <X className="h-3 w-3" /> {t("roleSwitch.exit", lang)}
        </button>
      )}
      {activePreview && !open && inSettings && (
        <button
          type="button"
          onClick={() => setPreviewRole(null)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
        >
          <X className="h-3.5 w-3.5" /> {t("roleSwitch.exit", lang)}
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute top-full mt-2 z-50 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-2 shadow-2xl shadow-black/60 ${
            inSettings ? "left-0 right-0 w-full" : "right-0 w-56"
          }`}>
            <p className="text-[10px] text-slate-500 px-2 pb-2 font-medium uppercase tracking-wider">
              {t("roleSwitch.title", lang)}
            </p>
            {pendingRole ? (
              <div className="p-2 space-y-2">
                <p className="text-xs text-slate-400">{t("roleSwitch.pickTenant", lang)}</p>
                {tenants.isLoading ? (
                  <div className="h-8 bg-slate-800 rounded-xl animate-pulse" />
                ) : (
                  <select
                    value={selectedTenantId}
                    onChange={e => setSelectedTenantId(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 text-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="">—</option>
                    {tenants.data?.map((tn: any) => (
                      <option key={tn.id} value={tn.id}>{tn.name}</option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <button onClick={() => setPendingRole(null)} className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors">
                    {t("common.back", lang)}
                  </button>
                  <button onClick={confirmTenantPreview} disabled={!selectedTenantId}
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 disabled:opacity-30 transition-colors">
                    OK
                  </button>
                </div>
              </div>
            ) : (
              ROLE_OPTIONS.map(({ role: r, icon: RIcon, color, bg }) => (
                <button
                  key={r}
                  onClick={() => handleSelectRole(r)}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all text-left ${
                    currentDisplay === r ? "bg-white/10 text-white" : "hover:bg-white/5 text-slate-400 hover:text-white"
                  }`}
                >
                  <div className={`h-7 w-7 rounded-lg ${bg} flex items-center justify-center`}>
                    <RIcon className={`h-3.5 w-3.5 ${color}`} />
                  </div>
                  <span className="text-xs font-medium flex-1">{roleLabel[r ?? ""] ?? r}</span>
                  {currentDisplay === r && <div className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Language: icon popover (toolbar) or open grid (settings) ─────
export function LangPickerInline({ placement = "toolbar" }: { placement?: "toolbar" | "settings" }) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);

  if (placement === "settings") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {LANGS.map(({ code, flag, label }) => (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-medium transition-all ${
              lang === code
                ? "bg-brand-500/20 border-brand-500/40 text-brand-300"
                : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10"
            }`}
          >
            <span className="text-2xl leading-none">{flag}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center h-8 w-8 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
        title={t("settings.language", lang)}
      >
        <Globe className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl shadow-black/60">
            <div className="grid grid-cols-2 gap-1.5 w-[140px]">
              {LANGS.map(({ code, flag, label }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => { setLang(code); setOpen(false); }}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-all ${
                    lang === code
                      ? "bg-brand-500/20 border border-brand-500/40 text-brand-300"
                      : "bg-white/5 border border-transparent text-slate-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <span className="text-base">{flag}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shell Component ─────────────────────────────────────────────
interface ShellProps {
  children: React.ReactNode;
  navItems?: NavItem[];
  title?: string;
  subtitle?: string;
}

export function Shell({ children, navItems, title, subtitle }: ShellProps) {
  const pathname = usePathname();
  const [admin, setAdmin] = useState({ name: "God Mode", username: "creator" });
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const activeNavItems = navItems ?? godModeNavItems;
  const displayTitle = title ?? "ManicBot";
  /** Creator in plain God Mode: language + preview mode live on /settings, not in the chrome (avoids clash with Settings tab). */
  const godPlainChrome = role === "system_admin" && !previewRole;
  const showLangInChrome = !godPlainChrome;
  const showRoleSwitcherInChrome = role === "system_admin" && !!previewRole;

  useEffect(() => { setAdmin(getAdminInfo()); }, []);

  // Mobile: show max 5 tabs. If more, last slot = "More" (Settings icon)
  const mobileNavItems = activeNavItems.length <= 5
    ? activeNavItems
    : activeNavItems.slice(0, 5);

  return (
    <div className="flex h-screen w-full flex-col md:flex-row bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 flex-col border-r border-white/5 bg-slate-900/50 p-4 shrink-0">
        {/* Logo + title */}
        <div className="mb-6 px-1 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-lg shadow-brand-500/25">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white truncate">{displayTitle}</h1>
            <p className="text-[10px] text-slate-500">{subtitle ?? "Admin Panel"}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {activeNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all text-sm ${
                  isActive
                    ? "bg-brand-500/15 text-brand-400 font-medium"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-brand-400" : ""}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="mt-3 border-t border-white/5 pt-3 space-y-3">
          {showRoleSwitcherInChrome && <RoleSwitcherInline />}
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0">
              {admin.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">{admin.name}</p>
              <p className="text-[10px] text-slate-500">@{admin.username}</p>
            </div>
            {showLangInChrome && <LangPickerInline />}
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-slate-950/80 backdrop-blur-lg sticky top-0 z-40">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 shrink-0">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-sm font-bold text-white flex-1 truncate">{displayTitle}</h1>
          {showRoleSwitcherInChrome && <RoleSwitcherInline />}
          {showLangInChrome && <LangPickerInline />}
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-6 relative">
          {/* Decorative gradient orbs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-brand-500/8 blur-[100px]" />
            <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-purple-500/8 blur-[100px]" />
          </div>
          <div className="relative z-10 mx-auto max-w-7xl w-full">{children}</div>
        </main>

        {/* ── Mobile Bottom Nav (fixed, equal-width tabs) ── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-xl border-t border-white/5">
          <div className="flex items-center justify-around px-1 py-1 safe-area-pb">
            {mobileNavItems.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-all ${
                    isActive ? "text-brand-400" : "text-slate-500"
                  }`}
                >
                  <div className={`p-1 rounded-lg transition-all ${isActive ? "bg-brand-500/20 scale-110" : ""}`}>
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className={`text-[9px] font-medium mt-0.5 ${isActive ? "text-brand-400" : "text-slate-600"}`}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
