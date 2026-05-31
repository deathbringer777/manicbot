"use client";

/**
 * BroadcastsClient — God-Mode «Рассылки» (operator → tenant messaging).
 *
 * Three blocks, all backed by api.platformBroadcasts (systemAdmin-only):
 *   1. Automations — monthly stat report + subscription-renewal reminder
 *      (singleton campaigns; toggle + channels + timing).
 *   2. Composer — author an announcement: audience + channel matrix
 *      (center always-on) + schedule (now / delayed / recurring) + content.
 *   3. List — existing announcements with pause / resume / delete.
 *
 * RU-only by convention: this surface lives under /system/* and is reachable
 * only by the system_admin operator (the shell re-gates on useRole).
 */

import { useMemo, useState } from "react";
import {
  Megaphone, BarChart3, CreditCard, Send, Loader2, Trash2, Pause, Play, Check,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Switch } from "~/components/ui/Switch";
import { Select } from "~/components/ui/Select";
import { Button } from "~/components/ui/Button";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { SystemMarketingShell } from "../SystemMarketingShell";

const CARD =
  "rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-5";
const LABEL = "text-xs font-semibold uppercase tracking-wider text-slate-400";
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100";

type Channel = "center" | "bell" | "telegram" | "email";
type OptionalChannels = { bell: boolean; telegram: boolean; email: boolean };

const CHANNEL_LABELS: Record<Channel, string> = {
  center: "Центр сообщений",
  bell: "Колокольчик",
  telegram: "Telegram",
  email: "Email",
};

function toChannels(m: OptionalChannels): Channel[] {
  const out: Channel[] = ["center"];
  if (m.bell) out.push("bell");
  if (m.telegram) out.push("telegram");
  if (m.email) out.push("email");
  return out;
}

function fromChannels(list: string[]): OptionalChannels {
  return {
    bell: list.includes("bell"),
    telegram: list.includes("telegram"),
    email: list.includes("email"),
  };
}

/** Channel matrix: center is always-on (locked); the rest toggle freely. */
function ChannelMatrix({
  value,
  onChange,
}: {
  value: OptionalChannels;
  onChange: (next: OptionalChannels) => void;
}) {
  const rows: Array<{ key: Channel; locked?: boolean }> = [
    { key: "center", locked: true },
    { key: "bell" },
    { key: "telegram" },
    { key: "email" },
  ];
  return (
    <div className="space-y-2">
      {rows.map(({ key, locked }) => {
        const on = locked ? true : value[key as keyof OptionalChannels];
        return (
          <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{CHANNEL_LABELS[key]}</p>
              {locked && <p className="text-[11px] text-slate-400">всегда включён · канал ManicBot</p>}
              {key === "telegram" && <p className="text-[11px] text-slate-400">владельцам с привязанным Telegram</p>}
              {key === "email" && <p className="text-[11px] text-slate-400">владельцам с подтверждённым email</p>}
            </div>
            <Switch
              checked={on}
              disabled={locked}
              tone="emerald"
              data-channel={key}
              onChange={(next) => {
                if (locked) return;
                onChange({ ...value, [key]: next });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Automation settings ────────────────────────────────────────────────

function MonthlyReportCard() {
  const utils = api.useUtils();
  const q = api.platformBroadcasts.getMonthlyReportSettings.useQuery();
  const save = api.platformBroadcasts.setMonthlyReportSettings.useMutation({
    onSuccess: () => void utils.platformBroadcasts.getMonthlyReportSettings.invalidate(),
  });
  const [draft, setDraft] = useState<null | { enabled: boolean; channels: OptionalChannels; atHour: number }>(null);
  const state = draft ?? (q.data ? { enabled: q.data.enabled, channels: fromChannels(q.data.channels), atHour: q.data.atHour } : null);

  if (!state) return <div className={CARD}><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;

  return (
    <div className={CARD}>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500"><BarChart3 className="h-4 w-4" /></div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Месячный отчёт салонам</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">1-го числа каждого месяца каждому тенанту приходит персональная статистика за прошлый месяц.</p>
        </div>
        <Switch checked={state.enabled} tone="emerald" data-testid="monthly-enabled" onChange={(enabled) => setDraft({ ...state, enabled })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className={LABEL}>Каналы</p>
          <div className="mt-1"><ChannelMatrix value={state.channels} onChange={(channels) => setDraft({ ...state, channels })} /></div>
        </div>
        <div>
          <p className={LABEL}>Час отправки (Europe/Warsaw)</p>
          <input type="number" min={0} max={23} value={state.atHour} className={`${INPUT} mt-1`} data-testid="monthly-hour"
            onChange={(e) => setDraft({ ...state, atHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button tone="brand" size="sm" disabled={save.isPending} leadingIcon={save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          onClick={() => save.mutate({ enabled: state.enabled, channels: toChannels(state.channels), atHour: state.atHour, atMinute: 0 })}>
          Сохранить
        </Button>
        {save.isSuccess && !draft && <span className="text-[11px] text-emerald-600">Сохранено</span>}
      </div>
    </div>
  );
}

function SubscriptionReminderCard() {
  const utils = api.useUtils();
  const q = api.platformBroadcasts.getSubscriptionReminderSettings.useQuery();
  const save = api.platformBroadcasts.setSubscriptionReminderSettings.useMutation({
    onSuccess: () => void utils.platformBroadcasts.getSubscriptionReminderSettings.invalidate(),
  });
  const [draft, setDraft] = useState<null | { enabled: boolean; channels: OptionalChannels; daysBefore: number }>(null);
  const state = draft ?? (q.data ? { enabled: q.data.enabled, channels: fromChannels(q.data.channels), daysBefore: q.data.daysBefore } : null);

  if (!state) return <div className={CARD}><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;

  return (
    <div className={CARD}>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500"><CreditCard className="h-4 w-4" /></div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Напоминание о продлении</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">За N дней до продления/окончания подписки владелец получает напоминание. Транзакционное — email уходит всегда.</p>
        </div>
        <Switch checked={state.enabled} tone="emerald" data-testid="reminder-enabled" onChange={(enabled) => setDraft({ ...state, enabled })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className={LABEL}>Каналы</p>
          <div className="mt-1"><ChannelMatrix value={state.channels} onChange={(channels) => setDraft({ ...state, channels })} /></div>
        </div>
        <div>
          <p className={LABEL}>За сколько дней</p>
          <input type="number" min={1} max={30} value={state.daysBefore} className={`${INPUT} mt-1`} data-testid="reminder-days"
            onChange={(e) => setDraft({ ...state, daysBefore: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button tone="brand" size="sm" disabled={save.isPending} leadingIcon={save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          onClick={() => save.mutate({ enabled: state.enabled, channels: toChannels(state.channels), daysBefore: state.daysBefore, atHour: 9 })}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

// ─── Announcement composer ────────────────────────────────────────────────

type Plan = "start" | "pro" | "max";
type BillingStatus = "trialing" | "active" | "grace" | "expired";
const PLANS: Plan[] = ["start", "pro", "max"];
const BILLING_STATUSES: BillingStatus[] = ["trialing", "active", "grace", "expired"];

type AudienceState =
  | { scope: "all" }
  | { scope: "by_plan"; plans: Plan[] }
  | { scope: "by_billing_status"; statuses: BillingStatus[] };

type ScheduleState =
  | { kind: "now" }
  | { kind: "once"; at: string }
  | { kind: "recurring"; freq: "daily" | "weekly" | "monthly"; weekday: number; day: number; hour: number };

function Composer() {
  const utils = api.useUtils();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState<OptionalChannels>({ bell: true, telegram: false, email: true });
  const [audience, setAudience] = useState<AudienceState>({ scope: "all" });
  const [schedule, setSchedule] = useState<ScheduleState>({ kind: "now" });
  const [err, setErr] = useState<string | null>(null);

  const audienceFilter = useMemo(() => {
    if (audience.scope === "by_plan") return { scope: "by_plan" as const, plans: audience.plans };
    if (audience.scope === "by_billing_status") return { scope: "by_billing_status" as const, statuses: audience.statuses };
    return { scope: "all" as const };
  }, [audience]);

  const audienceValid =
    audience.scope === "all" ||
    (audience.scope === "by_plan" && audience.plans.length > 0) ||
    (audience.scope === "by_billing_status" && audience.statuses.length > 0);

  const preview = api.platformBroadcasts.previewAudience.useQuery(
    { audience: audienceFilter },
    { enabled: audienceValid },
  );

  const create = api.platformBroadcasts.campaignCreate.useMutation({
    onSuccess: () => {
      setTitle(""); setMessage(""); setErr(null);
      void utils.platformBroadcasts.campaignList.invalidate();
    },
    onError: (e) => setErr(e.message),
  });

  function buildSchedule() {
    if (schedule.kind === "now") return { kind: "now" as const };
    if (schedule.kind === "once") {
      const at = Math.floor(new Date(schedule.at).getTime() / 1000);
      return { kind: "once" as const, scheduledAt: at };
    }
    if (schedule.freq === "weekly") return { kind: "recurring" as const, recurrence: { freq: "weekly" as const, weekday: schedule.weekday, hour: schedule.hour, minute: 0 } };
    if (schedule.freq === "monthly") return { kind: "recurring" as const, recurrence: { freq: "monthly" as const, day: schedule.day, hour: schedule.hour, minute: 0 } };
    return { kind: "recurring" as const, recurrence: { freq: "daily" as const, hour: schedule.hour, minute: 0 } };
  }

  function submit() {
    if (!message.trim()) { setErr("Заполните текст сообщения."); return; }
    create.mutate({
      title: title.trim() || undefined,
      bodies: { center: message.trim() },
      audience: audienceFilter,
      channels: toChannels(channels),
      schedule: buildSchedule(),
    });
  }

  return (
    <div className={CARD}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500"><Megaphone className="h-4 w-4" /></div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Новое объявление</h3>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className={LABEL}>Заголовок (необязательно)</p>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`${INPUT} mt-1`} placeholder="ManicBot" />
          </div>
          <div>
            <p className={LABEL}>Сообщение</p>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} maxLength={4000} className={`${INPUT} mt-1 resize-y`} placeholder="Текст для владельцев салонов…" data-testid="composer-message" />
            <p className="mt-1 text-[11px] text-slate-400">{message.length}/4000</p>
          </div>
          <div>
            <p className={LABEL}>Каналы</p>
            <div className="mt-1"><ChannelMatrix value={channels} onChange={setChannels} /></div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className={LABEL}>Аудитория</p>
            <div className="mt-1">
              <Select
                value={audience.scope}
                testIdPrefix="audience-scope"
                onChange={(v) =>
                  setAudience(v === "by_plan" ? { scope: "by_plan", plans: [] } : v === "by_billing_status" ? { scope: "by_billing_status", statuses: [] } : { scope: "all" })
                }
                options={[
                  { value: "all", label: "Все тенанты" },
                  { value: "by_plan", label: "По тарифу" },
                  { value: "by_billing_status", label: "По статусу оплаты" },
                ]}
              />
            </div>
            {audience.scope === "by_plan" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PLANS.map((p) => (
                  <ChipToggle key={p} label={p} on={audience.plans.includes(p)}
                    onToggle={() => setAudience({ scope: "by_plan", plans: audience.plans.includes(p) ? audience.plans.filter((x) => x !== p) : [...audience.plans, p] })} />
                ))}
              </div>
            )}
            {audience.scope === "by_billing_status" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {BILLING_STATUSES.map((s) => (
                  <ChipToggle key={s} label={s} on={audience.statuses.includes(s)}
                    onToggle={() => setAudience({ scope: "by_billing_status", statuses: audience.statuses.includes(s) ? audience.statuses.filter((x) => x !== s) : [...audience.statuses, s] })} />
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {audienceValid ? (preview.isFetching ? "Считаем получателей…" : `Получателей: ${preview.data?.count ?? 0}`) : "Выберите хотя бы один вариант."}
            </p>
          </div>

          <div>
            <p className={LABEL}>Расписание</p>
            <div className="mt-1">
              <Select
                value={schedule.kind}
                testIdPrefix="schedule-kind"
                onChange={(v) =>
                  setSchedule(v === "once" ? { kind: "once", at: "" } : v === "recurring" ? { kind: "recurring", freq: "daily", weekday: 1, day: 1, hour: 9 } : { kind: "now" })
                }
                options={[
                  { value: "now", label: "Сейчас" },
                  { value: "once", label: "Отложить (один раз)" },
                  { value: "recurring", label: "Циклично" },
                ]}
              />
            </div>
            {schedule.kind === "once" && (
              <input type="datetime-local" value={schedule.at} className={`${INPUT} mt-2`} data-testid="schedule-at"
                onChange={(e) => setSchedule({ kind: "once", at: e.target.value })} />
            )}
            {schedule.kind === "recurring" && (
              <div className="mt-2 space-y-2">
                <Select value={schedule.freq} testIdPrefix="recurrence-freq"
                  onChange={(v) => setSchedule({ ...schedule, freq: v as "daily" | "weekly" | "monthly" })}
                  options={[{ value: "daily", label: "Ежедневно" }, { value: "weekly", label: "Еженедельно" }, { value: "monthly", label: "Ежемесячно" }]} />
                {schedule.freq === "weekly" && (
                  <Select value={String(schedule.weekday)} testIdPrefix="recurrence-weekday"
                    onChange={(v) => setSchedule({ ...schedule, weekday: Number(v) })}
                    options={["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"].map((d, i) => ({ value: String(i), label: d }))} />
                )}
                {schedule.freq === "monthly" && (
                  <input type="number" min={1} max={28} value={schedule.day} className={INPUT}
                    onChange={(e) => setSchedule({ ...schedule, day: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
                )}
                <input type="number" min={0} max={23} value={schedule.hour} className={INPUT} placeholder="Час"
                  onChange={(e) => setSchedule({ ...schedule, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} />
              </div>
            )}
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="mt-4">
        <Button tone="brand" disabled={create.isPending || !audienceValid}
          leadingIcon={create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          onClick={submit}>
          {schedule.kind === "now" ? "Опубликовать" : "Запланировать"}
        </Button>
      </div>
    </div>
  );
}

function ChipToggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        on ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300"
      }`}>
      {label}
    </button>
  );
}

// ─── Announcements list ─────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик", scheduled: "Запланировано", active: "Активно", paused: "Пауза", done: "Отправлено", failed: "Ошибка",
};

function AnnouncementsList() {
  const utils = api.useUtils();
  const list = api.platformBroadcasts.campaignList.useQuery({});
  const pause = api.platformBroadcasts.campaignPause.useMutation({ onSuccess: () => void utils.platformBroadcasts.campaignList.invalidate() });
  const resume = api.platformBroadcasts.campaignResume.useMutation({ onSuccess: () => void utils.platformBroadcasts.campaignList.invalidate() });
  const del = api.platformBroadcasts.campaignDelete.useMutation({ onSuccess: () => void utils.platformBroadcasts.campaignList.invalidate() });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const items = list.data ?? [];

  return (
    <div className={CARD}>
      <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Объявления</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">Пока нет объявлений.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{c.title || "(без заголовка)"}</p>
                <p className="truncate text-[11px] text-slate-400">{STATUS_LABEL[c.status] ?? c.status} · {c.scheduleKind}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {c.status === "paused" ? (
                  <Button size="sm" variant="ghost" tone="emerald" leadingIcon={<Play className="h-3.5 w-3.5" />} onClick={() => resume.mutate({ id: c.id })}>Возобновить</Button>
                ) : (c.status === "active" || c.status === "scheduled") ? (
                  <Button size="sm" variant="ghost" tone="amber" leadingIcon={<Pause className="h-3.5 w-3.5" />} onClick={() => pause.mutate({ id: c.id })}>Пауза</Button>
                ) : null}
                <Button size="sm" variant="ghost" tone="red" leadingIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmId(c.id)}>Удалить</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmId !== null}
        title="Удалить объявление?"
        description="Объявление и его история доставки будут удалены безвозвратно."
        confirmLabel="Удалить"
        tone="danger"
        onConfirm={() => { if (confirmId) del.mutate({ id: confirmId }); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

export default function BroadcastsClient() {
  return (
    <SystemMarketingShell title="Рассылки" subtitle="Платформа → салоны · отчёты, объявления, напоминания">
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <MonthlyReportCard />
          <SubscriptionReminderCard />
        </div>
        <Composer />
        <AnnouncementsList />
      </div>
    </SystemMarketingShell>
  );
}
