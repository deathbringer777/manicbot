"use client";

/**
 * TenantSwitcher — header dropdown that lets a multi-salon user switch their
 * ACTIVE salon. Renders NOTHING when the user belongs to 0–1 salons, so it is
 * invisible for the overwhelming majority (single-tenant) and only appears for
 * a dual-role user (e.g. an owner who also accepted a master invite elsewhere).
 *
 * On select: `auth.switchTenant` writes `web_users.active_tenant_id`, then we
 * refresh the NextAuth session (`update()`) so the JWT re-resolves
 * (tenantId, role) for the new salon, invalidate all tRPC caches, and land on
 * the dashboard of the now-active salon.
 *
 * Membership is validated server-side in `switchTenant`; this component never
 * decides access.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Building2, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { CreateSalonModal } from "~/components/salon/CreateSalonModal";

function roleLabel(role: string, lang: string): string {
  const map: Record<string, Record<string, string>> = {
    tenant_owner: { ru: "Владелец", ua: "Власник", pl: "Właściciel", en: "Owner" },
    tenant_manager: { ru: "Менеджер", ua: "Менеджер", pl: "Menedżer", en: "Manager" },
    master: { ru: "Мастер", ua: "Майстер", pl: "Mistrz", en: "Master" },
  };
  return map[role]?.[lang] ?? role;
}

const HEADER_LABEL: Record<string, string> = {
  ru: "Ваши салоны",
  ua: "Ваші салони",
  pl: "Twoje salony",
  en: "Your salons",
};

const CREATE_LABEL: Record<string, string> = {
  ru: "Создать салон",
  ua: "Створити салон",
  pl: "Utwórz salon",
  en: "Create salon",
};

export function TenantSwitcher() {
  const { lang } = useLang();
  const router = useRouter();
  const { update } = useSession();
  const { tenantId: activeTenantId, role, tenantName } = useRole();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const memberships = api.auth.listMyTenants.useQuery(undefined, { staleTime: 60_000 });
  const switchTenant = api.auth.switchTenant.useMutation();
  const [createOpen, setCreateOpen] = useState(false);

  // Multi-salon (MAX plan): a MAX owner can create additional salons. Fetch the
  // active tenant's plan only for owners (the procedure is owner-scoped).
  const billing = api.salon.getBillingStatus.useQuery(
    { tenantId: activeTenantId ?? "" },
    { enabled: !!activeTenantId && role === "tenant_owner", staleTime: 60_000 },
  );
  const canCreate = role === "tenant_owner" && billing.data?.plan === "max";

  // Outside-click + Escape close (mirrors NotificationBell).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = memberships.data ?? [];

  // Nothing to switch between AND can't create → keep the header clean. A master
  // still sees a non-interactive salon label ("which salon am I working in?").
  // A MAX owner with a single salon DOES see the dropdown, so they can create a
  // second salon straight from the header.
  if (items.length < 2 && !canCreate) {
    if (role === "master" && tenantName) {
      return (
        <div
          data-testid="tenant-salon-label"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium max-w-[180px]"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{tenantName}</span>
        </div>
      );
    }
    return null;
  }

  // Owners always have at least their home tenant in the list.
  if (items.length === 0) return null;
  const active = items.find((m) => m.tenantId === activeTenantId) ?? items[0]!;

  async function choose(tenantId: string) {
    if (switchTenant.isPending) return;
    if (tenantId === activeTenantId) { setOpen(false); return; }
    await switchTenant.mutateAsync({ tenantId });
    // Session must re-resolve (tenantId, role) before any tenant-scoped query
    // runs again; then wipe caches and land on the new salon's dashboard.
    await update();
    await utils.invalidate();
    setOpen(false);
    router.push("/dashboard");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="tenant-switcher"
        aria-expanded={open}
        title={active.tenantName ?? "ManicBot"}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#e5e7eb] dark:border-white/10 bg-white dark:bg-white/[0.04] text-[#1a1a2e] dark:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/8 transition-colors text-[12px] font-medium max-w-[200px]"
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-[#6b7280] dark:text-slate-400" />
        <span className="truncate hidden sm:inline">{active.tenantName ?? "ManicBot"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6b7280] dark:text-slate-400" />
      </button>

      {open && (
        <div
          data-testid="tenant-switcher-menu"
          className="absolute right-0 top-10 z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl shadow-black/20 dark:shadow-black/60 overflow-hidden"
        >
          <p className="px-3 pt-2.5 pb-1 text-[10px] uppercase font-bold tracking-wider text-slate-400">
            {HEADER_LABEL[lang] ?? HEADER_LABEL.en}
          </p>
          <ul className="py-1 max-h-80 overflow-y-auto">
            {items.map((m) => {
              const isActive = m.tenantId === activeTenantId;
              return (
                <li key={m.tenantId}>
                  <button
                    type="button"
                    onClick={() => void choose(m.tenantId)}
                    disabled={switchTenant.isPending}
                    data-testid="tenant-switcher-item"
                    data-active={isActive ? "true" : "false"}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05] disabled:opacity-50 ${
                      isActive ? "bg-indigo-500/[0.06]" : ""
                    }`}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0 bg-purple-500/10 text-purple-500 dark:text-purple-400">
                      <Building2 className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-900 dark:text-white truncate">
                        {m.tenantName ?? "ManicBot"}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {roleLabel(m.role, lang)}
                      </p>
                    </div>
                    {switchTenant.isPending && switchTenant.variables?.tenantId === m.tenantId ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" />
                    ) : isActive ? (
                      <Check className="h-4 w-4 shrink-0 text-indigo-500" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {canCreate && (
            <div className="border-t border-slate-100 dark:border-white/10 p-1">
              <button
                type="button"
                onClick={() => { setOpen(false); setCreateOpen(true); }}
                data-testid="tenant-switcher-create"
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-lg transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <span className="text-[13px] font-medium text-slate-900 dark:text-white">
                  {CREATE_LABEL[lang] ?? CREATE_LABEL.en}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
      {createOpen && <CreateSalonModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
