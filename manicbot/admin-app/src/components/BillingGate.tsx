"use client";

import { AlertCircle, CreditCard, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

const L: Record<Lang, {
  title: string;
  description: string;
  primaryCta: string;
  secondaryCta: string;
  note: string;
}> = {
  ru: {
    title: "Доступ к панели ограничен",
    description: "Чтобы вернуть доступ, оформите или продлите подписку. Пока она не активна, панель и бот приостановлены — клиенты не смогут записаться.",
    primaryCta: "Активировать подписку",
    secondaryCta: "Настройки аккаунта",
    note: "Если уже оплатили — обновите страницу, статус подтянется в течение минуты.",
  },
  ua: {
    title: "Доступ до панелі обмежено",
    description: "Щоб повернути доступ, оформіть або продовжте підписку. Поки вона не активна, панель і бот призупинені — клієнти не зможуть записатися.",
    primaryCta: "Активувати підписку",
    secondaryCta: "Налаштування акаунту",
    note: "Якщо вже сплатили — оновіть сторінку, статус підтягнеться протягом хвилини.",
  },
  en: {
    title: "Dashboard access is limited",
    description: "Subscribe or renew to restore access. While the subscription is inactive, the dashboard and bot are paused — clients can't book.",
    primaryCta: "Activate subscription",
    secondaryCta: "Account settings",
    note: "Already paid? Refresh the page — the status will catch up within a minute.",
  },
  pl: {
    title: "Dostęp do panelu jest ograniczony",
    description: "Wykup lub odnów subskrypcję, aby przywrócić dostęp. Gdy subskrypcja jest nieaktywna, panel i bot są wstrzymane — klienci nie mogą rezerwować.",
    primaryCta: "Aktywuj subskrypcję",
    secondaryCta: "Ustawienia konta",
    note: "Już zapłaciłeś? Odśwież stronę — status zostanie zaktualizowany w ciągu minuty.",
  },
};

export function BillingGate() {
  const router = useRouter();
  const { lang } = useLang();
  const l = L[lang];

  return (
    <div
      data-testid="billing-gate"
      className="flex flex-1 items-center justify-center p-6"
    >
      <div className="glass-card rounded-2xl p-8 max-w-md w-full text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-full bg-red-500/15 flex items-center justify-center">
          <AlertCircle className="h-7 w-7 text-red-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{l.title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{l.description}</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => router.push("/settings?section=billing")}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors"
          >
            <CreditCard className="h-4 w-4" />
            {l.primaryCta}
          </button>
          <button
            onClick={() => router.push("/settings?section=account")}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="h-4 w-4" />
            {l.secondaryCta}
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-200 dark:border-slate-800">
          {l.note}
        </p>
      </div>
    </div>
  );
}
