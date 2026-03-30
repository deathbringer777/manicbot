"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  CreditCard, Settings, ChevronRight, AlertCircle,
  Loader2, Plus, Pencil, Trash2, Save, X,
  Eye, EyeOff, Globe, ExternalLink, MapPin, ToggleLeft, ToggleRight,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { StatCard, AptCard, SectionHeader, Btn, Input } from "~/components/salon/SalonShared";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";
import { SalonChannelsTab } from "~/components/salon/SalonChannelsTab";

type Tab = "overview" | "appointments" | "masters" | "services" | "clients" | "billing" | "channels" | "settings" | "public_profile";

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
      createSvc.mutate({ tenantId, names: namesJson, price: priceNum, duration: durationNum, emoji, active: activeNum });
    } else {
      updateSvc.mutate({ tenantId, svcId: svc.svcId, names: namesJson, price: priceNum, duration: durationNum, emoji, active: activeNum });
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
            <Settings className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">{t("salon.name", lang)}</p>
              <p className="text-sm text-white font-medium">{profile?.name || "—"}</p>
            </div>
          </div>
          {profile?.salon?.address && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.address", lang)}</p>
                <p className="text-sm text-white">{profile.salon.address}</p>
              </div>
            </div>
          )}
          {profile?.salon?.phone && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.phone", lang)}</p>
                <p className="text-sm text-white">{profile.salon.phone}</p>
              </div>
            </div>
          )}
          {profile?.salon?.workHours && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
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

// ─── Public Profile Editor ───────────────────────────────────────
function PublicProfileEditor({ tenantId }: { tenantId: string }) {
  const utils = api.useUtils();
  const profile = api.salon.getSalonProfile.useQuery({ tenantId });
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [slugError, setSlugError] = useState("");

  const data = profile.data as any;

  useEffect(() => {
    if (data && !editing) {
      setSlug(data.slug ?? "");
      setDescription(data.description ?? "");
      setCity(data.city ?? "");
      setLat(data.lat != null ? String(data.lat) : "");
      setLng(data.lng != null ? String(data.lng) : "");
      setIsPublic(!!data.publicActive);
    }
  }, [data, editing]);

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => { utils.salon.getSalonProfile.invalidate(); setEditing(false); },
  });

  function validateSlug(v: string) {
    if (v && !/^[a-z0-9-]+$/.test(v)) {
      setSlugError("Только строчные латинские буквы, цифры и дефис");
      return false;
    }
    setSlugError("");
    return true;
  }

  function handleSave() {
    if (!validateSlug(slug)) return;
    update.mutate({
      tenantId,
      slug: slug || undefined,
      description: description || undefined,
      city: city || undefined,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      publicActive: isPublic ? 1 : 0,
    });
  }

  const publicUrl = slug ? `/salon/${slug}` : null;

  if (profile.isLoading) return <Loader2 className="animate-spin text-brand-400 mx-auto mt-8" />;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Публичный профиль"
        action={editing
          ? <Btn variant="ghost" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" />Отмена</Btn>
          : <Btn onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />Редактировать</Btn>
        }
      />

      {/* Status banner */}
      <div className={`rounded-xl p-4 flex items-center gap-3 ${isPublic ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-800/60 border border-slate-700"}`}>
        {isPublic
          ? <ToggleRight className="h-6 w-6 text-emerald-400 shrink-0" />
          : <ToggleLeft className="h-6 w-6 text-slate-500 shrink-0" />}
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isPublic ? "text-emerald-300" : "text-slate-400"}`}>
            {isPublic ? "Салон виден в каталоге" : "Салон скрыт из каталога"}
          </p>
          {publicUrl && isPublic && (
            <a href={publicUrl} target="_blank" rel="noopener noreferrer"
              className="mt-0.5 flex items-center gap-1 text-xs text-brand-400 hover:underline">
              <Globe className="h-3 w-3" />
              manicbot.com{publicUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {!editing && (
          <button onClick={() => {
            const newVal = isPublic ? 0 : 1;
            setIsPublic(!!newVal);
            update.mutate({ tenantId, publicActive: newVal });
          }}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${isPublic ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"}`}>
            {isPublic ? "Скрыть" : "Опубликовать"}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          {[
            { label: "URL (slug)", value: data?.slug, icon: Globe },
            { label: "Город", value: data?.city, icon: MapPin },
            { label: "Описание", value: data?.description, icon: null },
            { label: "Координаты", value: (data?.lat && data?.lng) ? `${data.lat}, ${data.lng}` : null, icon: null },
          ].map(({ label, value, icon: Icon }) => value ? (
            <div key={label} className="flex items-start gap-3">
              {Icon ? <Icon className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" /> : <div className="w-4 shrink-0" />}
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm text-white">{value}</p>
              </div>
            </div>
          ) : null)}
          {!data?.slug && (
            <p className="text-xs text-amber-400/80 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              Задайте slug чтобы получить ссылку на публичный профиль
            </p>
          )}
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Показывать в каталоге</p>
              <p className="text-xs text-slate-500">Клиенты смогут найти ваш салон через поиск</p>
            </div>
            <button onClick={() => setIsPublic((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${isPublic ? "bg-brand-500" : "bg-slate-700"}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${isPublic ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="border-t border-white/5 pt-3 space-y-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">URL slug</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 shrink-0">manicbot.com/salon/</span>
                <input value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase()); validateSlug(e.target.value.toLowerCase()); }}
                  placeholder="moi-salon-moskva"
                  className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
              {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Город</label>
              <input value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Москва"
                className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-brand-500" />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Описание</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} placeholder="Расскажите о своём салоне..."
                className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Широта (lat)</label>
                <input value={lat} onChange={(e) => setLat(e.target.value)} type="number" step="0.0001"
                  placeholder="55.7558"
                  className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Долгота (lng)</label>
                <input value={lng} onChange={(e) => setLng(e.target.value)} type="number" step="0.0001"
                  placeholder="37.6173"
                  className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              💡 Координаты можно взять из Google Maps — нажмите на точку на карте, они появятся внизу экрана
            </p>
          </div>

          <Btn onClick={handleSave} disabled={update.isPending || !!slugError} className="w-full justify-center py-2.5">
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить публичный профиль
          </Btn>
        </div>
      )}
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
  const profile = api.salon.getSalonProfile.useQuery({ tenantId }, { enabled: tab === "settings" || tab === "public_profile" });

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
    { key: "public_profile", label: "🌐 Профиль" },
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

      {/* ── APPOINTMENTS ── */}
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

      {/* ── SERVICES ── */}
      {tab === "services" && (
        <div className="space-y-3">
          <SectionHeader title={t("salon.services", lang)} action={
            <Btn onClick={() => setSvcModal({ open: true, svc: null })}><Plus className="h-3.5 w-3.5" />{t("action.add", lang)}</Btn>
          } />
          {svcList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {svcList.data?.map((s: any) => {
              let names: Record<string, string> = {};
              try { names = s.names ? JSON.parse(s.names) : {}; } catch { /* ignore */ }
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

      {/* ── MASTERS ── */}
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
      {tab === "channels" && <SalonChannelsTab tenantId={tenantId} />}

      {/* ── PUBLIC PROFILE ── */}
      {tab === "public_profile" && (
        <PublicProfileEditor tenantId={tenantId} />
      )}

      {/* ── SETTINGS ── */}
      {tab === "settings" && (
        <>
          {profile.isLoading ? <Loader2 className="animate-spin text-brand-400 mx-auto" /> : (
            <SalonSettingsEditor tenantId={tenantId} profile={profile.data} />
          )}
          <SalonCalendarSection tenantId={tenantId} />
        </>
      )}

      {/* Modals */}
      {svcModal.open && <ServiceModal svc={svcModal.svc} onClose={() => setSvcModal({ open: false, svc: null })} tenantId={tenantId} />}
      {masterModal && <AddMasterModal onClose={() => setMasterModal(false)} tenantId={tenantId} />}
    </Shell>
  );
}
