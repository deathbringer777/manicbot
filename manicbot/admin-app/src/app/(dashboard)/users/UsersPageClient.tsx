"use client";

import { useState, useCallback } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  Search,
  ShieldAlert,
  UserX,
  UserCheck,
  Shield,
  ShieldOff,
  ChevronLeft,
  ChevronRight,
  X,
  Building2,
} from "lucide-react";

type Filter = "all" | "admins" | "banned";
type AssignablePlatformRole = "support" | "technical_support";

type UserItem = {
  id: number;
  name: string;
  username: string | null;
  phone: string | null;
  lang: string | null;
  role: string;
  isBanned: boolean;
  tenants: string[];
  joinedAt: string;
  registeredAt: number;
};

function RoleBadge({ role }: { role: string }) {
  if (role === "system_admin")
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 uppercase">
        админ
      </span>
    );
  if (role === "technical_support")
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 uppercase">
        техподдержка
      </span>
    );
  if (role === "support")
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-400 uppercase">
        support
      </span>
    );
  return null;
}

function TenantBadge({ id }: { id: string }) {
  // Shorten long tenant IDs for display
  const label = id.length > 12 ? id.slice(0, 10) + "…" : id;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400 text-[9px] font-mono">
      <Building2 className="w-2.5 h-2.5 shrink-0" />
      {label}
    </span>
  );
}

function UserCard({
  user,
  onBan,
  onUnban,
  onRole,
  isPending,
}: {
  user: UserItem;
  onBan: () => void;
  onUnban: () => void;
  onRole: () => void;
  isPending: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Top: avatar + info + status */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-white shrink-0 border border-white/5">
          {user.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{user.name}</p>
            <RoleBadge role={user.role} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {user.username && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{user.username}</span>
            )}
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">#{user.id}</span>
            {user.phone && (
              <span className="text-[10px] text-slate-500">{user.phone}</span>
            )}
          </div>
        </div>

        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ${
            user.isBanned
              ? "bg-red-500/15 text-red-400"
              : "bg-emerald-500/15 text-emerald-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${user.isBanned ? "bg-red-400" : "bg-emerald-400"}`}
          />
          {user.isBanned ? "Banned" : "Active"}
        </span>
      </div>

      {/* Tenant badges */}
      {user.tenants.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {user.tenants.map((t) => (
            <TenantBadge key={t} id={t} />
          ))}
          {user.tenants.length > 1 && (
            <span className="text-[9px] text-slate-500 dark:text-slate-600 self-center ml-1">
              {user.tenants.length} salon{user.tenants.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Bottom: date + action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
        <span className="text-[10px] text-slate-500 dark:text-slate-600 flex-1">{user.joinedAt}</span>

        <button
          onClick={onRole}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Роль
        </button>

        {user.isBanned ? (
          <button
            onClick={onUnban}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 active:bg-emerald-500/25 rounded-xl text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <UserCheck className="w-3.5 h-3.5" />
            Разбан
          </button>
        ) : (
          <button
            onClick={onBan}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 active:bg-red-500/25 rounded-xl text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <UserX className="w-3.5 h-3.5" />
            Бан
          </button>
        )}
      </div>
    </div>
  );
}

export default function UsersPageClient() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [roleModal, setRoleModal] = useState<UserItem | null>(null);
  const LIMIT = 50;

  const utils = api.useUtils();

  const { data, isLoading } = api.users.getAll.useQuery({
    offset,
    limit: LIMIT,
    search,
    filter,
  });

  const banMut = api.users.banUser.useMutation({
    onSuccess: () => utils.users.getAll.invalidate(),
  });
  const unbanMut = api.users.unbanUser.useMutation({
    onSuccess: () => utils.users.getAll.invalidate(),
  });
  const setRoleMut = api.users.setRole.useMutation({
    onSuccess: () => {
      void utils.users.getAll.invalidate();
      setRoleModal(null);
    },
  });
  const removeRoleMut = api.users.removeRole.useMutation({
    onSuccess: () => {
      void utils.users.getAll.invalidate();
      setRoleModal(null);
    },
  });

  const usersList = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const isPending =
    banMut.isPending ||
    unbanMut.isPending ||
    setRoleMut.isPending ||
    removeRoleMut.isPending;

  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    setOffset(0);
  }, []);

  const handleFilter = (f: Filter) => {
    setFilter(f);
    setOffset(0);
  };

  return (
    <Shell>
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-extrabold tracking-tight">Users</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {total} уникальных пользователей · отсортировано по имени
          </p>
        </header>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Имя, @username, ID или телефон..."
            className="w-full bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/60 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {(
            [
              { key: "all", label: "Все" },
              { key: "admins", label: "Admins" },
              { key: "banned", label: "Banned" },
            ] as { key: Filter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleFilter(key)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                filter === key
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-transparent active:bg-slate-200 dark:active:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Hint about grouping */}
        <div className="flex items-start gap-2 bg-slate-100 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-700/30">
          <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Пользователи сгруппированы по Telegram ID. Значки{" "}
            <span className="font-mono bg-slate-200 dark:bg-slate-700/60 px-1 rounded text-[9px]">salon</span>{" "}
            показывают в каких салонах зарегистрирован пользователь.
          </p>
        </div>

        {/* Users list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 h-28 animate-pulse" />
            ))}
          </div>
        ) : usersList.length === 0 ? (
          <div className="glass-card rounded-2xl py-16 text-center">
            <p className="text-slate-500 text-sm">Пользователи не найдены</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {usersList.map((user) => (
              <UserCard
                key={user.id}
                user={user}
                isPending={isPending}
                onBan={() => banMut.mutate({ chatId: user.id })}
                onUnban={() => unbanMut.mutate({ chatId: user.id })}
                onRole={() => setRoleModal(user)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Стр. {currentPage}/{totalPages} · {total} пользователей
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm disabled:opacity-30 active:bg-slate-200 dark:active:bg-slate-700"
              >
                <ChevronLeft className="w-4 h-4" />
                Назад
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm disabled:opacity-30 active:bg-slate-200 dark:active:bg-slate-700"
              >
                Вперёд
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Role Modal — bottom sheet */}
      {roleModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setRoleModal(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700/60 rounded-t-3xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mb-5" />

            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-white">Управление ролью</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {roleModal.name}
                  {roleModal.username && (
                    <span className="ml-1">{roleModal.username}</span>
                  )}
                  {" · "}
                  <span className="font-mono">#{roleModal.id}</span>
                </p>
                {roleModal.tenants.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {roleModal.tenants.map((t) => (
                      <TenantBadge key={t} id={t} />
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setRoleModal(null)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mb-2">
              Роль админа платформы только у владельца (ADMIN_CHAT_ID). Здесь — только поддержка.
            </p>
            <div className="space-y-2">
              {(
                [
                  { key: "support" as const, label: "Поддержка (support)" },
                  { key: "technical_support" as const, label: "Техподдержка" },
                ] as { key: AssignablePlatformRole; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setRoleMut.mutate({ chatId: roleModal.id, role: key })}
                  disabled={setRoleMut.isPending}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-slate-800 active:bg-slate-700 text-sm text-white disabled:opacity-50"
                >
                  <Shield className="w-4 h-4 text-brand-400 shrink-0" />
                  <span>
                    Назначить{" "}
                    <span className="font-bold text-brand-400">{label}</span>
                  </span>
                  {roleModal.role === key && (
                    <span className="ml-auto text-[10px] text-brand-400 font-bold">ТЕКУЩАЯ</span>
                  )}
                </button>
              ))}

              {roleModal.role !== "user" && roleModal.role !== "system_admin" && (
                <button
                  onClick={() => removeRoleMut.mutate({ chatId: roleModal.id })}
                  disabled={removeRoleMut.isPending}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-red-500/10 active:bg-red-500/20 text-sm text-red-400 disabled:opacity-50"
                >
                  <ShieldOff className="w-4 h-4 shrink-0" />
                  Снять роль
                </button>
              )}
            </div>

            <button
              onClick={() => setRoleModal(null)}
              className="mt-3 w-full py-3 text-sm text-slate-500"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
