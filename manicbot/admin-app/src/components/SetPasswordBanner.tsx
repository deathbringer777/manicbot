"use client";

import { useState } from "react";
import { Key, X } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

const COPY: Record<Lang, { message: string; action: string }> = {
  ru: { message: "У вас не установлен пароль. Установите его для входа по email.", action: "Установить пароль" },
  ua: { message: "Ви не маєте пароля. Встановіть його для входу через email.", action: "Встановити пароль" },
  en: { message: "You don't have a password set. Set one to log in with email.", action: "Set password" },
  pl: { message: "Nie masz ustawionego hasła. Ustaw je, aby logować się emailem.", action: "Ustaw hasło" },
};

export function SetPasswordBanner() {
  const { hasPassword } = useRole();
  const { lang } = useLang();
  const [dismissed, setDismissed] = useState(false);
  const copy = COPY[lang];

  if (hasPassword || dismissed) return null;

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 pt-3">
      <div className="flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-amber-50/80 px-4 py-3 dark:border-amber-400/20 dark:bg-amber-500/10">
        <Key className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">{copy.message}</p>
        <a
          href="/settings?section=account"
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
        >
          {copy.action}
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-lg p-1 text-amber-400 transition hover:bg-amber-200/50 hover:text-amber-600 dark:hover:bg-amber-500/20"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
