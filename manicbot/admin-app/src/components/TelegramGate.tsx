"use client";

import { useEffect, useState } from "react";
import { ShieldOff, Smartphone } from "lucide-react";
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

  // — No Telegram + loading web session check
  if (initStatus === "no-telegram" && roleQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
          <p className="text-sm text-slate-400">{t("gate.init", lang)}</p>
        </div>
      </div>
    );
  }

  // — No Telegram and no web session → redirect to login
  if (initStatus === "no-telegram" && !roleQuery.isLoading && !roleQuery.data?.role) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
          <Smartphone className="h-10 w-10 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{t("gate.tgOnly", lang)}</h1>
          <p className="mt-2 text-slate-400">{t("gate.tgOnlyDesc", lang)}</p>
          <a
            href="/login"
            className="mt-4 inline-block rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            {t("gate.webLogin", lang)}
          </a>
        </div>
      </div>
    );
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
