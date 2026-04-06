"use client";

import { useState, useEffect } from "react";
import { X, MailWarning } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

const L: Record<Lang, { title: string; description: string; verify: string }> = {
  ru: {
    title: "Email не подтверждён",
    description: "Подтвердите email для полного доступа к панели управления.",
    verify: "Подтвердить",
  },
  ua: {
    title: "Email не підтверджено",
    description: "Підтвердіть email для повного доступу до панелі керування.",
    verify: "Підтвердити",
  },
  en: {
    title: "Email not verified",
    description: "Verify your email for full access to the dashboard.",
    verify: "Verify",
  },
  pl: {
    title: "Email nie potwierdzony",
    description: "Potwierdź email, aby uzyskać pełny dostęp do panelu.",
    verify: "Potwierdź",
  },
};

const STORAGE_KEY = "manicbot_email_popup_dismissed";

export function EmailVerificationPopup() {
  const router = useRouter();
  const { lang } = useLang();
  const l = L[lang];
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    sessionStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="glass-card rounded-2xl p-6 max-w-sm w-full space-y-4 relative border border-red-500/20 shadow-2xl">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
            <MailWarning className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{l.title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{l.description}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              dismiss();
              router.push("/settings?section=account");
            }}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors"
          >
            {l.verify}
          </button>
          <button
            onClick={dismiss}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600/60 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-slate-400 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
