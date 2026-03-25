"use client";

import { useEffect, useState } from "react";
import { ShieldOff, Smartphone } from "lucide-react";
import { api } from "~/trpc/react";
import { RoleContext } from "~/components/RoleContext";
import { SalonDashboard } from "~/components/dashboards/SalonDashboard";
import { MasterDashboard } from "~/components/dashboards/MasterDashboard";
import { SupportDashboard } from "~/components/dashboards/SupportDashboard";

type InitStatus = "loading" | "ok" | "no-telegram";

export function TelegramGate({ children }: { children: React.ReactNode }) {
  const [initStatus, setInitStatus] = useState<InitStatus>("loading");
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.initData) {
      setInitStatus("no-telegram");
      return;
    }
    try {
      tg.ready();
      tg.expand();
    } catch {}
    try {
      const params = new URLSearchParams(tg.initData);
      const userStr = params.get("user");
      if (userStr) {
        const user = JSON.parse(userStr) as { id: number };
        setUserId(user.id);
      }
    } catch {}
    setInitStatus("ok");
  }, []);

  const roleQuery = api.auth.getMyRole.useQuery(undefined, {
    enabled: initStatus === "ok",
    retry: false,
  });

  // — No Telegram
  if (initStatus === "no-telegram") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
          <Smartphone className="h-10 w-10 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Только через Telegram</h1>
          <p className="mt-2 text-slate-400">
            Панель управления открывается только как Telegram Mini App.
          </p>
        </div>
      </div>
    );
  }

  // — Loading (init or role query)
  if (initStatus === "loading" || roleQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
          <p className="text-sm text-slate-400">Инициализация...</p>
        </div>
      </div>
    );
  }

  // — Error or no role (forbidden)
  if (roleQuery.isError || !roleQuery.data?.role) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
          <ShieldOff className="h-10 w-10 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Доступ запрещён</h1>
          <p className="mt-2 text-slate-400">
            У вас нет доступа к панели управления.
          </p>
        </div>
      </div>
    );
  }

  const { role, tenantId } = roleQuery.data;
  const ctx = { role, tenantId, userId };

  // — Route by role
  return (
    <RoleContext.Provider value={ctx}>
      {role === "system_admin" ? (
        // God Mode — existing pages tree
        <>{children}</>
      ) : role === "tenant_owner" ? (
        <SalonDashboard tenantId={tenantId!} />
      ) : role === "master" ? (
        <MasterDashboard tenantId={tenantId!} masterId={userId!} />
      ) : role === "support" || role === "technical_support" ? (
        <SupportDashboard />
      ) : (
        // fallback forbidden
        <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
            <ShieldOff className="h-10 w-10 text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Доступ запрещён</h1>
          </div>
        </div>
      )}
    </RoleContext.Provider>
  );
}
