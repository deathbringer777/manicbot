"use client";

import { useState } from "react";
import { Zap, Building2, Scissors, HeadphonesIcon, X, ChevronDown } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { api } from "~/trpc/react";
import type { AppRole } from "~/server/api/routers/auth";

const ROLE_OPTIONS: { role: AppRole; icon: React.ElementType; color: string }[] = [
  { role: "system_admin",  icon: Zap,              color: "text-brand-400" },
  { role: "tenant_owner",  icon: Building2,         color: "text-purple-400" },
  { role: "master",        icon: Scissors,          color: "text-emerald-400" },
  { role: "support",       icon: HeadphonesIcon,    color: "text-amber-400" },
];

export function RoleSwitcher() {
  const { role, previewRole, previewTenantId, setPreviewRole, userId } = useRole();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<AppRole>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");

  // Only render for system_admin
  if (role !== "system_admin") return null;

  const tenants = api.tenants.getAll.useQuery(undefined, {
    enabled: open && (pendingRole === "tenant_owner" || pendingRole === "master"),
  });

  const activePreview = previewRole && previewRole !== "system_admin";
  const currentDisplay = activePreview ? previewRole : "system_admin";

  function handleSelectRole(r: AppRole) {
    if (r === "system_admin") {
      setPreviewRole(null);
      setOpen(false);
      return;
    }
    if (r === "support" || r === "technical_support") {
      setPreviewRole(r);
      setOpen(false);
      return;
    }
    // tenant-scoped: need a tenantId
    setPendingRole(r);
    setSelectedTenantId("");
  }

  function confirmTenantPreview() {
    if (!selectedTenantId || !pendingRole) return;
    setPreviewRole(pendingRole, selectedTenantId);
    setPendingRole(null);
    setOpen(false);
  }

  const roleLabel: Record<string, string> = {
    system_admin: t("roleSwitch.godMode", lang),
    tenant_owner: t("roleSwitch.salon", lang),
    master: t("roleSwitch.master", lang),
    support: t("roleSwitch.support", lang),
    technical_support: t("roleSwitch.support", lang),
  };

  return (
    <div className="relative">
      {/* Preview banner — shown outside the switcher panel */}
      {activePreview && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-1.5 mb-2">
          <span className="text-amber-400 text-xs font-medium">
            {t("roleSwitch.preview", lang)} {roleLabel[previewRole ?? ""] ?? previewRole}
          </span>
          <button
            onClick={() => setPreviewRole(null)}
            className="ml-auto text-amber-500 hover:text-amber-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Switcher button */}
      <button
        onClick={() => { setOpen(o => !o); setPendingRole(null); }}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 transition-colors text-left"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-500/20 shrink-0">
          {(() => {
            const opt = ROLE_OPTIONS.find(o => o.role === currentDisplay);
            if (!opt) return null;
            const Icon = opt.icon;
            return <Icon className={`h-3.5 w-3.5 ${opt.color}`} />;
          })()}
        </div>
        <span className="flex-1 text-xs font-medium text-slate-300">
          {roleLabel[currentDisplay ?? "system_admin"] ?? currentDisplay}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-slate-900 border border-slate-700 rounded-2xl p-2 shadow-xl shadow-black/50">
          <p className="text-[10px] text-slate-500 px-2 pb-2 font-medium uppercase tracking-wider">
            {t("roleSwitch.title", lang)}
          </p>

          {pendingRole ? (
            // Tenant picker step
            <div className="p-2 space-y-2">
              <p className="text-xs text-slate-400">{t("roleSwitch.pickTenant", lang)}</p>
              {tenants.isLoading ? (
                <p className="text-xs text-slate-500">...</p>
              ) : (
                <select
                  value={selectedTenantId}
                  onChange={e => setSelectedTenantId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="">— выбрать —</option>
                  {tenants.data?.map((tn: any) => (
                    <option key={tn.id} value={tn.id}>{tn.name}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingRole(null)}
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-800 text-slate-400 hover:text-slate-200"
                >
                  {t("common.back", lang)}
                </button>
                <button
                  onClick={confirmTenantPreview}
                  disabled={!selectedTenantId}
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 disabled:opacity-40"
                >
                  OK
                </button>
              </div>
            </div>
          ) : (
            // Role list
            ROLE_OPTIONS.map(({ role: r, icon: Icon, color }) => (
              <button
                key={r}
                onClick={() => handleSelectRole(r)}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl transition-colors text-left ${
                  currentDisplay === r
                    ? "bg-brand-500/10 text-white"
                    : "hover:bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                <Icon className={`h-4 w-4 ${color} shrink-0`} />
                <span className="text-xs font-medium">{roleLabel[r ?? ""] ?? r}</span>
                {currentDisplay === r && (
                  <span className="ml-auto text-[10px] text-brand-400">✓</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
