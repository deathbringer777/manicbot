"use client";

import { useState } from "react";
import { X, User as DmIcon, Users as GroupIcon, Check } from "lucide-react";
import { api } from "~/trpc/react";

type Mode = "pick" | "dm" | "group";

interface Props {
  tenantId: string;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}

export function NewThreadModal({ tenantId, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("pick");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState("");

  const staffQ = api.messenger.listStaff.useQuery({ tenantId }, { enabled: !!tenantId });
  const utils = api.useUtils();

  const dmMutation = api.messenger.createStaffDm.useMutation({
    onSuccess: async ({ threadId }) => {
      await utils.messenger.listThreads.invalidate({ tenantId });
      onCreated(threadId);
    },
  });

  const groupMutation = api.messenger.createStaffGroup.useMutation({
    onSuccess: async ({ threadId }) => {
      await utils.messenger.listThreads.invalidate({ tenantId });
      onCreated(threadId);
    },
  });

  const isBusy = dmMutation.isPending || groupMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
      onClick={onClose}
      data-testid="new-thread-modal"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {mode === "pick"
              ? "Новый чат"
              : mode === "dm"
                ? "Прямое сообщение"
                : "Групповой чат"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "pick" && (
          <div className="space-y-2 p-4">
            <button
              type="button"
              onClick={() => setMode("dm")}
              data-testid="pick-dm"
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
                <DmIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Прямое сообщение
                </p>
                <p className="text-[11px] text-slate-500">1:1 с другим сотрудником</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("group")}
              data-testid="pick-group"
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/15 text-purple-500">
                <GroupIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Групповой чат
                </p>
                <p className="text-[11px] text-slate-500">Несколько сотрудников + название</p>
              </div>
            </button>
          </div>
        )}

        {mode === "dm" && (
          <div className="p-4">
            <p className="mb-2 text-xs text-slate-500">Выберите сотрудника</p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {staffQ.isLoading ? (
                <div className="space-y-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : !staffQ.data?.length ? (
                <p className="text-center text-xs text-slate-500">Нет других сотрудников</p>
              ) : (
                staffQ.data.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() =>
                      dmMutation.mutate({ tenantId, otherWebUserId: u.id })
                    }
                    disabled={isBusy}
                    data-testid={`dm-target-${u.id}`}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/20 text-[11px] font-bold text-brand-500">
                      {(u.name ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-900 dark:text-slate-100">{u.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{u.role}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
            {dmMutation.error && (
              <p className="mt-2 text-[11px] text-red-500">{dmMutation.error.message}</p>
            )}
            <button
              type="button"
              onClick={() => setMode("pick")}
              className="mt-3 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              ← Назад
            </button>
          </div>
        )}

        {mode === "group" && (
          <div className="p-4">
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Название группы"
              maxLength={120}
              data-testid="group-title-input"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />

            <p className="mb-2 mt-3 text-xs text-slate-500">Участники</p>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {staffQ.data?.length ? (
                staffQ.data.map((u) => {
                  const selected = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((ids) =>
                          ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id],
                        )
                      }
                      data-testid={`group-member-${u.id}`}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                        selected
                          ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-bold text-brand-500">
                        {(u.name ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 truncate text-xs">{u.name}</span>
                      {selected && <Check className="h-3 w-3 text-brand-500" />}
                    </button>
                  );
                })
              ) : (
                <p className="text-center text-[11px] text-slate-500">Нет других сотрудников</p>
              )}
            </div>

            {groupMutation.error && (
              <p className="mt-2 text-[11px] text-red-500">{groupMutation.error.message}</p>
            )}

            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMode("pick")}
                className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                ← Назад
              </button>
              <button
                type="button"
                onClick={() =>
                  groupMutation.mutate({
                    tenantId,
                    title: groupTitle.trim(),
                    memberWebUserIds: selectedIds,
                  })
                }
                disabled={!groupTitle.trim() || selectedIds.length === 0 || isBusy}
                data-testid="group-create-button"
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
              >
                Создать
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
