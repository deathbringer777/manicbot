"use client";

/**
 * MasterDetailModal — opened when a row in the Masters tab is clicked.
 *
 * Parity with the Clients tab: clicking a master row opens this modal where
 * the salon owner can view + edit the master's profile, toggle public
 * visibility, or delete the account.
 *
 * Two states:
 *   - VIEW: read-only card + quick-action bar (Настройки / Скрыть / Удалить).
 *   - SETTINGS: tabbed editor with two sub-tabs:
 *       • "Редактирование" — profile data (name, telegram, bio, photo)
 *       • "Настройки"      — operational settings (vacation range, password
 *                            vault, deactivation hooks). Vacation lives here
 *                            because it's an account state, not a profile
 *                            attribute. Password peek/reset is OTP-gated.
 *
 * Editing is gated by `masters.origin` (migration 0063):
 *   - salon_created    → always editable (the salon owns the account)
 *   - invited_email    → editable only if allowDelegation = 1
 *   - invited_telegram → editable only if allowDelegation = 1
 *   - self_registered  → never editable (the master owns their own profile)
 *
 * For non-editable origins, the bottom Settings button is hidden and a hint
 * explains why; the Telegram pairing section still renders so the owner can
 * still bind a Telegram identity.
 */

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Settings,
  Trash2,
  Eye,
  EyeOff,
  Send,
  Mail,
  Calendar,
  Save,
  Loader2,
  ArrowLeft,
  User,
  MessageSquare,
} from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang, type TranslationKey } from "~/lib/i18n";
import { parseMasterHours, parseMasterWorkDays } from "~/lib/workHours";
import { resolveMasterAvatarEmoji } from "~/lib/masterAvatar";
import { DatePicker } from "~/components/ui/DatePicker";
import { MasterAvatarPicker } from "./MasterAvatarPicker";
import { MasterTelegramInlineSection } from "./MasterTelegramInlineSection";
import { MasterPasswordVaultSection } from "./MasterPasswordVaultSection";
import { MasterScheduleEditor } from "~/components/salon/MasterScheduleEditor";
import { ThreadView } from "~/app/(dashboard)/messages/_components/ThreadView";

type MasterDetail = RouterOutputs["salon"]["getMasterDetail"];
type TabKey = "profile" | "schedule" | "settings";
type PanelKey = "profile" | "messages";

interface Props {
  tenantId: string;
  chatId: number;
  onClose: () => void;
  /**
   * Optional handler triggered when the embedded Telegram-pairing section
   * surfaces a "bot not connected" CTA and the owner clicks it. The parent
   * is expected to dismiss this modal AND switch the dashboard to the
   * Channels tab (Telegram sub-tab is the default landing).
   */
  onNavigateToChannels?: () => void;
}

function unixToDateInput(unix: number | null | undefined): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToUnix(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

// getUTCDay() index → short weekday label, for rendering a proposed schedule.
const DOW_LABEL: Record<number, TranslationKey> = {
  0: "weekday.short.sun", 1: "weekday.short.mon", 2: "weekday.short.tue",
  3: "weekday.short.wed", 4: "weekday.short.thu", 5: "weekday.short.fri", 6: "weekday.short.sat",
};

function formatScheduleProposal(payload: unknown, lang: Lang): string {
  const p = (payload ?? {}) as { workHours?: unknown; workDays?: unknown };
  const hours = typeof p.workHours === "string" ? parseMasterHours(p.workHours) : null;
  const days = typeof p.workDays === "string" ? parseMasterWorkDays(p.workDays) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hoursStr = hours ? `${pad(hours.from)}:00–${pad(hours.to)}:00` : "—";
  const daysStr = days && days.length
    ? days.map((d) => t(DOW_LABEL[d] ?? "weekday.short.mon", lang)).join(", ")
    : "—";
  return `${hoursStr} · ${daysStr}`;
}

/** Owner-facing pending master schedule proposal with Approve / Reject. */
function SchedulePendingPanel({
  payload,
  lang,
  onReview,
  reviewing,
}: {
  payload: unknown;
  lang: Lang;
  onReview: (decision: "approved" | "denied") => void;
  reviewing: boolean;
}) {
  return (
    <div
      className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
      data-testid="master-detail-schedule-pending"
    >
      <p className="mb-1 font-semibold text-amber-700 dark:text-amber-300">
        {t("master.schedule.proposedByMaster", lang)}
      </p>
      <p className="mb-3 text-sm text-slate-800 dark:text-slate-100">
        {formatScheduleProposal(payload, lang)}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onReview("approved")}
          disabled={reviewing}
          data-testid="master-detail-schedule-approve"
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {t("master.schedule.approve", lang)}
        </button>
        <button
          type="button"
          onClick={() => onReview("denied")}
          disabled={reviewing}
          data-testid="master-detail-schedule-reject"
          className="flex-1 rounded-lg border border-rose-500/40 px-3 py-2 font-semibold text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
        >
          {t("master.schedule.reject", lang)}
        </button>
      </div>
    </div>
  );
}

export function MasterDetailModal({ tenantId, chatId, onClose, onNavigateToChannels }: Props) {
  const { lang } = useLang();
  const utils = api.useUtils();

  const detail = api.salon.getMasterDetail.useQuery(
    { tenantId, masterChatId: chatId },
    { refetchOnWindowFocus: false },
  );

  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  // Top-level panel switch — "profile" keeps the existing view/settings
  // surface, "messages" replaces the body with a DM thread between the
  // salon and this master (migration 0093). Reset to "profile" when the
  // modal opens for a different master.
  const [panel, setPanel] = useState<PanelKey>("profile");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [vacationSaved, setVacationSaved] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    tgUsername: "",
    bio: "",
    photo: "",
  });
  const [vacationForm, setVacationForm] = useState({
    vacationFrom: "",
    vacationUntil: "",
  });

  useEffect(() => {
    if (!detail.data) return;
    setForm({
      name: detail.data.name ?? "",
      tgUsername: detail.data.tgUsername ?? "",
      bio: detail.data.bio ?? "",
      photo: detail.data.photo ?? "",
    });
    setVacationForm({
      vacationFrom: unixToDateInput(detail.data.vacationFrom),
      vacationUntil: unixToDateInput(detail.data.vacationUntil),
    });
  }, [detail.data]);

  const updateMaster = api.salon.updateMaster.useMutation({
    onSuccess: () => {
      void utils.salon.getMasters.invalidate();
      void utils.salon.getMasterDetail.invalidate({ tenantId, masterChatId: chatId });
      setErrorMsg(null);
    },
    onError: (e) => setErrorMsg(e.message),
  });

  const setHidden = api.salon.setMasterPublicHidden.useMutation({
    onSuccess: () => {
      void utils.salon.getMasters.invalidate();
      void utils.salon.getMasterDetail.invalidate({ tenantId, masterChatId: chatId });
    },
  });

  const removeMaster = api.salon.removeMaster.useMutation({
    onSuccess: () => {
      void utils.salon.getMasters.invalidate();
      onClose();
    },
  });

  // Pending schedule proposals (master_approval policy) — the owner approves /
  // rejects this master's proposal right here in the Harmonogram tab.
  const pendingReqsQ = api.salon.listPendingScheduleRequests.useQuery(
    { tenantId },
    { refetchOnWindowFocus: false },
  );
  const reviewSchedule = api.salon.reviewMasterScheduleRequest.useMutation({
    onSuccess: () => {
      void utils.salon.listPendingScheduleRequests.invalidate({ tenantId });
      void utils.salon.getMasterDetail.invalidate({ tenantId, masterChatId: chatId });
      void utils.salon.getMasters.invalidate();
    },
  });
  const pendingProposal = pendingReqsQ.data?.find((r) => {
    const p = r.payload as { masterId?: unknown } | null;
    return !!p && typeof p.masterId === "number" && p.masterId === chatId;
  }) ?? null;

  const m = detail.data;

  const isEditable = useMemo(() => {
    if (!m) return false;
    if (m.origin === "self_registered") return false;
    if (m.origin === "invited_email" || m.origin === "invited_telegram") {
      return Boolean(m.allowDelegation);
    }
    return true; // salon_created
  }, [m]);

  const editLockReason = useMemo(() => {
    if (!m) return null;
    if (m.origin === "self_registered") return t("masterDetail.lock.selfRegistered", lang);
    if (
      (m.origin === "invited_email" || m.origin === "invited_telegram")
      && !m.allowDelegation
    ) {
      return t("masterDetail.lock.delegationOff", lang);
    }
    return null;
  }, [m, lang]);

  const isWebAccount = m ? m.chatId >= 10_000_000_000 : false;
  const isHidden = m?.publicHidden === 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const inVacationRange =
    !!m
    && typeof m.vacationFrom === "number"
    && typeof m.vacationUntil === "number"
    && m.vacationFrom <= nowSec
    && nowSec <= m.vacationUntil;
  const onVacation = m?.onVacation === 1 || inVacationRange;

  if (detail.isLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-500 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:text-white/60 dark:ring-white/5">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </div>
    );
  }
  if (detail.isError || !m) return null;

  const handleSaveProfile = () => {
    setErrorMsg(null);
    updateMaster.mutate({
      tenantId,
      chatId,
      name: form.name.trim() || undefined,
      tgUsername: form.tgUsername.trim() ? form.tgUsername.trim().replace(/^@/, "") : null,
      bio: form.bio,
      photo: form.photo.trim(),
    });
  };

  const handleSaveVacation = () => {
    setErrorMsg(null);
    setVacationSaved(false);
    const vFrom = dateInputToUnix(vacationForm.vacationFrom);
    const vUntil = dateInputToUnix(vacationForm.vacationUntil);
    if ((vFrom === null) !== (vUntil === null)) {
      setErrorMsg(t("masterDetail.error.vacationPair", lang));
      return;
    }
    if (vFrom !== null && vUntil !== null && vUntil < vFrom) {
      setErrorMsg(t("masterDetail.error.vacationInverted", lang));
      return;
    }
    updateMaster.mutate(
      { tenantId, chatId, vacationFrom: vFrom, vacationUntil: vUntil },
      {
        onSuccess: () => {
          setVacationSaved(true);
          window.setTimeout(() => setVacationSaved(false), 2500);
        },
      },
    );
  };

  const handleSaveSchedule = (workSchedule: string) => {
    setErrorMsg(null);
    setScheduleSaved(false);
    updateMaster.mutate(
      { tenantId, chatId, workSchedule },
      {
        onSuccess: () => {
          setScheduleSaved(true);
          window.setTimeout(() => setScheduleSaved(false), 2500);
        },
      },
    );
  };

  const openSettings = () => {
    setEditing(true);
    setActiveTab("profile");
    setErrorMsg(null);
  };

  const exitSettings = () => {
    setEditing(false);
    setErrorMsg(null);
    setVacationSaved(false);
    // Reset draft fields so a re-entry starts clean
    setForm({
      name: m.name ?? "",
      tgUsername: m.tgUsername ?? "",
      bio: m.bio ?? "",
      photo: m.photo ?? "",
    });
    setVacationForm({
      vacationFrom: unixToDateInput(m.vacationFrom),
      vacationUntil: unixToDateInput(m.vacationUntil),
    });
  };

  return (
    <>
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
        data-testid="master-detail-modal"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              aria-label={t("master.avatar.tooltip", lang)}
              title={t("master.avatar.tooltip", lang)}
              data-testid="master-detail-avatar-trigger"
              className={`group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-purple-500/20 to-brand-500/20 text-2xl font-bold text-purple-400 ring-1 ring-purple-500/15 transition hover:ring-purple-500/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${isHidden ? "opacity-50" : ""}`}
            >
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{resolveMasterAvatarEmoji(m.avatarEmoji ?? null)}</span>
              )}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/55 text-[9px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                {t("master.avatar.tabEmoji", lang)} / {t("master.avatar.tabPhoto", lang)}
              </span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {m.name ?? `#${m.chatId}`}
                </h2>
                {isWebAccount && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20">
                    {t("master.webBadge", lang)}
                  </span>
                )}
                {isHidden && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/15 text-slate-500 border border-slate-500/20">
                    {t("master.hiddenBadge", lang)}
                  </span>
                )}
                {onVacation && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/20">
                    {t("master.vacationBadge", lang)}
                  </span>
                )}
              </div>
              {!isWebAccount && (
                <p className="text-[11px] text-slate-500">ID: {m.chatId}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel switch (migration 0093): Профиль | Сообщения */}
        <div
          role="tablist"
          aria-label="Master view"
          className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium dark:bg-white/[0.04]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={panel === "profile"}
            onClick={() => setPanel("profile")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition ${
              panel === "profile"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
            data-testid="master-detail-panel-profile"
          >
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("masterDetail.panel.profile", lang)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panel === "messages"}
            onClick={() => setPanel("messages")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition ${
              panel === "messages"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
            data-testid="master-detail-panel-messages"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("masterDetail.panel.messages", lang)}</span>
          </button>
        </div>

        {panel === "messages" ? (
          <MasterDmPanel tenantId={tenantId} masterChatId={chatId} lang={lang} />
        ) : !editing ? (
          <ViewMode
            master={m}
            tenantId={tenantId}
            lang={lang}
            isEditable={isEditable}
            editLockReason={editLockReason}
            isHidden={isHidden}
            onOpenSettings={openSettings}
            onToggleHidden={() =>
              setHidden.mutate({ tenantId, chatId, hidden: isHidden ? 0 : 1 })
            }
            onDeleteClick={() => setConfirmDelete(true)}
            hiddenPending={setHidden.isPending}
            onNavigateToChannels={onNavigateToChannels}
          />
        ) : (
          <SettingsMode
            master={m}
            tenantId={tenantId}
            chatId={chatId}
            lang={lang}
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setErrorMsg(null);
              setVacationSaved(false);
              setScheduleSaved(false);
            }}
            form={form}
            vacationForm={vacationForm}
            saving={updateMaster.isPending}
            errorMsg={errorMsg}
            vacationSaved={vacationSaved}
            scheduleSaved={scheduleSaved}
            onFormChange={(patch) => setForm((s) => ({ ...s, ...patch }))}
            onVacationChange={(patch) => setVacationForm((s) => ({ ...s, ...patch }))}
            onSaveProfile={handleSaveProfile}
            onSaveVacation={handleSaveVacation}
            onSaveSchedule={handleSaveSchedule}
            schedulePending={
              pendingProposal ? (
                <SchedulePendingPanel
                  payload={pendingProposal.payload}
                  lang={lang}
                  reviewing={reviewSchedule.isPending}
                  onReview={(decision) =>
                    reviewSchedule.mutate({ requestId: pendingProposal.id, decision })
                  }
                />
              ) : null
            }
            onClearVacation={() => {
              setVacationForm({ vacationFrom: "", vacationUntil: "" });
            }}
            onExit={exitSettings}
          />
        )}

        {confirmDelete && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
            <p className="mb-2">{t("masterDetail.delete.confirm", lang)}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded bg-white px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {t("common.cancel", lang)}
              </button>
              <button
                onClick={() => removeMaster.mutate({ tenantId, chatId })}
                disabled={removeMaster.isPending}
                className="flex-1 rounded bg-rose-600 px-2 py-1 font-semibold text-white disabled:opacity-50"
                data-testid="master-detail-delete-confirm"
              >
                {t("masterDetail.action.delete", lang)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {avatarOpen && (
      <MasterAvatarPicker
        tenantId={tenantId}
        chatId={chatId}
        currentEmoji={m.avatarEmoji ?? null}
        currentUrl={m.avatarUrl ?? null}
        onClose={() => setAvatarOpen(false)}
        onSaved={() => {
          void utils.salon.getMasters.invalidate();
          void utils.salon.getMasterDetail.invalidate({ tenantId, masterChatId: chatId });
        }}
      />
    )}
  </>
  );
}

/**
 * Personal DM between the salon (caller) and the master, embedded inline in
 * the master profile modal. Uses `messenger.createStaffDm` to find-or-create
 * the thread (idempotent via dmKey), then mounts the shared `<ThreadView>`
 * from /messages.
 *
 * Works for every master `origin`:
 *   - salon_created / invited_email accepted / self_registered with a web
 *     account → DM is web↔web, dmKey = sorted(webUserIds).
 *   - invited_telegram or pending-accept → DM is web↔master placeholder,
 *     dmKey = sorted(web_user_id, "m:<chatId>"). `linkMasterPlaceholder`
 *     promotes the row to web↔web later if the master joins the web app.
 */
function MasterDmPanel({
  tenantId,
  masterChatId,
  lang,
}: {
  tenantId: string;
  masterChatId: number;
  lang: Lang;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const createDm = api.messenger.createStaffDm.useMutation({
    onSuccess: (data) => {
      setThreadId(data.threadId);
      setErrorMsg(null);
    },
    onError: (e) => setErrorMsg(e.message),
  });

  useEffect(() => {
    // Reset + (re)open the DM whenever the modal switches between masters.
    setThreadId(null);
    setErrorMsg(null);
    createDm.mutate({ tenantId, otherMasterChatId: String(masterChatId) });
    // createDm is stable enough — we intentionally don't include it in deps
    // (would re-fire on every render). tenantId + masterChatId fully scope it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, masterChatId]);

  if (errorMsg) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
        <p>{t("masterDetail.messages.error", lang)}</p>
        <p className="mt-1 opacity-70">{errorMsg}</p>
      </div>
    );
  }
  if (!threadId) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("masterDetail.messages.loading", lang)}</span>
      </div>
    );
  }
  return (
    <div data-testid="master-detail-dm" className="-mx-1">
      <ThreadView tenantId={tenantId} threadId={threadId} />
    </div>
  );
}

function ViewMode({
  master,
  tenantId,
  lang,
  isEditable,
  editLockReason,
  isHidden,
  onOpenSettings,
  onToggleHidden,
  onDeleteClick,
  hiddenPending,
  onNavigateToChannels,
}: {
  master: NonNullable<MasterDetail>;
  tenantId: string;
  lang: Lang;
  isEditable: boolean;
  editLockReason: string | null;
  isHidden: boolean;
  onOpenSettings: () => void;
  onToggleHidden: () => void;
  onDeleteClick: () => void;
  hiddenPending: boolean;
  onNavigateToChannels?: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <FieldRow
        icon={<Send className="h-4 w-4 text-sky-500" />}
        label={t("masterDetail.field.tgUsername", lang)}
        value={master.tgUsername ? `@${master.tgUsername}` : null}
      />
      <FieldRow
        icon={<Mail className="h-4 w-4 text-slate-400" />}
        label={t("masterDetail.field.email", lang)}
        value={master.webUser?.email ?? null}
      />
      {master.bio && (
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
          {master.bio}
        </div>
      )}
      {(master.vacationFrom || master.vacationUntil) && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t("masterDetail.field.vacation", lang)}:{" "}
            {master.vacationFrom ? unixToDateInput(master.vacationFrom) : "—"} →{" "}
            {master.vacationUntil ? unixToDateInput(master.vacationUntil) : "—"}
          </span>
        </div>
      )}

      {editLockReason && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/[0.04]">
          {editLockReason}
        </div>
      )}

      <MasterTelegramInlineSection
        tenantId={tenantId}
        masterChatId={master.chatId}
        origin={master.origin}
        lang={lang}
        onNavigateToChannels={onNavigateToChannels}
      />

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
        {isEditable && (
          <button
            onClick={onOpenSettings}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 sm:flex-initial"
            data-testid="master-detail-settings"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("masterDetail.action.settings", lang)}</span>
          </button>
        )}
        <button
          onClick={onToggleHidden}
          disabled={hiddenPending}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-50 sm:flex-initial ${
            isHidden
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          }`}
          data-testid="master-detail-visibility"
        >
          {isHidden ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">
            {isHidden ? t("master.showOnPublic", lang) : t("master.hideFromPublic", lang)}
          </span>
        </button>
        <button
          onClick={onDeleteClick}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 sm:ml-auto sm:flex-initial"
          data-testid="master-detail-delete"
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t("masterDetail.action.delete", lang)}</span>
        </button>
      </div>
    </div>
  );
}

function SettingsMode({
  master,
  tenantId,
  chatId,
  lang,
  activeTab,
  onTabChange,
  form,
  vacationForm,
  saving,
  errorMsg,
  vacationSaved,
  scheduleSaved,
  onFormChange,
  onVacationChange,
  onSaveProfile,
  onSaveVacation,
  onSaveSchedule,
  schedulePending,
  onClearVacation,
  onExit,
}: {
  master: NonNullable<MasterDetail>;
  tenantId: string;
  chatId: number;
  lang: Lang;
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
  form: { name: string; tgUsername: string; bio: string; photo: string };
  vacationForm: { vacationFrom: string; vacationUntil: string };
  saving: boolean;
  errorMsg: string | null;
  vacationSaved: boolean;
  scheduleSaved: boolean;
  onFormChange: (patch: Partial<{ name: string; tgUsername: string; bio: string; photo: string }>) => void;
  onVacationChange: (patch: Partial<{ vacationFrom: string; vacationUntil: string }>) => void;
  onSaveProfile: () => void;
  onSaveVacation: () => void;
  onSaveSchedule: (workSchedule: string) => void;
  schedulePending?: React.ReactNode;
  onClearVacation: () => void;
  onExit: () => void;
}) {
  return (
    <div className="space-y-4">
      <TabBar activeTab={activeTab} onTabChange={onTabChange} lang={lang} />

      {activeTab === "profile" ? (
        <ProfilePane
          form={form}
          lang={lang}
          saving={saving}
          errorMsg={errorMsg}
          onChange={onFormChange}
          onSave={onSaveProfile}
        />
      ) : activeTab === "schedule" ? (
        <div className="space-y-1">
          {schedulePending}
          <MasterScheduleEditor
            workHours={master.workHours}
            workDays={master.workDays}
            saving={saving}
            saved={scheduleSaved}
            lang={lang}
            onSave={onSaveSchedule}
            testIdPrefix="master-detail-schedule"
          />
        </div>
      ) : (
        <SettingsPane
          master={master}
          tenantId={tenantId}
          chatId={chatId}
          lang={lang}
          vacationForm={vacationForm}
          saving={saving}
          errorMsg={errorMsg}
          vacationSaved={vacationSaved}
          onVacationChange={onVacationChange}
          onSaveVacation={onSaveVacation}
          onClearVacation={onClearVacation}
        />
      )}

      <div className="flex justify-start border-t border-slate-100 pt-3 dark:border-white/5">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
          data-testid="master-detail-settings-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t("common.back", lang)}</span>
        </button>
      </div>
    </div>
  );
}

function TabBar({
  activeTab,
  onTabChange,
  lang,
}: {
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
  lang: Lang;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex w-full rounded-xl bg-slate-100 p-1 text-xs font-medium dark:bg-white/[0.04]"
      data-testid="master-detail-tabbar"
    >
      <TabButton
        active={activeTab === "profile"}
        onClick={() => onTabChange("profile")}
        icon={<User className="h-3.5 w-3.5" />}
        label={t("masterDetail.tab.profile", lang)}
        testId="master-detail-tab-profile"
      />
      <TabButton
        active={activeTab === "schedule"}
        onClick={() => onTabChange("schedule")}
        icon={<Calendar className="h-3.5 w-3.5" />}
        label={t("master.schedule", lang)}
        testId="master-detail-tab-schedule"
      />
      <TabButton
        active={activeTab === "settings"}
        onClick={() => onTabChange("settings")}
        icon={<Settings className="h-3.5 w-3.5" />}
        label={t("masterDetail.tab.settings", lang)}
        testId="master-detail-tab-settings"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
        active
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ProfilePane({
  form,
  lang,
  saving,
  errorMsg,
  onChange,
  onSave,
}: {
  form: { name: string; tgUsername: string; bio: string; photo: string };
  lang: Lang;
  saving: boolean;
  errorMsg: string | null;
  onChange: (patch: Partial<typeof form>) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <Field label={t("masterDetail.field.name", lang)}>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={200}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
          data-testid="master-detail-name"
        />
      </Field>
      <Field label={t("masterDetail.field.tgUsername", lang)}>
        <input
          type="text"
          value={form.tgUsername}
          onChange={(e) => onChange({ tgUsername: e.target.value })}
          maxLength={64}
          placeholder="@handle"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
        />
      </Field>
      <Field label={t("masterDetail.field.bio", lang)}>
        <textarea
          value={form.bio}
          onChange={(e) => onChange({ bio: e.target.value })}
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
        />
      </Field>
      <Field label={t("masterDetail.field.photo", lang)}>
        <input
          type="url"
          value={form.photo}
          onChange={(e) => onChange({ photo: e.target.value })}
          placeholder="https://…"
          maxLength={2000}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
        />
      </Field>

      {errorMsg && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
          data-testid="master-detail-save"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>{t("common.save", lang)}</span>
        </button>
      </div>
    </div>
  );
}

function SettingsPane({
  master,
  tenantId,
  chatId,
  lang,
  vacationForm,
  saving,
  errorMsg,
  vacationSaved,
  onVacationChange,
  onSaveVacation,
  onClearVacation,
}: {
  master: NonNullable<MasterDetail>;
  tenantId: string;
  chatId: number;
  lang: Lang;
  vacationForm: { vacationFrom: string; vacationUntil: string };
  saving: boolean;
  errorMsg: string | null;
  vacationSaved: boolean;
  onVacationChange: (patch: Partial<{ vacationFrom: string; vacationUntil: string }>) => void;
  onSaveVacation: () => void;
  onClearVacation: () => void;
}) {
  const hasAnyVacation = vacationForm.vacationFrom || vacationForm.vacationUntil;
  return (
    <div className="space-y-4 text-sm">
      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]"
        data-testid="master-detail-vacation-section"
      >
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("masterDetail.settings.vacation.title", lang)}
          </h3>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {t("masterDetail.settings.vacation.hint", lang)}
        </p>
        {/* NB: DatePicker can't live inside <Field> because Field renders a
            <label>, and clicking ANY button inside a <label> re-dispatches
            the click to the label's first form control — which would toggle
            our DatePicker trigger every time the user clicks a day cell or
            month-step arrow, closing the popover. Use a div+span wrapper
            instead. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              {t("masterDetail.field.vacationFrom", lang)}
            </span>
            <DatePicker
              value={vacationForm.vacationFrom}
              onChange={(v) => onVacationChange({ vacationFrom: v })}
              lang={lang}
              max={vacationForm.vacationUntil || undefined}
              placeholder={t("masterDetail.field.vacationFrom", lang)}
              testIdPrefix="master-detail-vacation-from"
            />
          </div>
          <div className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              {t("masterDetail.field.vacationUntil", lang)}
            </span>
            <DatePicker
              value={vacationForm.vacationUntil}
              onChange={(v) => onVacationChange({ vacationUntil: v })}
              lang={lang}
              min={vacationForm.vacationFrom || undefined}
              placeholder={t("masterDetail.field.vacationUntil", lang)}
              testIdPrefix="master-detail-vacation-until"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-300">
            {errorMsg}
          </div>
        )}
        {vacationSaved && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
            {t("masterDetail.settings.vacation.saved", lang)}
          </div>
        )}

        <div className="flex gap-2">
          {hasAnyVacation && (
            <button
              onClick={onClearVacation}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5"
              data-testid="master-detail-vacation-clear"
            >
              {t("masterDetail.settings.vacation.clearCta", lang)}
            </button>
          )}
          <button
            onClick={onSaveVacation}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            data-testid="master-detail-vacation-save"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>{t("masterDetail.settings.vacation.saveCta", lang)}</span>
          </button>
        </div>
      </section>

      <MasterPasswordVaultSection
        tenantId={tenantId}
        masterChatId={chatId}
        masterName={master.name ?? null}
        origin={master.origin}
        webUser={master.webUser ?? null}
        lang={lang}
      />
    </div>
  );
}

function FieldRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[11px] text-slate-500 w-24 shrink-0">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
