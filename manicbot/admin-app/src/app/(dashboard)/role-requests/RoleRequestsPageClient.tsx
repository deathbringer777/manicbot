"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  ArrowLeftRight,
  Check,
  X,
  Clock,
  Loader2,
  Mail,
  User,
} from "lucide-react";

type StatusFilter = "pending" | "approved" | "denied" | "all";

const STATUS_TABS: { key: StatusFilter; label: string; color: string }[] = [
  { key: "pending", label: "Ожидают", color: "amber" },
  { key: "approved", label: "Одобрены", color: "emerald" },
  { key: "denied", label: "Отклонены", color: "red" },
  { key: "all", label: "Все", color: "slate" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "pending")
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 uppercase">ожидает</span>;
  if (status === "approved")
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 uppercase">одобрен</span>;
  if (status === "denied")
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 uppercase">отклонён</span>;
  return null;
}

function RoleBadge({ role }: { role: string }) {
  const labels: Record<string, string> = {
    tenant_owner: "Владелец",
    master: "Мастер",
    support: "Поддержка",
    technical_support: "Техподдержка",
    system_admin: "Админ",
  };
  const colors: Record<string, string> = {
    tenant_owner: "bg-cyan-500/20 text-cyan-400",
    master: "bg-violet-500/20 text-violet-400",
    support: "bg-purple-500/20 text-purple-400",
    technical_support: "bg-amber-500/20 text-amber-300",
    system_admin: "bg-amber-500/20 text-amber-400",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${colors[role] ?? "bg-slate-500/20 text-slate-400"}`}>
      {labels[role] ?? role}
    </span>
  );
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RoleRequestsPageClient() {
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "denied">("approved");
  const [adminNote, setAdminNote] = useState("");

  const utils = api.useUtils();
  const { data: requests, isLoading } = (api as any).roleChangeRequests.listRequests.useQuery({ status: filter });
  const { data: pendingCount } = (api as any).roleChangeRequests.pendingCount.useQuery();

  const reviewMut = (api as any).roleChangeRequests.reviewRequest.useMutation({
    onSuccess: () => {
      setReviewingId(null);
      setAdminNote("");
      (utils as any).roleChangeRequests.listRequests.invalidate();
      (utils as any).roleChangeRequests.pendingCount.invalidate();
    },
  }) as { mutate: (args: { requestId: string; decision: string; adminNote?: string }) => void; isPending: boolean };

  const handleReview = () => {
    if (!reviewingId) return;
    reviewMut.mutate({
      requestId: reviewingId,
      decision: reviewDecision,
      ...(adminNote.trim() ? { adminNote: adminNote.trim() } : {}),
    });
  };

  const rows = (requests ?? []) as Array<{
    id: string;
    webUserId: string;
    currentRole: string;
    requestedRole: string;
    reason: string | null;
    status: string;
    adminNote: string | null;
    reviewedAt: number | null;
    createdAt: number;
    userName: string | null;
    userEmail: string | null;
  }>;

  return (
    <Shell
      title="Запросы на смену роли"
      subtitle={pendingCount ? `${pendingCount} ожидают` : undefined}
    >
      <div className="space-y-4">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                filter === tab.key
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {tab.label}
              {tab.key === "pending" && pendingCount ? (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                  {pendingCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && rows.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">
            Нет запросов
          </div>
        )}

        {/* Request cards */}
        {rows.map((req) => (
          <div
            key={req.id}
            className="glass-card rounded-2xl p-4 space-y-3"
          >
            {/* User info */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center text-sm font-bold text-white">
                  {(req.userName ?? req.userEmail ?? "?")[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    {req.userName ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {req.userEmail ?? "—"}
                  </div>
                </div>
              </div>
              <StatusBadge status={req.status} />
            </div>

            {/* Role transition */}
            <div className="flex items-center gap-2 text-sm">
              <RoleBadge role={req.currentRole} />
              <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
              <RoleBadge role={req.requestedRole} />
            </div>

            {/* Reason */}
            {req.reason && (
              <div className="bg-slate-50 dark:bg-slate-900/70 rounded-xl p-3 border border-slate-200 dark:border-slate-700/50">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Причина</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{req.reason}</p>
              </div>
            )}

            {/* Admin note (for reviewed requests) */}
            {req.adminNote && req.status !== "pending" && (
              <div className="bg-slate-50 dark:bg-slate-900/70 rounded-xl p-3 border-l-3 border-violet-500">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Комментарий администратора</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{req.adminNote}</p>
              </div>
            )}

            {/* Timestamp */}
            <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Clock className="w-3 h-3" />
              {formatDate(req.createdAt)}
              {req.reviewedAt && (
                <span className="ml-2">
                  · Рассмотрен: {formatDate(req.reviewedAt)}
                </span>
              )}
            </div>

            {/* Action buttons for pending */}
            {req.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setReviewingId(req.id); setReviewDecision("approved"); setAdminNote(""); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 active:bg-emerald-500 text-white px-3 py-2 text-xs font-semibold rounded-xl transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                  Одобрить
                </button>
                <button
                  onClick={() => { setReviewingId(req.id); setReviewDecision("denied"); setAdminNote(""); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 active:bg-red-500 text-white px-3 py-2 text-xs font-semibold rounded-xl transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                  Отклонить
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Review modal (bottom sheet style) */}
        {reviewingId && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-t-2xl p-6 space-y-4 animate-in slide-in-from-bottom">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {reviewDecision === "approved" ? "Одобрить запрос" : "Отклонить запрос"}
                </h3>
                <button
                  onClick={() => setReviewingId(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {reviewDecision === "approved" && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <p className="text-xs text-amber-400 font-medium">
                    Роль пользователя будет изменена немедленно. Все данные (записи, услуги) сохранятся.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  Комментарий (необязательно)
                </label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Добавить комментарий..."
                  maxLength={500}
                  rows={3}
                  className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/60 text-slate-900 dark:text-white resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setReviewingId(null)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600/60 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:border-slate-300 dark:hover:border-slate-500 transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={handleReview}
                  disabled={reviewMut.isPending}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-70 ${
                    reviewDecision === "approved"
                      ? "bg-emerald-600 active:bg-emerald-500 shadow-lg shadow-emerald-500/20"
                      : "bg-red-600 active:bg-red-500 shadow-lg shadow-red-500/20"
                  }`}
                >
                  {reviewMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : reviewDecision === "approved" ? (
                    <>
                      <Check className="w-4 h-4" />
                      Подтвердить
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      Отклонить
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
