"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  CreditCard, Settings, ChevronRight, Clock, AlertCircle,
  CheckCircle2, XCircle, Loader2, Building2, Plus, Pencil,
  Trash2, Save, X, Search, Phone, MapPin, Eye, EyeOff,
  MessageCircle, Wifi, WifiOff, Copy, Check, ExternalLink,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";

type Tab = "overview" | "appointments" | "masters" | "services" | "clients" | "billing" | "channels" | "settings";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  cancelled: "bg-red-500/15 text-red-400 border border-red-500/20",
  rejected: "bg-red-500/15 text-red-400 border border-red-500/20",
};

const APT_BORDER: Record<string, string> = {
  confirmed: "border-l-emerald-500",
  pending:   "border-l-amber-400",
  cancelled: "border-l-red-500/40",
  rejected:  "border-l-red-500/40",
};

// ─── Reusable components ─────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4 relative overflow-hidden">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
          <p className="text-xs text-slate-400 leading-tight">{label}</p>
          {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Card ────────────────────────────────────────────
function AptCard({ a, lang, onAction }: {
  a: any; lang: Lang; onAction?: (id: any, status: "confirmed" | "cancelled" | "rejected") => void;
}) {
  const [hh, mm] = (a.time ?? "00:00").split(":");
  const border = APT_BORDER[a.status] ?? "border-l-slate-700";
  const nameWords = (a.userName ?? "?").trim().split(/\s+/);
  const initials = nameWords.length >= 2
    ? (nameWords[0]![0]! + nameWords[1]![0]!).toUpperCase()
    : (a.userName ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className={`glass-card rounded-xl border-l-2 ${border} overflow-hidden`}>
      <div className="p-3 flex items-start gap-3">
        {/* Avatar */}
        <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400 mt-0.5">
          {initials}
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm leading-tight truncate">{a.userName ?? `#${a.chatId}`}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">{a.svcId}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold text-white tabular-nums leading-none">
                {hh}<span className="text-slate-500 font-normal text-sm">:{mm ?? "00"}</span>
              </p>
              <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1 ${STATUS_STYLES[a.status] ?? "bg-slate-700 text-slate-300"}`}>
                {t(`status.${a.status}` as any, lang)}
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* Actions */}
      {onAction && a.status === "pending" && (
        <div className="flex border-t border-white/5">
          <button onClick={() => onAction(a.id, "confirmed")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/10 transition-colors">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t("action.confirm", lang)}
          </button>
          <div className="w-px bg-white/5" />
          <button onClick={() => onAction(a.id, "rejected")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors">
            <XCircle className="h-3.5 w-3.5" /> {t("action.reject", lang)}
          </button>
        </div>
      )}
      {onAction && a.status === "confirmed" && (
        <div className="flex border-t border-white/5">
          <button onClick={() => onAction(a.id, "cancelled")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-red-400/60 text-xs font-medium hover:bg-red-500/10 transition-colors">
            <XCircle className="h-3.5 w-3.5" /> {t("action.cancel", lang)}
          </button>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {action}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger";
  disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-brand-500/20 text-brand-400 border border-brand-500/30 hover:bg-brand-500/30",
    ghost: "bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10",
    danger: "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-40 flex items-center gap-1.5 ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-600" />
    </div>
  );
}

// ─── Service Edit Modal ──────────────────────────────────────────
function ServiceModal({ svc, onClose, tenantId }: { svc: any | null; onClose: () => void; tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [name, setName] = useState(() => {
    if (!svc) return "";
    const names = svc.names ? JSON.parse(svc.names) : {};
    return names.ru ?? names.en ?? svc.svcId ?? "";
  });
  const [price, setPrice] = useState(String(svc?.price ?? ""));
  const [duration, setDuration] = useState(String(svc?.duration ?? "60"));
  const [emoji, setEmoji] = useState(svc?.emoji ?? "💅");
  const [active, setActive] = useState(svc?.active !== 0);

  const updateSvc = api.salon.updateService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); onClose(); },
  });
  const createSvc = api.salon.createService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); onClose(); },
  });

  const isNew = !svc;

  function handleSave() {
    const namesJson = JSON.stringify({ ru: name, en: name, ua: name, pl: name });
    const activeNum = active ? 1 : 0;
    const priceNum = parseFloat(price) || 0;
    const durationNum = parseInt(duration, 10) || 60;
    if (isNew) {
      createSvc.mutate({
        tenantId,
        names: namesJson,
        price: priceNum,
        duration: durationNum,
        emoji,
        active: activeNum,
      });
    } else {
      updateSvc.mutate({
        tenantId,
        svcId: svc.svcId,
        names: namesJson,
        price: priceNum,
        duration: durationNum,
        emoji,
        active: activeNum,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-t-3xl md:rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">{isNew ? t("action.create", lang) : t("action.edit", lang)}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4}
            className="w-14 h-14 text-center text-3xl bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:ring-1 focus:ring-brand-500" />
          <div className="flex-1">
            <Input label={t("service.name", lang)} value={name} onChange={setName} placeholder="Маникюр" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("service.price", lang)} value={price} onChange={setPrice} type="number" placeholder="500" />
          <Input label={t("service.duration", lang)} value={duration} onChange={setDuration} type="number" placeholder="60" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setActive(!active)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
              active ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-500 border border-white/10"
            }`}>
            {active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {active ? t("service.active", lang) : t("service.hidden", lang)}
          </button>
        </div>
        <Btn onClick={handleSave} disabled={updateSvc.isPending || createSvc.isPending} className="w-full justify-center py-2.5">
          {(updateSvc.isPending || createSvc.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("common.save", lang)}
        </Btn>
      </div>
    </div>
  );
}

// ─── Add Master Modal ────────────────────────────────────────────
function AddMasterModal({ onClose, tenantId }: { onClose: () => void; tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [chatId, setChatId] = useState("");
  const [name, setName] = useState("");

  const addMaster = api.salon.addMaster.useMutation({
    onSuccess: () => { utils.salon.getMasters.invalidate(); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-t-3xl md:rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">{t("master.addMaster", lang)}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Input label={t("master.chatId", lang)} value={chatId} onChange={setChatId} type="number" placeholder="123456789" />
        <Input label={t("master.name", lang)} value={name} onChange={setName} placeholder="Анна" />
        <Btn onClick={() => addMaster.mutate({ tenantId, chatId: parseInt(chatId), name })}
          disabled={!chatId || addMaster.isPending} className="w-full justify-center py-2.5">
          {addMaster.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("action.add", lang)}
        </Btn>
      </div>
    </div>
  );
}

// ─── Salon Settings Editor ───────────────────────────────────────
function SalonSettingsEditor({ tenantId, profile }: { tenantId: string; profile: any }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [editing, setEditing] = useState(false);
  const [salonName, setSalonName] = useState(profile?.name ?? "");
  const [address, setAddress] = useState(profile?.salon?.address ?? "");
  const [phone, setPhone] = useState(profile?.salon?.phone ?? "");
  const [hoursFrom, setHoursFrom] = useState(String(profile?.salon?.workHours?.from ?? "9"));
  const [hoursTo, setHoursTo] = useState(String(profile?.salon?.workHours?.to ?? "20"));

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => { utils.salon.getSalonProfile.invalidate(); setEditing(false); },
  });

  if (!editing) {
    return (
      <div className="space-y-4">
        <SectionHeader title={t("salon.salonProfile", lang)} action={
          <Btn onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />{t("action.edit", lang)}</Btn>
        } />
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">{t("salon.name", lang)}</p>
              <p className="text-sm text-white font-medium">{profile?.name || "—"}</p>
            </div>
          </div>
          {profile?.salon?.address && (
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.address", lang)}</p>
                <p className="text-sm text-white">{profile.salon.address}</p>
              </div>
            </div>
          )}
          {profile?.salon?.phone && (
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.phone", lang)}</p>
                <p className="text-sm text-white">{profile.salon.phone}</p>
              </div>
            </div>
          )}
          {profile?.salon?.workHours && (
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.hours", lang)}</p>
                <p className="text-sm text-white">{profile.salon.workHours.from}:00 — {profile.salon.workHours.to}:00</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title={t("salon.editProfile", lang)} action={
        <Btn variant="ghost" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" />{t("action.cancel", lang)}</Btn>
      } />
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <Input label={t("salon.name", lang)} value={salonName} onChange={setSalonName} />
        <Input label={t("salon.address", lang)} value={address} onChange={setAddress} />
        <Input label={t("salon.phone", lang)} value={phone} onChange={setPhone} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("salon.workHoursFrom", lang)} value={hoursFrom} onChange={setHoursFrom} type="number" />
          <Input label={t("salon.workHoursTo", lang)} value={hoursTo} onChange={setHoursTo} type="number" />
        </div>
        <Btn onClick={() => update.mutate({
          tenantId,
          name: salonName,
          address,
          phone,
          workHoursFrom: parseInt(hoursFrom, 10) || 9,
          workHoursTo: parseInt(hoursTo, 10) || 20,
        })} disabled={update.isPending} className="w-full justify-center py-2.5">
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("common.save", lang)}
        </Btn>
      </div>
    </div>
  );
}

// ─── Google Calendar Section ─────────────────────────────────────
function GoogleCalendarSection({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const integrations = api.googleCalendar.list.useQuery({ tenantId });
  const connectInfo = api.googleCalendar.getConnectInfo.useQuery({ tenantId });
  const utils = api.useUtils();
  const toggleSync = api.googleCalendar.toggleSync.useMutation({
    onSuccess: () => utils.googleCalendar.list.invalidate(),
  });
  const disconnect = api.googleCalendar.disconnect.useMutation({
    onSuccess: () => utils.googleCalendar.list.invalidate(),
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const rows = integrations.data ?? [];
  const connectButtonLabel =
    lang === "ru" ? "Открыть бот для подключения" :
    lang === "ua" ? "Відкрити бота для підключення" :
    lang === "pl" ? "Otwórz bota, aby połączyć" :
    "Open bot to connect";
  const connectHint =
    lang === "ru" ? "Безопасное подключение запускается в Telegram-боте, где Worker создаёт короткую OAuth-сессию." :
    lang === "ua" ? "Безпечне підключення запускається в Telegram-боті, де Worker створює коротку OAuth-сесію." :
    lang === "pl" ? "Bezpieczne połączenie startuje w bocie Telegram, gdzie Worker tworzy krótką sesję OAuth." :
    "Secure connection starts in the Telegram bot, where the Worker creates a short-lived OAuth session.";
  const salonScopeLabel =
    lang === "ru" ? "Салон" :
    lang === "ua" ? "Салон" :
    lang === "pl" ? "Salon" :
    "Salon";
  const masterScopeLabel =
    lang === "ru" ? "Мастер" :
    lang === "ua" ? "Майстер" :
    lang === "pl" ? "Master" :
    "Master";

  return (
    <div className="space-y-4 mt-6">
      <SectionHeader
        title="Google Calendar"
        action={connectInfo.data?.botLink ? (
          <Btn
            onClick={() => window.open(connectInfo.data?.botLink ?? "", "_blank", "noopener,noreferrer")}
            className="shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {connectButtonLabel}
          </Btn>
        ) : undefined}
      />
      <div className="glass-card rounded-2xl p-4 space-y-2">
        <p className="text-xs text-slate-400">{connectHint}</p>
        {connectInfo.data?.botUsername ? (
          <p className="text-[11px] text-slate-500">
            @{connectInfo.data.botUsername}
          </p>
        ) : (
          <p className="text-[11px] text-amber-400">
            {lang === "ru" ? "Активный username бота не найден. Откройте салонный бот вручную и зайдите в Google Calendar." :
             lang === "ua" ? "Активний username бота не знайдено. Відкрийте салонного бота вручну і зайдіть у Google Calendar." :
             lang === "pl" ? "Nie znaleziono aktywnego username bota. Otwórz bota salonu ręcznie i przejdź do Google Calendar." :
             "No active bot username found. Open the salon bot manually and use its Google Calendar panel."}
          </p>
        )}
      </div>
      {integrations.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {!integrations.isLoading && rows.length === 0 && (
        <div className="glass-card rounded-2xl p-4 text-center">
          <CalendarDays className="h-8 w-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {lang === "ru" ? "Нет подключённых календарей" :
             lang === "ua" ? "Немає підключених календарів" :
             lang === "pl" ? "Brak podpiętych kalendarzy" :
             "No calendars connected"}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {lang === "ru" ? "Подключение начинается из бота салона, где открывается защищённая OAuth-сессия." :
             lang === "ua" ? "Підключення починається в боті салону, де відкривається захищена OAuth-сесія." :
             lang === "pl" ? "Połączenie zaczyna się w bocie salonu, gdzie otwierana jest chroniona sesja OAuth." :
             "Connection starts in the salon bot, where a protected OAuth session is created."}
          </p>
        </div>
      )}
      {rows.map((row) => (
        <div key={row.id} className="glass-card rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarDays className="h-4 w-4 text-brand-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-white font-medium truncate">
                  {row.calendarSummary || row.calendarId}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-wide">
                    {row.scope === "tenant" ? salonScopeLabel : masterScopeLabel}
                  </span>
                  {row.masterName && <span>{row.masterName}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {row.syncEnabled ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-500" />
              )}
            </div>
          </div>
          {row.providerAccountEmail && (
            <p className="text-[10px] text-slate-500">{row.providerAccountEmail}</p>
          )}
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            {row.lastSyncAt && (
              <span>
                {lang === "ru" ? "Последняя синхр." :
                 lang === "ua" ? "Остання синхр." :
                 lang === "pl" ? "Ostatnia synchronizacja" :
                 "Last sync"}: {new Date(row.lastSyncAt).toLocaleString()}
              </span>
            )}
            {row.lastSyncStatus && (
              <span className={row.lastSyncStatus === "ok" ? "text-emerald-400" : "text-amber-400"}>
                ({row.lastSyncStatus})
              </span>
            )}
          </div>
          {row.lastSyncError && (
            <p className="text-[11px] text-amber-400">{row.lastSyncError}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Btn
              variant={row.syncEnabled ? "ghost" : "primary"}
              onClick={() => toggleSync.mutate({ tenantId, integrationId: row.id, enabled: !row.syncEnabled })}
              disabled={toggleSync.isPending || disconnect.isPending}
            >
              {row.syncEnabled
                ? (lang === "ru" ? "Выкл. синхр." :
                   lang === "ua" ? "Вимк. синхр." :
                   lang === "pl" ? "Wstrzymaj sync" :
                   "Pause sync")
                : (lang === "ru" ? "Вкл. синхр." :
                   lang === "ua" ? "Увімк. синхр." :
                   lang === "pl" ? "Wznów sync" :
                   "Resume sync")}
            </Btn>
            {confirmDisconnect === row.id ? (
              <>
                <Btn
                  variant="danger"
                  onClick={() => { disconnect.mutate({ tenantId, integrationId: row.id }); setConfirmDisconnect(null); }}
                  disabled={disconnect.isPending}
                >
                  {lang === "ru" ? "Да, отключить" :
                   lang === "ua" ? "Так, відключити" :
                   lang === "pl" ? "Tak, odłącz" :
                   "Yes, disconnect"}
                </Btn>
                <Btn variant="ghost" onClick={() => setConfirmDisconnect(null)} disabled={disconnect.isPending}>
                  <X className="h-3 w-3" />
                </Btn>
              </>
            ) : (
              <Btn variant="danger" onClick={() => setConfirmDisconnect(row.id)} disabled={disconnect.isPending}>
                <Trash2 className="h-3 w-3" />
                {lang === "ru" ? "Отключить" :
                 lang === "ua" ? "Відключити" :
                 lang === "pl" ? "Odłącz" :
                 "Disconnect"}
              </Btn>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Channels Tab ────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-2 text-slate-400 hover:text-brand-400 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ChannelCard({
  icon, title, subtitle, connected, onToggle, togglePending, children,
}: {
  icon: React.ReactNode; title: string; subtitle: string;
  connected: boolean; onToggle?: () => void; togglePending?: boolean;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(!connected);
  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Wifi className="h-3.5 w-3.5" /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <WifiOff className="h-3.5 w-3.5" /> Not connected
            </span>
          )}
          {onToggle && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 rounded-lg px-2 py-1 transition-colors"
            >
              {expanded ? "Hide" : connected ? "Edit" : "Connect"}
            </button>
          )}
        </div>
      </div>
      {expanded && children && <div className="border-t border-white/5 pt-3">{children}</div>}
    </div>
  );
}

function ChannelsTab({ tenantId }: { tenantId: string }) {
  const utils = api.useUtils();
  const channels = api.channels.list.useQuery({ tenantId });
  const hints = api.salon.getMetaChannelHints.useQuery({ tenantId });
  const upsert = api.channels.upsert.useMutation({
    onSuccess: () => { void utils.channels.list.invalidate(); },
  });
  const remove = api.channels.delete.useMutation({
    onSuccess: () => { void utils.channels.list.invalidate(); },
  });

  const waConfig = channels.data?.find(c => c.channelType === "whatsapp");
  const igConfig = channels.data?.find(c => c.channelType === "instagram");

  // WhatsApp form state
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  // Instagram form state
  const [igPageId, setIgPageId] = useState("");
  const [igToken, setIgToken] = useState("");

  const [showWaToken, setShowWaToken] = useState(false);
  const [showIgToken, setShowIgToken] = useState(false);

  const waWebhookUrl = hints.data?.waWebhookUrl ?? "https://manicbot.com/webhook/wa";
  const igWebhookUrl = hints.data?.igWebhookUrl ?? "https://manicbot.com/webhook/ig";
  const waVerifyDisplay = hints.data?.waVerifyToken;
  const igVerifyDisplay = hints.data?.igVerifyToken;

  if (channels.isLoading) return <Loader2 className="animate-spin text-brand-400 mx-auto" />;

  const handleWaSave = () => {
    if (!waPhoneId.trim() || !waToken.trim()) return;
    const config = JSON.stringify({ phone_number_id: waPhoneId.trim(), waba_id: waWabaId.trim(), access_token: waToken.trim() });
    upsert.mutate({ tenantId, channelType: "whatsapp", config, active: true });
    setWaPhoneId(""); setWaToken(""); setWaWabaId("");
  };

  const handleIgSave = () => {
    if (!igPageId.trim() || !igToken.trim()) return;
    const config = JSON.stringify({ page_id: igPageId.trim(), access_token: igToken.trim() });
    upsert.mutate({ tenantId, channelType: "instagram", config, active: true });
    setIgPageId(""); setIgToken("");
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Channels" />

      {/* Telegram — always connected */}
      <ChannelCard
        icon={<MessageCircle className="h-5 w-5" />}
        title="Telegram"
        subtitle="Primary booking channel"
        connected={true}
      />

      {/* WhatsApp */}
      <ChannelCard
        icon={<span className="text-base font-bold">WA</span>}
        title="WhatsApp"
        subtitle="WhatsApp Cloud API"
        connected={!!waConfig?.active}
        onToggle={() => {}}
      >
        {waConfig ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 space-y-1">
              {(() => {
                const cfg = waConfig.config ? (() => { try { return JSON.parse(waConfig.config); } catch { return {}; } })() : {};
                return (
                  <>
                    <div className="flex items-center"><span className="text-slate-500 w-32">Phone Number ID:</span><span className="text-white font-mono">{cfg.phone_number_id ?? "—"}</span></div>
                    {cfg.waba_id && <div className="flex items-center"><span className="text-slate-500 w-32">WABA ID:</span><span className="text-white font-mono">{cfg.waba_id}</span></div>}
                    <div className="flex items-center"><span className="text-slate-500 w-32">Token:</span><span className="text-slate-400">••••••••</span></div>
                  </>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <button onClick={() => remove.mutate({ tenantId, id: waConfig.id })}
                className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1">
                <Trash2 className="h-3 w-3" /> Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Enter your WhatsApp Cloud API credentials from Meta Developer Dashboard.</p>
            <div className="space-y-2">
              <input value={waPhoneId} onChange={e => setWaPhoneId(e.target.value)} placeholder="Phone Number ID"
                className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
              <input value={waWabaId} onChange={e => setWaWabaId(e.target.value)} placeholder="WABA ID (optional)"
                className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
              <div className="relative">
                <input type={showWaToken ? "text" : "password"} value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="Access Token"
                  className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
                <button onClick={() => setShowWaToken(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showWaToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <button onClick={handleWaSave} disabled={!waPhoneId || !waToken || upsert.isPending}
              className="w-full text-xs bg-brand-500/20 hover:bg-brand-500/30 text-brand-400 border border-brand-500/30 rounded-xl py-2 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save & Connect
            </button>
          </div>
        )}
        {/* Webhook URL */}
        <div className="mt-3 p-2.5 bg-black/20 rounded-xl">
          <p className="text-[10px] text-slate-500 mb-1">Webhook URL (paste in Meta Dashboard)</p>
          <div className="flex items-center">
            <code className="text-[10px] text-slate-300 font-mono flex-1 truncate">{waWebhookUrl}</code>
            <CopyButton text={waWebhookUrl} />
            <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="ml-1 text-slate-500 hover:text-brand-400">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center mt-1 gap-1 flex-wrap">
            <p className="text-[10px] text-slate-500 flex-1 min-w-[80px]">Verify Token:</p>
            {waVerifyDisplay ? (
              <>
                <code className="text-[10px] text-slate-300 font-mono break-all">{waVerifyDisplay}</code>
                <CopyButton text={waVerifyDisplay} />
              </>
            ) : (
              <span className="text-[10px] text-amber-400/90">Set META_VERIFY_TOKEN_WA on Pages (= Worker secret)</span>
            )}
          </div>
        </div>
      </ChannelCard>

      {/* Instagram */}
      <ChannelCard
        icon={<span className="text-base font-bold">IG</span>}
        title="Instagram"
        subtitle="Instagram Messaging API"
        connected={!!igConfig?.active}
        onToggle={() => {}}
      >
        {igConfig ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 space-y-1">
              {(() => {
                const cfg = igConfig.config ? (() => { try { return JSON.parse(igConfig.config); } catch { return {}; } })() : {};
                return (
                  <>
                    <div className="flex items-center"><span className="text-slate-500 w-24">Page ID:</span><span className="text-white font-mono">{cfg.page_id ?? "—"}</span></div>
                    <div className="flex items-center"><span className="text-slate-500 w-24">Token:</span><span className="text-slate-400">••••••••</span></div>
                  </>
                );
              })()}
            </div>
            <button onClick={() => remove.mutate({ tenantId, id: igConfig.id })}
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Enter your Instagram Messaging API credentials.</p>
            <div className="space-y-2">
              <input value={igPageId} onChange={e => setIgPageId(e.target.value)} placeholder="Instagram Page ID"
                className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
              <div className="relative">
                <input type={showIgToken ? "text" : "password"} value={igToken} onChange={e => setIgToken(e.target.value)} placeholder="Page Access Token"
                  className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
                <button onClick={() => setShowIgToken(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showIgToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <button onClick={handleIgSave} disabled={!igPageId || !igToken || upsert.isPending}
              className="w-full text-xs bg-brand-500/20 hover:bg-brand-500/30 text-brand-400 border border-brand-500/30 rounded-xl py-2 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save & Connect
            </button>
          </div>
        )}
        {/* Webhook URL */}
        <div className="mt-3 p-2.5 bg-black/20 rounded-xl">
          <p className="text-[10px] text-slate-500 mb-1">Webhook URL (paste in Meta Dashboard)</p>
          <div className="flex items-center">
            <code className="text-[10px] text-slate-300 font-mono flex-1 truncate">{igWebhookUrl}</code>
            <CopyButton text={igWebhookUrl} />
          </div>
          <div className="flex items-center mt-1 gap-1 flex-wrap">
            <p className="text-[10px] text-slate-500 flex-1 min-w-[80px]">Verify Token:</p>
            {igVerifyDisplay ? (
              <>
                <code className="text-[10px] text-slate-300 font-mono break-all">{igVerifyDisplay}</code>
                <CopyButton text={igVerifyDisplay} />
              </>
            ) : (
              <span className="text-[10px] text-amber-400/90">Set META_VERIFY_TOKEN_IG on Pages (= Worker secret)</span>
            )}
          </div>
        </div>
      </ChannelCard>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────
export function SalonDashboard({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "channels" || q === "instagram" || q === "whatsapp") setTab("channels");
    } catch { /* ignore */ }
  }, []);
  const [aptDate, setAptDate] = useState("");
  const [svcModal, setSvcModal] = useState<{ open: boolean; svc: any | null }>({ open: false, svc: null });
  const [masterModal, setMasterModal] = useState(false);

  const utils = api.useUtils();

  const salonNavItems: NavItem[] = [
    { href: "#overview", icon: LayoutDashboard, label: t("salon.overview", lang) },
    { href: "#appointments", icon: CalendarDays, label: t("salon.appointments", lang) },
    { href: "#services", icon: Scissors, label: t("salon.services", lang) },
    { href: "#masters", icon: UserCheck, label: t("salon.masters", lang) },
    { href: "#settings", icon: Settings, label: t("common.settings", lang) },
  ];

  const todayStr = new Date().toISOString().slice(0, 10);
  const overview = api.salon.getOverview.useQuery({ tenantId }, { enabled: tab === "overview" });
  const todayApts = api.salon.getAppointments.useQuery({ tenantId, date: todayStr }, { enabled: tab === "overview" });
  const apts = api.salon.getAppointments.useQuery({ tenantId, date: aptDate || undefined }, { enabled: tab === "appointments" });
  const mastersList = api.salon.getMasters.useQuery({ tenantId }, { enabled: tab === "masters" });
  const svcList = api.salon.getServices.useQuery({ tenantId }, { enabled: tab === "services" });
  const clients = api.salon.getClients.useQuery({ tenantId }, { enabled: tab === "clients" || tab === "overview" });
  const billing = api.salon.getBillingStatus.useQuery({ tenantId }, { enabled: tab === "billing" || tab === "overview" });
  const profile = api.salon.getSalonProfile.useQuery({ tenantId }, { enabled: tab === "settings" });

  const updateAptStatus = api.salon.updateAppointmentStatus.useMutation({
    onSuccess: () => utils.salon.getAppointments.invalidate(),
  });
  const removeMaster = api.salon.removeMaster.useMutation({
    onSuccess: () => utils.salon.getMasters.invalidate(),
  });
  const deleteSvc = api.salon.deleteService.useMutation({
    onSuccess: () => utils.salon.getServices.invalidate(),
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: t("salon.overview", lang) },
    { key: "appointments", label: t("salon.appointments", lang) },
    { key: "services", label: t("salon.services", lang) },
    { key: "masters", label: t("salon.masters", lang) },
    { key: "clients", label: t("salon.clients", lang) },
    { key: "billing", label: t("salon.billing", lang) },
    { key: "channels", label: "Channels" },
    { key: "settings", label: t("common.settings", lang) },
  ];

  return (
    <Shell navItems={salonNavItems} title={t("salon.title", lang)} subtitle="ManicBot Salon">
      {/* Tab pills */}
      <div className="flex overflow-x-auto scrollbar-none gap-1.5 mb-5 -mx-1 px-1">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              tab === tb.key
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
            }`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          {overview.isLoading ? (
            <div className="grid grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="glass-card rounded-2xl h-20 animate-pulse" />)}</div>
          ) : overview.data && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t("salon.todayApts", lang)} value={overview.data.todayAppointments} icon={CalendarDays} color="bg-brand-500/20 text-brand-400" />
              <StatCard label={t("salon.activeMasters", lang)} value={overview.data.activeMasters} icon={Scissors} color="bg-purple-500/20 text-purple-400" />
              <StatCard label={t("salon.openTickets", lang)} value={overview.data.openTickets} icon={AlertCircle} color="bg-amber-500/20 text-amber-400" />
              <StatCard label={t("billing.plan", lang)} value={overview.data.plan?.toUpperCase() ?? "START"}
                sub={t(`billing.${overview.data.billingStatus ?? "trialing"}` as any, lang)}
                icon={CreditCard} color="bg-emerald-500/20 text-emerald-400" />
            </div>
          )}

          {/* Today's appointments feed */}
          {todayApts.isLoading && (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="glass-card rounded-xl h-16 animate-pulse" />)}</div>
          )}
          {todayApts.data && todayApts.data.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{t("salon.todayApts", lang)}</h3>
                <button onClick={() => setTab("appointments")}
                  className="flex items-center gap-0.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                  {t("salon.appointments", lang)} <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {todayApts.data.slice(0, 4).map((a: any) => (
                <AptCard key={a.id} a={a} lang={lang}
                  onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })} />
              ))}
              {todayApts.data.length > 4 && (
                <button onClick={() => setTab("appointments")}
                  className="w-full text-xs text-slate-500 text-center py-2 hover:text-slate-300 transition-colors">
                  +{todayApts.data.length - 4} {t("salon.appointments", lang).toLowerCase()}
                </button>
              )}
            </div>
          )}
          {todayApts.data?.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-4">{t("salon.noApts", lang)}</p>
          )}
        </div>
      )}

      {/* ── APPOINTMENTS with status controls ── */}
      {tab === "appointments" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white flex-1">{t("salon.appointments", lang)}</h2>
            <input type="date" value={aptDate} onChange={e => setAptDate(e.target.value)}
              className="text-xs bg-white/5 border border-white/10 text-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {apts.data?.map((a: any) => (
              <AptCard key={a.id} a={a} lang={lang}
                onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })} />
            ))}
            {apts.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noApts", lang)}</p>}
          </div>
        </div>
      )}

      {/* ── SERVICES with CRUD ── */}
      {tab === "services" && (
        <div className="space-y-3">
          <SectionHeader title={t("salon.services", lang)} action={
            <Btn onClick={() => setSvcModal({ open: true, svc: null })}><Plus className="h-3.5 w-3.5" />{t("action.add", lang)}</Btn>
          } />
          {svcList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {svcList.data?.map((s: any) => {
              const names = s.names ? JSON.parse(s.names) : {};
              const name = names.ru ?? names.en ?? s.svcId;
              return (
                <div key={s.svcId} className="glass-card rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl shrink-0">{s.emoji ?? "💅"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white text-sm">{name}</p>
                      <p className="text-xs text-slate-400">{s.duration} {t("service.duration", lang).split("(")[0]?.trim()} · {s.price} ₴</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.active ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700 text-slate-500"}`}>
                      {s.active ? t("service.active", lang) : t("service.hidden", lang)}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-2 pt-2 border-t border-white/5">
                    <button onClick={() => setSvcModal({ open: true, svc: s })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 text-slate-400 text-xs hover:text-white hover:bg-white/10 transition-colors">
                      <Pencil className="h-3 w-3" /> {t("action.edit", lang)}
                    </button>
                    <button onClick={() => { if (confirm(t("confirm.deleteService", lang))) deleteSvc.mutate({ tenantId, svcId: s.svcId }); }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400/70 text-xs hover:text-red-400 hover:bg-red-500/20 transition-colors">
                      <Trash2 className="h-3 w-3" /> {t("action.delete", lang)}
                    </button>
                  </div>
                </div>
              );
            })}
            {svcList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noServices", lang)}</p>}
          </div>
        </div>
      )}

      {/* ── MASTERS with add/remove ── */}
      {tab === "masters" && (
        <div className="space-y-3">
          <SectionHeader title={t("salon.masters", lang)} action={
            <Btn onClick={() => setMasterModal(true)}><Plus className="h-3.5 w-3.5" />{t("action.add", lang)}</Btn>
          } />
          {mastersList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {mastersList.data?.map((m: any) => (
              <div key={m.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-brand-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {(m.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm">{m.name ?? `#${m.chatId}`}</p>
                  <p className="text-[10px] text-slate-500">ID: {m.chatId}</p>
                </div>
                <button onClick={() => { if (confirm(t("confirm.removeMaster", lang))) removeMaster.mutate({ tenantId, chatId: m.chatId }); }}
                  className="h-8 w-8 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/20 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {mastersList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noMasters", lang)}</p>}
          </div>
        </div>
      )}

      {/* ── CLIENTS ── */}
      {tab === "clients" && (
        <div className="space-y-3">
          <SectionHeader title={t("salon.clients", lang)} />
          {clients.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {clients.data?.map((c: any) => (
              <div key={c.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-400 shrink-0">
                  {(c.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm">{c.name ?? `#${c.chatId}`}</p>
                  <p className="text-[10px] text-slate-500">
                    {c.tgUsername ? `@${c.tgUsername}` : ""} {c.phone ?? ""}
                  </p>
                </div>
              </div>
            ))}
            {clients.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noClients", lang)}</p>}
          </div>
        </div>
      )}

      {/* ── BILLING ── */}
      {tab === "billing" && (
        <div className="space-y-4">
          <SectionHeader title={t("salon.billingTitle", lang)} />
          {billing.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {billing.data && (
            <div className="glass-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">{t("billing.plan", lang)}</span>
                <span className="font-bold text-white text-lg">{(billing.data.plan ?? "start").toUpperCase()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">{t("billing.status", lang)}</span>
                <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                  billing.data.billingStatus === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                }`}>
                  {t(`billing.${billing.data.billingStatus ?? "trialing"}` as any, lang)}
                </span>
              </div>
              {billing.data.nextPaymentDate && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">{t("billing.nextPayment", lang)}</span>
                  <span className="text-white text-sm">{new Date(billing.data.nextPaymentDate * 1000).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CHANNELS ── */}
      {tab === "channels" && <ChannelsTab tenantId={tenantId} />}

      {/* ── SETTINGS with edit ── */}
      {tab === "settings" && (
        <>
          {profile.isLoading ? <Loader2 className="animate-spin text-brand-400 mx-auto" /> : (
            <SalonSettingsEditor tenantId={tenantId} profile={profile.data} />
          )}
          <GoogleCalendarSection tenantId={tenantId} />
        </>
      )}

      {/* Modals */}
      {svcModal.open && <ServiceModal svc={svcModal.svc} onClose={() => setSvcModal({ open: false, svc: null })} tenantId={tenantId} />}
      {masterModal && <AddMasterModal onClose={() => setMasterModal(false)} tenantId={tenantId} />}
    </Shell>
  );
}
