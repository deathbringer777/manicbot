"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  CreditCard, Settings, ChevronRight, AlertCircle,
  Loader2, Plus, Pencil, Trash2, Save, X,
  Eye, EyeOff, Globe, ExternalLink, MapPin, ToggleLeft, ToggleRight,
  Star, MessageSquare, Reply,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useInWebShell } from "~/components/layout/WebShell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { StatCard, AptCard, SectionHeader, Btn, Input } from "~/components/salon/SalonShared";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";
import { SalonChannelsTab } from "~/components/salon/SalonChannelsTab";
import { AssetUploadField } from "~/components/salon/AssetUploadField";
import { AnalyticsTab } from "~/components/salon/AnalyticsTab";

type Tab = "overview" | "appointments" | "masters" | "services" | "clients" | "billing" | "channels" | "reviews" | "settings" | "public_profile" | "analytics";

// ─── Service Edit Modal ──────────────────────────────────────────
function ServiceModal({ svc, onClose, tenantId }: { svc: any | null; onClose: () => void; tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [name, setName] = useState(() => {
    if (!svc) return "";
    let names: Record<string, string> = {};
    try { names = svc.names ? JSON.parse(svc.names) : {}; } catch { /* ignore malformed JSON */ }
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
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl md:rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{isNew ? t("action.create", lang) : t("action.edit", lang)}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4}
            className="w-14 h-14 text-center text-3xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl focus:outline-none focus:ring-1 focus:ring-brand-500" />
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
              active ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-white/10"
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
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl md:rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("master.addMaster", lang)}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
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
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [address, setAddress] = useState(profile?.salon?.address ?? "");
  const [phone, setPhone] = useState(profile?.salon?.phone ?? "");
  const [hoursFrom, setHoursFrom] = useState(String(profile?.salon?.workHours?.from ?? "9"));
  const [hoursTo, setHoursTo] = useState(String(profile?.salon?.workHours?.to ?? "20"));
  const [logo, setLogo] = useState(profile?.logo ?? "");
  const [logoR2Key, setLogoR2Key] = useState(profile?.logoR2Key ?? "");
  const [coverPhoto, setCoverPhoto] = useState(profile?.coverPhoto ?? "");
  const [coverR2Key, setCoverR2Key] = useState(profile?.coverR2Key ?? "");
  const [brandPrimary, setBrandPrimary] = useState<string>(
    (profile?.brandPalette && typeof profile.brandPalette === "object" && profile.brandPalette.primary) || "#EC4899",
  );

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
              <p className="text-sm text-slate-900 dark:text-white font-medium">{profile?.name || "—"}</p>
            </div>
          </div>
          {profile?.displayName && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">Отображаемое имя</p>
                <p className="text-sm text-slate-900 dark:text-white">{profile.displayName}</p>
              </div>
            </div>
          )}
          {profile?.salon?.address && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.address", lang)}</p>
                <p className="text-sm text-slate-900 dark:text-white">{profile.salon.address}</p>
              </div>
            </div>
          )}
          {profile?.salon?.phone && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.phone", lang)}</p>
                <p className="text-sm text-slate-900 dark:text-white">{profile.salon.phone}</p>
              </div>
            </div>
          )}
          {profile?.salon?.workHours && (
            <div className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.hours", lang)}</p>
                <p className="text-sm text-slate-900 dark:text-white">{profile.salon.workHours.from}:00 — {profile.salon.workHours.to}:00</p>
              </div>
            </div>
          )}
          {(profile?.logo || profile?.coverPhoto || profile?.brandPalette?.primary) && (
            <div className="border-t border-slate-200 dark:border-white/5 pt-3 flex gap-3 items-start">
              {profile.logo && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Логотип</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.logo} alt="logo" className="h-14 w-14 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                </div>
              )}
              {profile.coverPhoto && (
                <div className="flex-1">
                  <p className="text-xs text-slate-500 mb-1">Заглавное фото</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.coverPhoto} alt="cover" className="h-14 w-full rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                </div>
              )}
              {profile.brandPalette?.primary && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Цвет бренда</p>
                  <div
                    className="h-14 w-14 rounded-lg border border-slate-200 dark:border-slate-700"
                    style={{ background: profile.brandPalette.primary }}
                    title={profile.brandPalette.primary}
                  />
                </div>
              )}
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
        <Input
          label="Отображаемое имя (опционально)"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Оставьте пустым, чтобы использовать основное имя"
        />
        <Input label={t("salon.address", lang)} value={address} onChange={setAddress} />
        <Input label={t("salon.phone", lang)} value={phone} onChange={setPhone} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("salon.workHoursFrom", lang)} value={hoursFrom} onChange={setHoursFrom} type="number" />
          <Input label={t("salon.workHoursTo", lang)} value={hoursTo} onChange={setHoursTo} type="number" />
        </div>
        <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
          <AssetUploadField
            label="Логотип"
            tenantId={tenantId}
            kind="logo"
            value={logo}
            onChange={({ url, key }) => {
              setLogo(url);
              setLogoR2Key(key);
            }}
            preview="square"
            hint="PNG/JPEG/WebP, до 2 MB. Оптимально 512×512."
          />
          <AssetUploadField
            label="Заглавное фото"
            tenantId={tenantId}
            kind="cover"
            value={coverPhoto}
            onChange={({ url, key }) => {
              setCoverPhoto(url);
              setCoverR2Key(key);
            }}
            preview="cover"
            hint="PNG/JPEG/WebP, до 2 MB. Оптимально 1600×500."
          />
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Цвет бренда</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandPrimary}
                onChange={(e) => setBrandPrimary(e.target.value)}
                className="h-10 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent cursor-pointer"
                aria-label="Brand primary color"
              />
              <input
                value={brandPrimary}
                onChange={(e) => setBrandPrimary(e.target.value)}
                placeholder="#EC4899"
                className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 font-mono uppercase"
              />
            </div>
          </div>
        </div>
        <Btn onClick={() => {
          const isValidHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brandPrimary);
          update.mutate({
            tenantId,
            name: salonName,
            displayName: displayName || "",
            address,
            phone,
            workHoursFrom: parseInt(hoursFrom, 10) || 9,
            workHoursTo: parseInt(hoursTo, 10) || 20,
            logo: logo || "",
            coverPhoto: coverPhoto || "",
            logoR2Key: logoR2Key || "",
            coverR2Key: coverR2Key || "",
            brandPalette: isValidHex ? { primary: brandPrimary } : null,
          });
        }} disabled={update.isPending} className="w-full justify-center py-2.5">
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("common.save", lang)}
        </Btn>
      </div>
    </div>
  );
}

// ─── Auto-confirm Settings ──────────────────────────────────────
//
// Per-channel toggle for "skip the master review step and confirm
// instantly when a client books." Web defaults to ON (TikTok / IG bio
// leads need an immediate response, masters aren't watching the widget
// in real time); Telegram / WhatsApp / Instagram default to OFF because
// the master IS in those threads. The defaults must mirror
// `manicbot/src/services/services.js:AUTO_CONFIRM_DEFAULTS`.
function AutoConfirmSettings({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const { data, isLoading } = api.salon.getAutoConfirmSettings.useQuery({ tenantId });
  const set = api.salon.setAutoConfirm.useMutation({
    onSuccess: () => { utils.salon.getAutoConfirmSettings.invalidate(); },
  });

  const channels: Array<{ key: "web" | "telegram" | "whatsapp" | "instagram"; label: string; hint: string }> = [
    { key: "web",       label: "Веб-чат (manicbot.com / TikTok / соцсети)", hint: "Записи через виджет на странице салона. Рекомендуется ВКЛ — клиенты ждут мгновенного ответа." },
    { key: "telegram",  label: "Telegram",                                   hint: "Записи через Telegram-бота. По умолчанию ВЫКЛ — мастер видит заявку и подтверждает вручную." },
    { key: "whatsapp",  label: "WhatsApp",                                   hint: "Записи через WhatsApp Business. По умолчанию ВЫКЛ." },
    { key: "instagram", label: "Instagram Direct",                           hint: "Записи через Instagram DM. По умолчанию ВЫКЛ." },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader title="Автоматическое подтверждение заявок" />
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Если включено — заявки из выбранного канала сразу становятся подтверждёнными
          без шага одобрения мастером. Мастер всё равно получает уведомление о записи.
        </p>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
          </div>
        ) : (
          channels.map((ch) => {
            const enabled = data?.[ch.key] ?? (ch.key === "web");
            return (
              <div key={ch.key} className="flex items-start justify-between gap-3 py-2 border-t border-slate-200 dark:border-white/5 first:border-t-0 first:pt-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{ch.label}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{ch.hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={set.isPending}
                  onClick={() => set.mutate({ tenantId, channel: ch.key, enabled: !enabled })}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5 ${
                    enabled ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"
                  } ${set.isPending ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                      enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            );
          })
        )}
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
  const [slugChecked, setSlugChecked] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");

  const data = profile.data as any;

  useEffect(() => {
    if (data && !editing) {
      setSlug(data.slug ?? "");
      setDescription(data.description ?? "");
      setCity(data.city ?? "");
      setLat(data.lat != null ? String(data.lat) : "");
      setLng(data.lng != null ? String(data.lng) : "");
      setIsPublic(!!data.publicActive);
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
    }
  }, [data, editing]);

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => { utils.salon.getSalonProfile.invalidate(); setEditing(false); },
  });

  const slugCheck = api.salon.checkSlugAvailable.useQuery(
    { slug, tenantId },
    { enabled: editing && slug.length > 0 && !slugError, staleTime: 5000 },
  );

  function validateSlug(v: string) {
    if (v && !/^[a-z0-9-]+$/.test(v)) {
      setSlugError("Только строчные латинские буквы, цифры и дефис");
      setSlugChecked(null);
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
      photos,
    });
  }

  function addPhoto() {
    const url = newPhotoUrl.trim();
    if (!url) return;
    setPhotos((prev) => [...prev, url]);
    setNewPhotoUrl("");
  }

  const publicUrl = slug ? `/salon/${slug}` : null;

  if (profile.isLoading) return <Loader2 className="animate-spin text-brand-400 mx-auto mt-8" />;
  if (profile.isError) return <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>;

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
      <div className={`rounded-xl p-4 flex items-center gap-3 ${isPublic ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"}`}>
        {isPublic
          ? <ToggleRight className="h-6 w-6 text-emerald-400 shrink-0" />
          : <ToggleLeft className="h-6 w-6 text-slate-500 shrink-0" />}
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isPublic ? "text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}>
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
                <p className="text-sm text-slate-900 dark:text-white">{value}</p>
              </div>
            </div>
          ) : null)}
          {(data?.logo || data?.coverPhoto) && (
            <div className="flex gap-3 border-t border-slate-200 dark:border-white/5 pt-3">
              {data.logo && <img src={data.logo} alt="logo" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
              {data.coverPhoto && <img src={data.coverPhoto} alt="cover" className="h-12 flex-1 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
            </div>
          )}
          {photos.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">Галерея ({photos.length})</p>
              <div className="flex flex-wrap gap-2">
                {photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                ))}
              </div>
            </div>
          )}
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
              <p className="text-sm font-medium text-slate-900 dark:text-white">Показывать в каталоге</p>
              <p className="text-xs text-slate-500">Клиенты смогут найти ваш салон через поиск</p>
            </div>
            <button onClick={() => setIsPublic((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${isPublic ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-700"}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${isPublic ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">URL slug</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-500 shrink-0">manicbot.com/salon/</span>
                <input value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase()); validateSlug(e.target.value.toLowerCase()); }}
                  placeholder="moi-salon-moskva"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                {slug && !slugError && (
                  <span className={`shrink-0 text-xs font-medium ${slugCheck.data?.available === false ? "text-red-400" : slugCheck.data?.available ? "text-emerald-400" : "text-slate-500"}`}>
                    {slugCheck.isLoading ? "..." : slugCheck.data?.available === false ? "❌ Занят" : slugCheck.data?.available ? "✅" : ""}
                  </span>
                )}
              </div>
              {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Город</label>
              <input value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Москва"
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Описание</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} placeholder="Расскажите о своём салоне..."
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Широта (lat)</label>
                <input value={lat} onChange={(e) => setLat(e.target.value)} type="number" step="0.0001"
                  placeholder="55.7558"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Долгота (lng)</label>
                <input value={lng} onChange={(e) => setLng(e.target.value)} type="number" step="0.0001"
                  placeholder="37.6173"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              💡 Координаты можно взять из Google Maps — нажмите на точку на карте, они появятся внизу экрана
            </p>

            {/* Photos */}
            <div className="border-t border-slate-200 dark:border-white/5 pt-3">
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-2 block">Галерея салона ({photos.length})</label>
              {photos.length > 0 && (
                <div className="space-y-2 mb-3">
                  {photos.map((url, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
                      <span className="flex-1 text-xs text-slate-500 truncate">{url}</span>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" disabled={i === 0}
                          onClick={() => setPhotos((prev) => { const a = [...prev]; const t = a[i-1]!; a[i-1] = a[i]!; a[i] = t; return a; })}
                          className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-300 dark:hover:bg-slate-600">
                          ↑
                        </button>
                        <button type="button" disabled={i === photos.length - 1}
                          onClick={() => setPhotos((prev) => { const a = [...prev]; const t = a[i+1]!; a[i+1] = a[i]!; a[i] = t; return a; })}
                          className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-300 dark:hover:bg-slate-600">
                          ↓
                        </button>
                        <button type="button"
                          onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                          className="h-6 w-6 flex items-center justify-center rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newPhotoUrl}
                  onChange={(e) => setNewPhotoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPhoto())}
                  placeholder="https://example.com/photo.jpg"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
                />
                <button type="button" onClick={addPhoto}
                  className="shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Добавить
                </button>
              </div>
            </div>
          </div>

          <Btn onClick={handleSave} disabled={update.isPending || !!slugError || slugCheck.data?.available === false} className="w-full justify-center py-2.5">
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить публичный профиль
          </Btn>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────
// ─── Review Card (salon dashboard) ──────────────────────────────────────────

function ReviewCard({ rev, tenantId }: { rev: any; tenantId: string }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(rev.replyText ?? "");
  const utils = api.useUtils();

  const updateStatus = api.reviews.updateStatus.useMutation({
    onSuccess: () => utils.reviews.getForSalon.invalidate(),
  });
  const addReply = api.reviews.addReply.useMutation({
    onSuccess: () => { utils.reviews.getForSalon.invalidate(); setReplyOpen(false); },
  });
  const deleteReply = api.reviews.deleteReply.useMutation({
    onSuccess: () => utils.reviews.getForSalon.invalidate(),
  });

  const STATUS_LABELS: Record<string, string> = { active: "Active", hidden: "Hidden", featured: "Featured" };
  const STATUS_COLORS: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-500",
    hidden: "bg-slate-500/20 text-slate-400",
    featured: "bg-amber-500/20 text-amber-500",
  };

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-400 text-xs font-bold shrink-0">
          {(rev.userName ?? "?").charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-white">{rev.userName ?? `User #${rev.chatId}`}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_COLORS[rev.status] ?? ""}`}>
              {STATUS_LABELS[rev.status] ?? rev.status}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {[1,2,3,4,5].map(s => (
              <Star key={s} className={`w-3 h-3 ${s <= rev.rating ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
            ))}
            <span className="text-[10px] text-slate-500 ml-1">
              {new Date(rev.createdAt * 1000).toLocaleDateString()}
            </span>
          </div>
          {rev.text && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-3">{rev.text}</p>}
          {rev.photos?.length > 0 && (
            <div className="flex gap-1 mt-2">
              {rev.photos.map((p: string, i: number) => (
                <div key={i} className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-700 text-[9px] text-slate-400 flex items-center justify-center">
                  img
                </div>
              ))}
            </div>
          )}
          {rev.replyText && (
            <div className="mt-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 border-l-2 border-brand-400">
              <p className="text-[10px] text-brand-400 font-medium mb-0.5">Salon reply</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{rev.replyText}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-200 dark:border-white/5">
        <button
          onClick={() => updateStatus.mutate({ tenantId, reviewId: rev.id, status: rev.status === "hidden" ? "active" : "hidden" })}
          className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          {rev.status === "hidden" ? <><Eye className="w-3 h-3 inline mr-1" />Show</> : <><EyeOff className="w-3 h-3 inline mr-1" />Hide</>}
        </button>
        <button
          onClick={() => updateStatus.mutate({ tenantId, reviewId: rev.id, status: rev.status === "featured" ? "active" : "featured" })}
          className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <Star className={`w-3 h-3 inline mr-1 ${rev.status === "featured" ? "fill-amber-400 text-amber-400" : ""}`} />
          {rev.status === "featured" ? "Unfeature" : "Feature"}
        </button>
        {!rev.replyText ? (
          <button
            onClick={() => setReplyOpen(!replyOpen)}
            className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <Reply className="w-3 h-3 inline mr-1" />Reply
          </button>
        ) : (
          <button
            onClick={() => deleteReply.mutate({ tenantId, reviewId: rev.id })}
            className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 text-red-400"
          >
            <Trash2 className="w-3 h-3 inline mr-1" />Delete reply
          </button>
        )}
      </div>

      {/* Reply form */}
      {replyOpen && (
        <div className="mt-2 flex gap-2">
          <input
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Write your reply..."
            className="flex-1 text-xs px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-brand-500"
          />
          <button
            onClick={() => addReply.mutate({ tenantId, reviewId: rev.id, text: replyText })}
            disabled={!replyText.trim() || addReply.isPending}
            className="px-3 py-2 rounded-lg bg-brand-500 text-white text-xs font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

export function SalonDashboard({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const inWeb = useInWebShell();

  const VALID_SALON_TABS: Tab[] = ["overview", "appointments", "masters", "services", "clients", "billing", "channels", "reviews", "settings", "public_profile", "analytics"];
  const urlTab = searchParams.get("tab");
  const resolvedSalonTab: Tab =
    urlTab === "instagram" || urlTab === "whatsapp" ? "channels"
    : urlTab && VALID_SALON_TABS.includes(urlTab as Tab) ? (urlTab as Tab)
    : "overview";

  const [tab, setTab] = useState<Tab>(resolvedSalonTab);

  // Sync tab when URL changes (sidebar click in WebShell)
  useEffect(() => {
    if (inWeb) setTab(resolvedSalonTab);
  }, [resolvedSalonTab, inWeb]);
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
  const profile = api.salon.getSalonProfile.useQuery({ tenantId }, { enabled: tab === "settings" || tab === "public_profile" || tab === "analytics" });
  const reviewStats = api.reviews.getStats.useQuery({ tenantId }, { enabled: tab === "reviews" || tab === "overview" });
  const reviewList = api.reviews.getForSalon.useQuery({ tenantId }, { enabled: tab === "reviews" });
  const botStatus = api.salon.getBotStatus.useQuery({ tenantId }, { enabled: tab === "analytics" });

  const updateAptStatus = api.salon.updateAppointmentStatus.useMutation({
    onSuccess: () => { utils.salon.getAppointments.invalidate(); todayApts.refetch(); },
  });
  const markNoShow = api.salon.markNoShow.useMutation({
    onSuccess: () => { utils.salon.getAppointments.invalidate(); todayApts.refetch(); },
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
    { key: "analytics", label: "📊 Аналитика" },
    { key: "billing", label: t("salon.billing", lang) },
    { key: "channels", label: "Channels" },
    { key: "reviews", label: "Reviews" },
    { key: "public_profile", label: "🌐 Профиль" },
    { key: "settings", label: t("common.settings", lang) },
  ];

  return (
    <Shell navItems={salonNavItems} title={t("salon.title", lang)} subtitle="ManicBot Salon">
      {/* Tab pills — hidden in WebShell (sidebar handles navigation) */}
      {!inWeb && <div data-tour="salon-tabs" className="flex overflow-x-auto scrollbar-none gap-1.5 mb-5 -mx-1 px-1">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              tab === tb.key
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}>
            {tb.label}
          </button>
        ))}
      </div>}

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          {overview.isLoading ? (
            <div className="grid grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="glass-card rounded-2xl h-20 animate-pulse" />)}</div>
          ) : overview.isError ? (
            <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>
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
          {todayApts.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          {todayApts.data && todayApts.data.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("salon.todayApts", lang)}</h3>
                <button onClick={() => setTab("appointments")}
                  className="flex items-center gap-0.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                  {t("salon.appointments", lang)} <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {todayApts.data.slice(0, 4).map((a: any) => (
                <AptCard key={a.id} a={a} lang={lang}
                  onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
                  onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })} />
              ))}
              {todayApts.data.length > 4 && (
                <button onClick={() => setTab("appointments")}
                  className="w-full text-xs text-slate-500 text-center py-2 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
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
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">{t("salon.appointments", lang)}</h2>
            <input type="date" value={aptDate} onChange={e => setAptDate(e.target.value)}
              className="text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {apts.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          <div className="space-y-2">
            {apts.data?.map((a: any) => (
              <AptCard key={a.id} a={a} lang={lang}
                onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
                onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })} />
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
          {svcList.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
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
                      <p className="font-medium text-slate-900 dark:text-white text-sm">{name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.duration} {t("service.duration", lang).split("(")[0]?.trim()} · {s.price}\u00a0zł</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.active ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-200 dark:bg-slate-700 text-slate-500"}`}>
                      {s.active ? t("service.active", lang) : t("service.hidden", lang)}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-white/5">
                    <button onClick={() => setSvcModal({ open: true, svc: s })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 text-xs hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
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
          {mastersList.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          <div className="space-y-2">
            {mastersList.data?.map((m: any) => (
              <div key={m.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-brand-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {(m.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm">{m.name ?? `#${m.chatId}`}</p>
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
          {clients.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          <div className="space-y-2">
            {clients.data?.map((c: any) => (
              <div key={c.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-400 shrink-0">
                  {(c.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm">{c.name ?? `#${c.chatId}`}</p>
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
          {billing.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          {billing.data && (
            <div className="glass-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.plan", lang)}</span>
                <span className="font-bold text-slate-900 dark:text-white text-lg">{(billing.data.plan ?? "start").toUpperCase()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.status", lang)}</span>
                <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                  billing.data.billingStatus === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                }`}>
                  {t(`billing.${billing.data.billingStatus ?? "trialing"}` as any, lang)}
                </span>
              </div>
              {billing.data.nextPaymentDate && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.nextPayment", lang)}</span>
                  <span className="text-slate-900 dark:text-white text-sm">{new Date(billing.data.nextPaymentDate * 1000).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── REVIEWS ── */}
      {tab === "reviews" && (
        <div className="space-y-4">
          {/* Stats */}
          {reviewStats.data && (
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-4xl font-extrabold text-slate-900 dark:text-white">{reviewStats.data.avg || "—"}</p>
                  <div className="flex gap-0.5 mt-1 justify-center">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className={`w-4 h-4 ${s <= Math.round(reviewStats.data!.avg) ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{reviewStats.data.count} reviews</p>
                </div>
                <div className="flex-1 space-y-1">
                  {[5,4,3,2,1].map(n => {
                    const count = reviewStats.data!.distribution[n] ?? 0;
                    const pct = reviewStats.data!.count > 0 ? (count / reviewStats.data!.count) * 100 : 0;
                    return (
                      <div key={n} className="flex items-center gap-2 text-xs">
                        <span className="w-3 text-slate-500 dark:text-slate-400">{n}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-6 text-right text-slate-400">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Review list */}
          {reviewList.isLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-2xl h-24 animate-pulse" />)}</div>
          ) : (reviewList.data?.reviews ?? []).length === 0 ? (
            <div className="glass-card rounded-2xl py-12 text-center">
              <Star className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No reviews yet</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {(reviewList.data?.reviews ?? []).map((rev: any) => (
                <ReviewCard key={rev.id} rev={rev} tenantId={tenantId} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ANALYTICS ── */}
      {tab === "analytics" && (
        <AnalyticsTab
          tenantId={tenantId}
          botUsername={botStatus.data?.botUsername ?? null}
          slug={profile.data?.slug ?? null}
        />
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
          {profile.isLoading ? <Loader2 className="animate-spin text-brand-400 mx-auto" /> : profile.isError ? (
            <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>
          ) : (
            <SalonSettingsEditor tenantId={tenantId} profile={profile.data} />
          )}
          <AutoConfirmSettings tenantId={tenantId} />
          <SalonCalendarSection tenantId={tenantId} />
        </>
      )}

      {/* Modals */}
      {svcModal.open && <ServiceModal svc={svcModal.svc} onClose={() => setSvcModal({ open: false, svc: null })} tenantId={tenantId} />}
      {masterModal && <AddMasterModal onClose={() => setMasterModal(false)} tenantId={tenantId} />}
    </Shell>
  );
}
