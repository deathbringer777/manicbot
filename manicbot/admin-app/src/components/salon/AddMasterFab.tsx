"use client";

/**
 * Bottom-right floating action button for the Masters tab.
 * Mirrors QuickAddFab styling. Opens a 3-option menu:
 *   - Create account (salon-owned credentials)
 *   - Add via Telegram (chat id)
 *   - Send invitation by email
 *
 * The menu lives inside the FAB component to avoid leaking state up to
 * SalonDashboard; the parent only learns which option was picked via onPick().
 */

import { useEffect, useRef, useState } from "react";
import { Plus, UserPlus, Send, MessageCircle } from "lucide-react";
import { useLang } from "~/components/LangContext";

export type AddMasterPick = "create_account" | "add_telegram" | "invite_email";

interface AddMasterFabProps {
  onPick: (kind: AddMasterPick) => void;
}

export function AddMasterFab({ onPick }: AddMasterFabProps) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labels = (() => {
    switch (lang) {
      case "ru":
        return {
          add: "Добавить мастера",
          create: "Создать аккаунт",
          telegram: "Через Telegram",
          email: "Пригласить по email",
        };
      case "ua":
        return {
          add: "Додати майстра",
          create: "Створити акаунт",
          telegram: "Через Telegram",
          email: "Запросити по email",
        };
      case "pl":
        return {
          add: "Dodaj mistrza",
          create: "Utwórz konto",
          telegram: "Przez Telegram",
          email: "Zaproś przez email",
        };
      default:
        return {
          add: "Add master",
          create: "Create account",
          telegram: "Add via Telegram",
          email: "Invite by email",
        };
    }
  })();

  function pick(kind: AddMasterPick) {
    setOpen(false);
    onPick(kind);
  }

  return (
    <div ref={ref} className="fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-40">
      {open && (
        <div className="absolute bottom-full right-0 mb-3 w-60 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => pick("create_account")}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
          >
            <UserPlus className="h-4 w-4 text-violet-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{labels.create}</span>
          </button>
          <button
            type="button"
            onClick={() => pick("add_telegram")}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left border-t border-slate-200 dark:border-slate-700"
          >
            <MessageCircle className="h-4 w-4 text-sky-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{labels.telegram}</span>
          </button>
          <button
            type="button"
            onClick={() => pick("invite_email")}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left border-t border-slate-200 dark:border-slate-700"
          >
            <Send className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{labels.email}</span>
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={labels.add}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-14 sm:h-12 rounded-full text-white font-semibold flex items-center justify-center gap-2 px-4 sm:px-5 shadow-2xl active:scale-95 transition-transform"
        style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
      >
        <Plus className="h-5 w-5" />
        <span className="hidden sm:inline text-sm">{labels.add}</span>
      </button>
    </div>
  );
}
