"use client";

import { useState } from "react";
import Link from "next/link";
import { HelpCircle, Map, MessageSquarePlus, CheckCircle2 } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { TOUR_REPLAY_EVENT } from "~/lib/onboarding/constants";
import { api } from "~/trpc/react";

export function HelpSection() {
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const showTourReplay =
    effectiveRole === "tenant_owner" ||
    effectiveRole === "master" ||
    effectiveRole === "support" ||
    effectiveRole === "technical_support";
  const showSupportForm =
    effectiveRole === "tenant_owner" ||
    effectiveRole === "master";

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const createTicket = api.support.createTicket.useMutation({
    onSuccess(data) {
      setCreatedId(data.ticketId);
      setSubject("");
      setMessage("");
    },
  });

  return (
    <div className="space-y-4">
      <section className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-cyan-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.helpCenter", lang)}</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("settings.helpCenterDesc", lang)}</p>
        <Link
          href="/help"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          {t("settings.helpCenter", lang)}
        </Link>
        {showTourReplay && (
          <>
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <Map className="w-4 h-4 text-violet-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.tourReplay", lang)}</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("settings.tourReplayDesc", lang)}</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT))}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-200 hover:bg-violet-500/20 transition-colors"
            >
              {t("settings.tourReplay", lang)}
            </button>
          </>
        )}
      </section>

      {showSupportForm && (
        <section className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.writeSupport", lang)}</h2>
          </div>

          {createdId ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-200">
                {t("settings.supportSuccess", lang)} &mdash; {createdId}
              </span>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!subject.trim() || !message.trim()) return;
                createTicket.mutate({ subject: subject.trim(), message: message.trim() });
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  {t("settings.supportSubject", lang)}
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-brand-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  {t("settings.supportMessage", lang)}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-brand-500/50 transition-colors resize-y"
                />
              </div>
              {createTicket.error && (
                <p className="text-xs text-red-400">{createTicket.error.message}</p>
              )}
              <button
                type="submit"
                disabled={createTicket.isPending || !subject.trim() || !message.trim()}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {createTicket.isPending ? t("settings.saving", lang) : t("settings.supportSend", lang)}
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
