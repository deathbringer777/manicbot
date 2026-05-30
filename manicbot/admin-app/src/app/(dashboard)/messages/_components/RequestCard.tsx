"use client";

import { useState } from "react";
import { api } from "~/trpc/react";

/** Snapshot persisted in thread_messages.meta_json by the Worker. */
interface RequestMeta {
  appointmentId?: string;
  status?: string;
  autoConfirmed?: boolean;
  channel?: string | null;
  svcName?: string | null;
  when?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  masterId?: number | null;
  masterName?: string | null;
}

interface LiveAppointment {
  status: string;
  masterId: number | null;
  cancelled: number;
}

interface RequestCardProps {
  tenantId: string;
  message: {
    id: string;
    refId: string | null;
    metaJson: string | null;
    createdAt: number;
    liveAppointment?: LiveAppointment | null;
  };
}

function parseMeta(raw: string | null): RequestMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RequestMeta;
  } catch {
    return {};
  }
}

const CHANNEL_BADGE: Record<string, string> = {
  web: "🌐",
  telegram: "✈️",
  whatsapp: "🟢",
  instagram: "📸",
};

export function RequestCard({ tenantId, message }: RequestCardProps) {
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);

  const meta = parseMeta(message.metaJson);
  // Live status (post-claim reality) wins over the snapshot taken at post time.
  const live = message.liveAppointment ?? null;
  const status = live?.status ?? meta.status ?? "pending";
  const cancelled = (live?.cancelled ?? 0) === 1;
  const isPending = status === "pending" && !cancelled;
  const isConfirmed = status === "confirmed" && !cancelled;
  const isTerminal = cancelled || status === "rejected" || status === "no_show";

  const claim = api.appointments.claimAndConfirm.useMutation({
    onSuccess: (res) => {
      if (!res.ok) setError("Уже взято другим мастером");
      void utils.messenger.getThread.invalidate();
      void utils.messenger.listThreads.invalidate();
    },
    onError: () => setError("Не удалось взять заявку"),
  });

  const channelIcon = meta.channel ? CHANNEL_BADGE[meta.channel] ?? "" : "";
  const header = isConfirmed ? "Запись подтверждена" : "Заявка на запись";

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {isConfirmed ? "✅" : "📋"} {header}
        </span>
        {channelIcon && (
          <span className="text-xs" title={meta.channel ?? ""}>
            {channelIcon}
          </span>
        )}
      </div>

      <dl className="space-y-0.5 text-sm text-gray-800 dark:text-slate-200">
        {meta.clientName && <div>👤 {meta.clientName}</div>}
        {meta.clientPhone && <div>📱 {meta.clientPhone}</div>}
        {meta.svcName && <div>💅 {meta.svcName}</div>}
        {meta.when && <div>📅 {meta.when}</div>}
        {meta.masterName && <div>💇 {meta.masterName}</div>}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isPending && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (message.refId) claim.mutate({ tenantId, id: message.refId });
            }}
            disabled={claim.isPending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            Взять и подтвердить
          </button>
        )}
        {isConfirmed && (
          <span className="rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            ✅ Подтверждено{meta.autoConfirmed ? " · авто" : ""}
          </span>
        )}
        {isTerminal && (
          <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-500 dark:bg-slate-800 dark:text-slate-400">
            Отменено
          </span>
        )}
        {message.refId && (
          <a
            href={`/?tab=appointments&apt=${encodeURIComponent(message.refId)}`}
            className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
          >
            Открыть в записях
          </a>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
