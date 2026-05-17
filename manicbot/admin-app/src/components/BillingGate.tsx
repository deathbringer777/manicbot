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
    title: "Триал закончился",
    description: "Чтобы продолжить пользоваться панелью, активируйте подписку. Запись клиентов через бота работает как раньше — блокируется только админ-панель.",
    primaryCta: "Активировать подписку",
    secondaryCta: "Настройки аккаунта",
    note: "Если уже оплатили — обновите страницу, статус подтянется в течение минуты.",
  },
  ua: {
    title: "Тріал закінчився",
    description: "Щоб продовжити користуватися панеллю, активуйте підписку. Запис клієнтів через бота працює, як і раніше — блокується тільки адмін-панель.",
    primaryCta: "Активувати підписку",
    secondaryCta: "Налаштування акаунту",
    note: "Якщо вже сплатили — оновіть сторінку, статус підтягнеться протягом хвилини.",
  },
  en: {
    title: "Your trial has ended",
    description: "Activate a subscription to keep using the dashboard. Client bookings through the bot keep working — only the admin panel is blocked.",
    primaryCta: "Activate subscription",
    secondaryCta: "Account settings",
    note: "Already paid? Refresh the page — the status will catch up within a minute.",
  },
  pl: {
    title: "Twój okres próbny zakończył się",
    description: "Aby kontynuować korzystanie z panelu, aktywuj subskrypcję. Rezerwacje przez bota działają jak wcześniej — blokowany jest tylko panel administracyjny.",
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
