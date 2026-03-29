"use client";

import { useEffect, useState } from "react";
import { ShieldOff } from "lucide-react";
import { api } from "~/trpc/react";
import { RoleContext } from "~/components/RoleContext";
import { SalonDashboard } from "~/components/dashboards/SalonDashboard";
import { MasterDashboard } from "~/components/dashboards/MasterDashboard";
import { SupportDashboard } from "~/components/dashboards/SupportDashboard";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import type { AppRole } from "~/server/api/routers/auth";

type InitStatus = "loading" | "ok" | "no-telegram";

export function TelegramGate({ children }: { children: React.ReactNode }) {
  const [initStatus, setInitStatus] = useState<InitStatus>("loading");
  const [userId, setUserId] = useState<number | null>(null);
  const [previewRole, setPreviewRoleState] = useState<AppRole>(null);
  const [previewTenantId, setPreviewTenantId] = useState<string | null>(null);
  const { lang } = useLang();

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.initData) { setInitStatus("no-telegram"); return; }
    try { tg.ready(); tg.expand(); } catch {}
    try {
      const params = new URLSearchParams(tg.initData);
      const userStr = params.get("user");
      if (userStr) setUserId((JSON.parse(userStr) as { id: number }).id);
    } catch {}
    setInitStatus("ok");
  }, []);

  // Always query role: works for Telegram Mini App AND web sessions (next-auth cookie)
  const roleQuery = api.auth.getMyRole.useQuery(undefined, {
    enabled: initStatus !== "loading",
    retry: false,
  });

  function setPreviewRole(r: AppRole, tenantId?: string | null) {
    setPreviewRoleState(r);
    setPreviewTenantId(tenantId ?? null);
  }

  // — No Telegram context: check web session (next-auth cookie)
  if (initStatus === "no-telegram") {
    // On /login page — always render children directly (the login form)
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/login")) {
      return <>{children}</>;
    }
    // Still loading web session — show spinner
    if (roleQuery.isLoading) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
        </div>
      );
    }
    // No web session — redirect to login silently
    if (!roleQuery.data?.role) {
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
        </div>
      );
    }
    // Web session found — fall through to render dashboard below
  }

  // — Loading
  if (initStatus === "loading" || roleQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
          <p className="text-sm text-slate-400">{t("gate.init", lang)}</p>
        </div>
      </div>
    );
  }

  // — No role (forbidden)
  if (roleQuery.isError || !roleQuery.data?.role) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
          <ShieldOff className="h-10 w-10 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{t("gate.forbidden", lang)}</h1>
          <p className="mt-2 text-slate-400">{t("gate.forbiddenDesc", lang)}</p>
        </div>
      </div>
    );
  }

  const { role, tenantId } = roleQuery.data;

  // Effective role — creator can preview as any role
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  const ctxValue = {
    role,
    tenantId,
    userId,
    previewRole,
    previewTenantId,
    setPreviewRole,
  };

  return (
    <RoleContext.Provider value={ctxValue}>
      {effectiveRole === "system_admin" ? (
        <>{children}</>
      ) : effectiveRole === "tenant_owner" ? (
        <SalonDashboard tenantId={effectiveTenantId!} />
      ) : effectiveRole === "master" ? (
        <MasterDashboard tenantId={effectiveTenantId!} masterId={userId!} />
      ) : effectiveRole === "support" || effectiveRole === "technical_support" ? (
        <SupportDashboard />
      ) : (
        <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
            <ShieldOff className="h-10 w-10 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t("gate.forbidden", lang)}</h1>
        </div>
      )}
    </RoleContext.Provider>
  );
}
