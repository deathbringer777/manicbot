"use client";

import { useState } from "react";
import { Loader2, Cake, Check, Users } from "lucide-react";
import { EmptyState } from "~/components/ui/EmptyState";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SectionHeader } from "~/components/dashboard-ui";

interface Client {
  chatId: number;
  name: string | null;
  tgUsername: string | null;
  phone: string | null;
  dob: string | null;
}

function ClientRow({ tenantId, c }: { tenantId: string; c: Client }) {
  const [editingDob, setEditingDob] = useState(false);
  const [dob, setDob] = useState<string>(c.dob ?? "");
  const utils = api.useUtils();
  const save = api.salon.setClientDob.useMutation({
    onSuccess: () => {
      utils.salon.getClients.invalidate({ tenantId });
      setEditingDob(false);
    },
  });

  const hasDob = !!c.dob;

  return (
    <div className="glass-card rounded-xl p-3">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-400 shrink-0">
          {(c.name ?? "?").charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-900 dark:text-white text-sm">
            {c.name ?? `#${c.chatId}`}
          </p>
          <p className="text-[10px] text-slate-500">
            {c.tgUsername ? `@${c.tgUsername}` : ""} {c.phone ?? ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditingDob((v) => !v)}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition ${
            hasDob
              ? "border-pink-500/30 bg-pink-500/10 text-pink-300 hover:bg-pink-500/20"
              : "border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08]"
          }`}
          aria-label="Edit birthday"
        >
          <Cake className="h-3.5 w-3.5" />
          {hasDob ? new Date(c.dob!).toLocaleDateString("ru", { day: "2-digit", month: "short" }) : "ДР"}
        </button>
      </div>

      {editingDob && (
        <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={() => save.mutate({ tenantId, chatId: c.chatId, dob: dob || null })}
            disabled={save.isPending}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          {hasDob && (
            <button
              type="button"
              onClick={() => {
                setDob("");
                save.mutate({ tenantId, chatId: c.chatId, dob: null });
              }}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/60 hover:bg-rose-500/10 hover:text-rose-300"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ClientsTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const clients = api.salon.getClients.useQuery({ tenantId });

  return (
    <div className="space-y-3">
      <SectionHeader title={t("salon.clients", lang)} />
      {clients.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {clients.isError && (
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p>
        </div>
      )}
      <div className="space-y-2">
        {(clients.data ?? []).map((c: Client) => (
          <ClientRow key={c.chatId} tenantId={tenantId} c={c} />
        ))}
        {clients.data?.length === 0 && (
          <EmptyState
            icon={Users}
            title={t("salon.noClients", lang)}
            description={lang === "ru" ? "Клиенты появятся после первой записи" : lang === "ua" ? "Клієнти з'являться після першого запису" : "Clients will appear after the first booking"}
          />
        )}
      </div>
    </div>
  );
}
