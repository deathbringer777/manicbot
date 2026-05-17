"use client";

import { useState, useCallback } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { EmptyState } from "~/components/ui/EmptyState";
import { PageHeader } from "~/components/ui/PageHeader";
import { SkeletonCard } from "~/components/ui/Skeleton";
import {
  Search,
  ShieldAlert,
  UserX,
  UserCheck,
  Users,
  Shield,
  ShieldOff,
  ChevronLeft,
  ChevronRight,
  X,
  Building2,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, pluralCount } from "~/lib/i18n";

type Filter = "all" | "banned";
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
  const { lang } = useLang();
  if (role === "system_admin")
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400 uppercase">
        {t("gmUsers.roleAdminBadge", lang)}
      </span>
    );
  if (role === "technical_support")
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 uppercase">
        {t("gmUsers.roleTechSupportBadge", lang)}
      </span>
    );
  if (role === "support")
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 uppercase">
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
  const { lang } = useLang();
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
          {t("gmUsers.roleColumn", lang)}
        </button>

        {user.isBanned ? (
          <button
            onClick={onUnban}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 active:bg-emerald-500/25 rounded-xl text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <UserCheck className="w-3.5 h-3.5" />
            {t("gmUsers.unban", lang)}
          </button>
        ) : (
          <button
            onClick={onBan}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 active:bg-red-500/25 rounded-xl text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <UserX className="w-3.5 h-3.5" />
            {t("gmUsers.ban", lang)}
          </button>
        )}
      </div>
    </div>
  );
}

export default function UsersPageClient() {
  const { lang } = useLang();
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
        <PageHeader
          title={t("gmUsers.title", lang)}
          subtitle={isLoading ? t("gmTenants.loading", lang) : pluralCount(total, "count.users", lang)}
        />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("gmUsers.searchUsersPh", lang)}
            className="w-full bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/60 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {(
            [
              { key: "all", label: t("gmUsers.filterAll", lang) },
              { key: "banned", label: t("gmUsers.filterBanned", lang) },
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
            {t("gmUsers.groupedHint", lang)}{" "}
            <span className="font-mono bg-slate-200 dark:bg-slate-700/60 px-1 rounded text-[9px]">salon</span>{" "}
            {t("gmUsers.groupedHintTail", lang)}
          </p>
        </div>

        {/* Users list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
          </div>
        ) : usersList.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? "No users found" : "No users yet"}
            description={search ? `No results for "${search}". Try a different search term.` : "Users will appear here once they start interacting with a bot."}
          />
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
              {t("gmUsers.pageOf", lang)} {currentPage}/{totalPages} · {total} {t("gmUsers.usersWordCountSuffix", lang)}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm disabled:opacity-30 active:bg-slate-200 dark:active:bg-slate-700"
              >
                <ChevronLeft className="w-4 h-4" />
                {t("gmUsers.prev", lang)}
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm disabled:opacity-30 active:bg-slate-200 dark:active:bg-slate-700"
              >
                {t("gmUsers.next", lang)}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Role Modal — follows the 0062 modal stacking contract (z-[100] +
          bg-slate-950/70 backdrop-blur-md + solid card with ring-1
          ring-black/5). Pinned in modal-styling-regression.test.ts. */}
      {roleModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
          onClick={() => setRoleModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 ring-1 ring-black/5 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmUsers.manageRole", lang)}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-500 mb-2">
              {t("gmUsers.adminInfo", lang)}
            </p>
            <div className="space-y-2">
              {(
                [
                  { key: "support" as const, label: t("gmUsers.roleSupportLabel", lang) },
                  { key: "technical_support" as const, label: t("gmUsers.roleTechSupportLabel", lang) },
                ] as { key: AssignablePlatformRole; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setRoleMut.mutate({ chatId: roleModal.id, role: key })}
                  disabled={setRoleMut.isPending}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-sm text-slate-900 dark:text-white disabled:opacity-50"
                >
                  <Shield className="w-4 h-4 text-brand-400 shrink-0" />
                  <span>
                    {t("gmUsers.assignAs", lang)}{" "}
                    <span className="font-bold text-brand-500 dark:text-brand-400">{label}</span>
                  </span>
                  {roleModal.role === key && (
                    <span className="ml-auto text-[10px] text-brand-500 dark:text-brand-400 font-bold">{t("gmUsers.currentRole", lang)}</span>
                  )}
                </button>
              ))}

              {roleModal.role !== "user" && roleModal.role !== "system_admin" && (
                <button
                  onClick={() => removeRoleMut.mutate({ chatId: roleModal.id })}
                  disabled={removeRoleMut.isPending}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-red-500/10 active:bg-red-500/20 text-sm text-red-600 dark:text-red-400 disabled:opacity-50"
                >
                  <ShieldOff className="w-4 h-4 shrink-0" />
                  {t("gmUsers.removeRole", lang)}
                </button>
              )}
            </div>

            <button
              onClick={() => setRoleModal(null)}
              className="mt-3 w-full py-3 text-sm text-slate-500"
            >
              {t("common.cancel", lang)}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
