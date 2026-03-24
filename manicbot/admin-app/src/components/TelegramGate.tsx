"use client";

import { useEffect, useState } from "react";
import { ShieldOff, Smartphone } from "lucide-react";

const CREATOR_ID = 321706035;

type GateStatus = "loading" | "ok" | "no-telegram" | "forbidden";

export function TelegramGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>("loading");

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;

    if (!tg?.initData) {
      setStatus("no-telegram");
      return;
    }

    try {
      tg.ready();
      tg.expand();
    } catch {}

    try {
      const params = new URLSearchParams(tg.initData);
      const userStr = params.get("user");
      if (!userStr) {
        setStatus("forbidden");
        return;
      }
      const user = JSON.parse(userStr) as { id: number };
      if (user.id === CREATOR_ID) {
        setStatus("ok");
      } else {
        setStatus("forbidden");
      }
    } catch {
      setStatus("forbidden");
    }
  }, []);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
          <p className="text-sm text-slate-400">Инициализация...</p>
        </div>
      </div>
    );
  }

  if (status === "no-telegram") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
          <Smartphone className="h-10 w-10 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Только через Telegram</h1>
          <p className="mt-2 text-slate-400">
            Эта панель управления открывается только как Telegram Mini App.
            <br />
            Нажмите кнопку «God Mode» в боте.
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-3 font-mono text-xs text-slate-500">
          @manic_preview_bot → God Mode
        </div>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
          <ShieldOff className="h-10 w-10 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Доступ запрещён</h1>
          <p className="mt-2 text-slate-400">
            God Mode доступен только создателю платформы.
            <br />
            Ваш аккаунт не авторизован для доступа.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
