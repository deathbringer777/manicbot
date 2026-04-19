"use client";

import { useState } from "react";
import { UserPlus, Trash2, ShieldCheck, KeyRound, Loader2, X, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { api } from "~/trpc/react";
import {
  TENANT_PERMISSION_KEYS,
  TENANT_MANAGER_DEFAULT,
  SENSITIVE_PERMISSIONS,
  type PermissionKey,
} from "~/server/api/permissions";

interface Props {
  tenantId: string;
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "appointments.view": "Просмотр записей",
  "appointments.manage": "Управление записями",
  "chat.inbox": "Чат с клиентами",
  "clients.view": "Просмотр клиентов",
  "services.view": "Просмотр услуг",
  "masters.view": "Просмотр мастеров",
  "reviews.view": "Просмотр отзывов",
  "services.manage": "Редактирование услуг",
  "masters.manage": "Управление мастерами",
  "branding.manage": "Бренд и профиль",
  "billing.manage": "Оплата и подписка",
  "settings.manage": "Настройки салона",
  "staff.manage": "Управление персоналом",
};

const ACTION_LABELS: Record<string, string> = {
  "master.create": "Добавить мастера",
  "service.add": "Добавить услугу",
  "service.edit": "Изменить услугу",
  "other": "Другое",
};

export function StaffTab({ tenantId }: Props) {
  const utils = api.useUtils();
  const members = api.tenantStaff.listMembers.useQuery({ tenantId });
  const requests = api.tenantStaff.listActionRequests.useQuery({ tenantId, status: "pending" });

  const [showInvite, setShowInvite] = useState(false);
  const [pendingElevation, setPendingElevation] = useState<{
    elevationId: string;
    targetEmail: string;
    permissions: PermissionKey[];
  } | null>(null);

  return (
    <div className="space-y-5">
      {/* Pending action requests */}
      {(requests.data?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <header className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-amber-200">
              Запросы от персонала ({requests.data!.length})
            </h3>
          </header>
          <div className="space-y-2">
            {requests.data!.map((r) => (
              <ActionRequestRow key={r.id} req={r} onAction={() => { requests.refetch(); }} />
            ))}
          </div>
        </section>
      )}

      {/* Staff list */}
      <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200">Администраторы салона</h3>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand-500/20 border border-brand-500/30 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/30"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Пригласить
          </button>
        </header>

        {members.isLoading ? (
          <div className="h-20 animate-pulse rounded-xl bg-slate-800/50" />
        ) : !members.data?.length ? (
          <p className="py-6 text-center text-xs text-slate-500">
            Администраторов пока нет. Пригласите сотрудника — по умолчанию у него ограниченный доступ
            (записи + чат). Сильные права выдаются с подтверждением по email.
          </p>
        ) : (
          <div className="space-y-3">
            {members.data.map((m) => (
              <MemberRow
                key={m.id}
                tenantId={tenantId}
                member={m}
                onElevationRequired={(info) => setPendingElevation(info)}
              />
            ))}
          </div>
        )}
      </section>

      {showInvite && (
        <InviteMemberModal
          tenantId={tenantId}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            utils.tenantStaff.listMembers.invalidate();
            setShowInvite(false);
          }}
        />
      )}

      {pendingElevation && (
        <ElevationDialog
          elevationId={pendingElevation.elevationId}
          targetEmail={pendingElevation.targetEmail}
          permissions={pendingElevation.permissions}
          onClose={() => setPendingElevation(null)}
          onConfirmed={() => {
            utils.tenantStaff.listMembers.invalidate();
            setPendingElevation(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Member row with inline permission toggles ────────────────────────────

function MemberRow({
  tenantId,
  member,
  onElevationRequired,
}: {
  tenantId: string;
  member: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: number | null;
    permissions: PermissionKey[];
  };
  onElevationRequired: (info: { elevationId: string; targetEmail: string; permissions: PermissionKey[] }) => void;
}) {
  const utils = api.useUtils();
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set(member.permissions));
  const [error, setError] = useState<string | null>(null);

  const update = api.tenantStaff.updatePermissions.useMutation({
    onSuccess: (res) => {
      if (res.elevationRequired) {
        onElevationRequired({
          elevationId: res.elevationId,
          targetEmail: member.email,
          permissions: res.pendingPermissions as PermissionKey[],
        });
      } else {
        utils.tenantStaff.listMembers.invalidate();
      }
    },
    onError: (e) => setError(e.message),
  });
  const revoke = api.tenantStaff.revokeMember.useMutation({
    onSuccess: () => utils.tenantStaff.listMembers.invalidate(),
  });

  function toggle(p: PermissionKey) {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelected(next);
  }

  const unchanged =
    selected.size === member.permissions.length &&
    member.permissions.every((p) => selected.has(p));

  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-white">{member.name ?? member.email}</p>
            {member.emailVerified ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">
                <CheckCircle className="h-3 w-3" /> verified
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
                <AlertCircle className="h-3 w-3" /> pending
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-500">{member.email}</p>
        </div>
        <button
          onClick={() => {
            if (confirm(`Отозвать доступ у ${member.email}?`)) revoke.mutate({ tenantId, webUserId: member.id });
          }}
          className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
          title="Отозвать"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {TENANT_PERMISSION_KEYS.map((p) => {
          const isSensitive = SENSITIVE_PERMISSIONS.includes(p);
          const isDefault = TENANT_MANAGER_DEFAULT.includes(p);
          const checked = selected.has(p);
          return (
            <label
              key={p}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer ${
                checked
                  ? isSensitive
                    ? "bg-amber-500/10 text-amber-200"
                    : "bg-brand-500/10 text-brand-200"
                  : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(p)}
                className="accent-brand-500"
              />
              <span className="flex-1 truncate">{PERMISSION_LABELS[p]}</span>
              {isSensitive && <KeyRound className="h-3 w-3 shrink-0 text-amber-400" />}
              {isDefault && !isSensitive && (
                <span className="text-[9px] text-slate-600">default</span>
              )}
            </label>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          disabled={unchanged || update.isPending}
          onClick={() => {
            setError(null);
            update.mutate({ tenantId, webUserId: member.id, permissions: Array.from(selected) });
          }}
          className="flex items-center gap-1.5 rounded-xl border border-brand-500/30 bg-brand-500/20 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/30 disabled:opacity-40"
        >
          {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Сохранить
        </button>
      </div>
    </div>
  );
}

// ─── Invite modal ───────────────────────────────────────────────────────────

function InviteMemberModal({
  tenantId,
  onClose,
  onInvited,
}: {
  tenantId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = api.tenantStaff.inviteMember.useMutation({
    onSuccess: (res) => setTempPassword(res.tempPassword),
    onError: (e) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Пригласить администратора</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        {!tempPassword ? (
          <>
            <p className="mb-4 text-xs text-slate-400">
              Администратору придёт письмо с кодом подтверждения. По умолчанию — ограниченные
              права (записи + чат). Сильные права можно выдать позже с подтверждением по email.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="staff@example.com"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Имя (опц.)</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="Имя сотрудника"
                />
              </label>
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Отмена
              </button>
              <button
                disabled={!email || invite.isPending}
                onClick={() => {
                  setError(null);
                  invite.mutate({
                    tenantId,
                    email,
                    name: name || null,
                    lang: "ru",
                  });
                }}
                className="flex items-center gap-1.5 rounded-xl border border-brand-500/30 bg-brand-500/20 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/30 disabled:opacity-40"
              >
                {invite.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Пригласить
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-xs font-medium text-emerald-300">Приглашение отправлено</p>
              <p className="mt-1 text-xs text-emerald-200/80">
                На {email} отправлено письмо с 6-значным кодом. Временный пароль ниже — передайте его сотруднику
                любым безопасным способом (не по email).
              </p>
            </div>
            <div className="rounded-xl bg-slate-800 p-3 font-mono text-sm text-white">
              {tempPassword}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={onInvited}
                className="rounded-xl border border-brand-500/30 bg-brand-500/20 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/30"
              >
                Готово
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Elevation dialog (owner enters 6-digit code) ───────────────────────────

function ElevationDialog({
  elevationId,
  targetEmail,
  permissions,
  onClose,
  onConfirmed,
}: {
  elevationId: string;
  targetEmail: string;
  permissions: PermissionKey[];
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirm = api.tenantStaff.confirmElevation.useMutation({
    onSuccess: () => onConfirmed(),
    onError: (e) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-5">
        <header className="mb-3 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-amber-400" />
          <h3 className="text-base font-bold text-white">Подтвердите расширение прав</h3>
        </header>
        <p className="mb-3 text-xs text-slate-400">
          Вы предоставляете <b className="text-amber-300">чувствительные права</b> пользователю{" "}
          <b className="text-white">{targetEmail}</b>:
        </p>
        <ul className="mb-4 rounded-xl bg-slate-800 p-3 text-xs text-slate-300">
          {permissions.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <KeyRound className="h-3 w-3 text-amber-400 shrink-0" />
              {PERMISSION_LABELS[p]}
            </li>
          ))}
        </ul>
        <p className="mb-3 text-xs text-slate-400">
          На вашу почту отправлен 6-значный код. Введите его ниже, чтобы подтвердить.
        </p>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-3 text-center font-mono text-2xl tracking-widest text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
          placeholder="• • • • • •"
          autoFocus
        />
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
          >
            Отмена
          </button>
          <button
            disabled={code.length !== 6 || confirm.isPending}
            onClick={() => {
              setError(null);
              confirm.mutate({ elevationId, code });
            }}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-40"
          >
            {confirm.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Action request row ────────────────────────────────────────────────────

function ActionRequestRow({
  req,
  onAction,
}: {
  req: {
    id: string;
    action: string;
    payload: string | null;
    requesterId: string;
    createdAt: number;
  };
  onAction: () => void;
}) {
  const review = api.tenantStaff.reviewActionRequest.useMutation({
    onSuccess: () => onAction(),
  });
  let payload: Record<string, unknown> | null = null;
  try { payload = req.payload ? JSON.parse(req.payload) : null; } catch { /* ignore */ }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-900/40 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-white">{ACTION_LABELS[req.action] ?? req.action}</p>
        {payload && (
          <p className="truncate text-[10px] text-slate-500">
            {JSON.stringify(payload)}
          </p>
        )}
        <p className="text-[10px] text-slate-600">
          {new Date(req.createdAt * 1000).toLocaleString("ru-RU")}
        </p>
      </div>
      <button
        disabled={review.isPending}
        onClick={() => review.mutate({ requestId: req.id, decision: "approved" })}
        className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
      >
        Одобрить
      </button>
      <button
        disabled={review.isPending}
        onClick={() => review.mutate({ requestId: req.id, decision: "denied" })}
        className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/20 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-40"
      >
        Отклонить
      </button>
    </div>
  );
}
