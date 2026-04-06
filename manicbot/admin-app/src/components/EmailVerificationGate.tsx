"use client";

import { ShieldAlert, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

const L: Record<Lang, { title: string; description: string; button: string }> = {
  ru: {
    title: "Подтвердите email",
    description: "Для доступа к панели управления подтвердите ваш email-адрес. Перейдите в настройки аккаунта.",
    button: "Открыть настройки",
  },
  ua: {
    title: "Підтвердіть email",
    description: "Для доступу до панелі керування підтвердіть вашу email-адресу. Перейдіть до налаштувань акаунту.",
    button: "Відкрити налаштування",
  },
  en: {
    title: "Verify your email",
    description: "To access the dashboard, please verify your email address. Go to account settings.",
    button: "Open settings",
  },
  pl: {
    title: "Potwierdź email",
    description: "Aby uzyskać dostęp do panelu, potwierdź swój adres email. Przejdź do ustawień konta.",
    button: "Otwórz ustawienia",
  },
};

export function EmailVerificationGate() {
  const router = useRouter();
  const { lang } = useLang();
  const l = L[lang];

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="glass-card rounded-2xl p-8 max-w-md w-full text-center space-y-4">
        <div className="mx-auto h-14 w-14 rounded-full bg-red-500/15 flex items-center justify-center">
          <ShieldAlert className="h-7 w-7 text-red-400" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{l.title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{l.description}</p>
        <button
          onClick={() => router.push("/settings?section=account")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors"
        >
          <Settings className="h-4 w-4" />
          {l.button}
        </button>
      </div>
    </div>
  );
}
