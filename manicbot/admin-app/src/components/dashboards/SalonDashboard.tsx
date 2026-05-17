"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  Settings, ChevronLeft, ChevronRight, AlertCircle,
  Loader2, Plus, Pencil, Trash2, Save, X,
  Eye, EyeOff, Globe, ExternalLink, MapPin, ToggleLeft, ToggleRight,
  Star, MessageSquare, Reply, Camera, Tag, ImageIcon, Copy,
  Palette, Phone, Instagram as InstagramIcon, Clock,
} from "lucide-react";
import { resizeImageClientSide, validateUploadFile, uploadAssetFile } from "~/lib/uploadAsset";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { SalonAgendaView } from "~/components/dashboards/SalonAgendaView";
import { SalonDayView } from "~/components/dashboards/SalonDayView";
import { SalonWeekView } from "~/components/dashboards/SalonWeekView";
import { MonthCalendar } from "~/components/calendar/MonthCalendar";
import { QuickAddFab, type FabExtraItem } from "~/components/dashboards/QuickAddFab";
import { ReminderModal } from "~/components/plugins/reminders/ReminderModal";
import { Bell, Repeat } from "lucide-react";
import { CalendarLeftRail } from "~/components/dashboards/CalendarLeftRail";
import { CalendarViewSwitcher, type CalendarViewMode, normalizeViewMode } from "~/components/dashboards/CalendarViewSwitcher";
import { useMasterVisibility } from "~/lib/useMasterVisibility";
import { useInWebShell } from "~/components/layout/WebShell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";
import {
  applyPendingStatusChanges as mergeStatusPatches,
  buildCancelPatch,
  buildStatusChangePatch,
  buildNoShowPatch,
  type PendingStatusPatches,
} from "~/lib/optimisticStatusMerge";
import { AptCard, SectionHeader, Btn, Input } from "~/components/salon/SalonShared";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";
import { SalonChannelsTab } from "~/components/salon/SalonChannelsTab";
import { AssetUploadField } from "~/components/salon/AssetUploadField";
import { AnalyticsTab } from "~/components/salon/AnalyticsTab";
import { ClientsTab } from "~/components/salon/tabs/ClientsTab";
import { ClientFormModal } from "~/components/salon/tabs/clients/ClientFormModal";
import { StaffTab } from "~/components/salon/tabs/StaffTab";
import { SERVICE_TEMPLATES, type ServiceTemplate } from "~/lib/serviceTemplates";
import { AddServiceDropdown, ServiceTemplatesSheet } from "~/components/salon/ServiceAddMenu";
import { ManualBookingModal } from "~/components/dashboard/ManualBookingModal";
import { TimeReservationDialog } from "~/components/dashboard/TimeReservationDialog";
import { TimeOffDialog } from "~/components/dashboard/TimeOffDialog";
import { OnboardingChecklist } from "~/components/dashboard/OnboardingChecklist";
import { ReferralOverviewTeaser } from "~/components/dashboard/ReferralOverviewTeaser";
import { PromoCodesTab } from "~/components/dashboard/PromoCodesTab";
import { TestBadge } from "~/components/ui/TestBadge";
import { EmptyState } from "~/components/ui/EmptyState";
import { Switch } from "~/components/ui/Switch";
import { useRole } from "~/components/RoleContext";
import type { PermissionKey } from "~/server/api/permissions";
import { NAIL_EMOJIS } from "~/lib/appointments";
import {
  WEEKDAY_KEYS,
  DEFAULT_WORK_HOURS,
  hydrateWorkHours,
  serializeWorkHours,
  decodePerDayWorkHours,
  type WorkHoursState,
} from "~/lib/workHours";
import type { MoveCommit } from "~/lib/calendar/useDragToMove";
import { toast } from "~/lib/toast";
import { AddMasterFab, type AddMasterPick } from "~/components/salon/AddMasterFab";
import { InviteByEmailModal } from "~/components/salon/InviteByEmailModal";

type Tab = "overview" | "appointments" | "masters" | "services" | "clients" | "channels" | "reviews" | "settings" | "public_profile" | "analytics" | "promo_codes" | "staff";

// ─── Service Edit Modal ──────────────────────────────────────────
const PROMO_PRESETS = ["-10%", "-15%", "-20%", "Хит", "Новинка", "Скидка"];

function ServiceModal({ svc, onClose, tenantId, initialData }: { svc: any | null; onClose: () => void; tenantId: string; initialData?: ServiceTemplate }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [name, setName] = useState(() => {
    if (!svc) return (initialData ? (initialData.names[lang] ?? initialData.names.en) : "");
    let names: Record<string, string> = {};
    try { names = svc.names ? JSON.parse(svc.names) : {}; } catch { /* ignore malformed JSON */ }
    return names.ru ?? names.en ?? svc.svcId ?? "";
  });
  const [price, setPrice] = useState(String(svc?.price ?? initialData?.price ?? ""));
  const [duration, setDuration] = useState(String(svc?.duration ?? initialData?.duration ?? "60"));
  const [emoji, setEmoji] = useState(svc?.emoji ?? initialData?.emoji ?? "💅");
  const [active, setActive] = useState(svc?.active !== 0);
  const [description, setDescription] = useState(svc?.description ?? "");
  const [promo, setPromo] = useState(svc?.promo ?? "");
  const [photos, setPhotos] = useState<string[]>(() => {
    try { return JSON.parse(svc?.photos ?? "[]"); } catch { return []; }
  });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mintToken = api.salon.mintUploadToken.useMutation();
  const updateSvc = api.salon.updateService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); onClose(); },
  });
  const createSvc = api.salon.createService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); void utils.onboarding.getStatus.invalidate({ tenantId }); onClose(); },
  });

  const isNew = !svc;
  const isBusy = updateSvc.isPending || createSvc.isPending || uploading;

  async function handlePhotoFile(file: File) {
    if (photos.length >= 5) return;
    const err = validateUploadFile(file);
    if (err) { setPhotoError(err); return; }
    setPhotoError("");
    setUploading(true);
    try {
      const compressed = await resizeImageClientSide(file, 1200, "image/webp", 0.82);
      const { uploadUrl } = await mintToken.mutateAsync({ tenantId, kind: "service_photo" });
      const result = await uploadAssetFile(uploadUrl, compressed);
      setPhotos(prev => [...prev, result.url].slice(0, 5));
    } catch (e) {
      console.error("Photo upload failed:", e);
      setPhotoError(t("master.photoUploadError", lang));
    } finally {
      setUploading(false);
    }
  }

  function handleSave() {
    const namesJson = JSON.stringify({ ru: name, en: name, ua: name, pl: name });
    const activeNum = active ? 1 : 0;
    const priceNum = parseFloat(price) || 0;
    const durationNum = parseInt(duration, 10) || 60;
    const photosJson = photos.length > 0 ? JSON.stringify(photos) : undefined;
    const promoVal = promo.trim() || undefined;
    if (isNew) {
      createSvc.mutate({ tenantId, names: namesJson, price: priceNum, duration: durationNum, emoji, active: activeNum, description: description || undefined, photos: photosJson, promo: promoVal });
    } else {
      updateSvc.mutate({ tenantId, svcId: svc.svcId, names: namesJson, price: priceNum, duration: durationNum, emoji, active: activeNum, description: description || undefined, photos: photosJson, promo: promoVal });
    }
  }

  return (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-y-auto max-h-[92dvh]"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 dark:border-white/5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {isNew ? t("action.create", lang) : t("action.edit", lang)}
          </h3>
          <button onClick={onClose} className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Emoji + Name */}
          <div className="flex items-start gap-3">
            <div className="relative">
              <button
                onClick={() => setShowEmojiPicker(p => !p)}
                className="w-14 h-14 text-3xl rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500">
                {emoji}
              </button>
              {showEmojiPicker && (
                <div className="absolute top-16 left-0 z-10 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-2">
                  <div className="grid grid-cols-5 gap-1">
                    {NAIL_EMOJIS.map(e => (
                      <button key={e} onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                        className={`text-xl h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10 transition-colors ${e === emoji ? "bg-brand-500/15 ring-1 ring-brand-500/40" : ""}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1">
              <Input label={t("service.name", lang)} value={name} onChange={setName} placeholder="Маникюр" />
            </div>
          </div>

          {/* Price + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <Input label={t("service.price", lang)} value={price} onChange={setPrice} type="number" placeholder="500" />
            <Input label={t("service.duration", lang)} value={duration} onChange={setDuration} type="number" placeholder="60" />
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{t("common.description", lang)}</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={2} placeholder={t("master.svcDescriptionPlaceholder", lang)}
              className="w-full resize-none bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
          </div>

          {/* Promo */}
          <div>
            <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1.5 flex items-center gap-1.5 block">
              <Tag className="h-3 w-3" /> {t("master.promoSticker", lang)}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PROMO_PRESETS.map(p => (
                <button key={p} onClick={() => setPromo((prev: string) => prev === p ? "" : p)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    promo === p
                      ? "bg-red-500 text-white border-red-500"
                      : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-red-400 hover:text-red-500"
                  }`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={promo} onChange={e => setPromo(e.target.value)} maxLength={12}
                placeholder={t("master.svcPromoPlaceholder", lang)}
                className="flex-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
              {promo && (
                <span className="shrink-0 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
                  {promo}
                </span>
              )}
            </div>
          </div>

          {/* Photos */}
          <div>
            <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5 block">
              <Camera className="h-3 w-3" /> {t("master.servicePhotos", lang)}
            </label>
            <div className="flex gap-2 flex-wrap">
              {photos.map((url, i) => (
                <div key={url} className="relative h-16 w-16 rounded-xl overflow-hidden group border border-slate-200 dark:border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-16 w-16 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-brand-500 hover:text-brand-400 transition-colors disabled:opacity-50">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  {!uploading && <span className="text-[9px]">{t("common.add", lang)}</span>}
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { void handlePhotoFile(f); } e.target.value = ""; }} />
            {photoError && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{photoError}</p>
              </div>
            )}
          </div>

          {/* Active toggle */}
          <button onClick={() => setActive(!active)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
              active ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-white/10"
            }`}>
            {active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {active ? t("service.active", lang) : t("service.hidden", lang)}
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <Btn onClick={handleSave} disabled={isBusy} className="w-full justify-center py-2.5">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("common.save", lang)}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Create Master Account Modal ─────────────────────────────────
function CreateMasterAccountModal({ onClose, tenantId }: { onClose: () => void; tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState<{ login: string; password: string } | null>(null);
  const [copiedLogin, setCopiedLogin] = useState(false);
  const [copiedPw, setCopiedPw] = useState(false);

  const createAccount = api.salon.createMasterAccount.useMutation({
    onSuccess: (data) => {
      void utils.salon.getMasters.invalidate();
      setCredentials({ login: data.login, password: data.password });
      setStep(2);
    },
  });

  function copy(text: string, which: "login" | "pw") {
    void navigator.clipboard.writeText(text);
    if (which === "login") { setCopiedLogin(true); setTimeout(() => setCopiedLogin(false), 2000); }
    else { setCopiedPw(true); setTimeout(() => setCopiedPw(false), 2000); }
  }

  return (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose} onKeyDown={e => e.key === "Escape" && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("master.createAccountTitle", lang)}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 1 && (
          <>
            <Input label={t("master.name", lang)} value={name} onChange={setName} placeholder="Анна" />
            <Input label={t("master.masterEmail", lang)} value={email} onChange={setEmail} placeholder="anna@example.com" type="email" />
            {createAccount.error && (
              <p className="text-red-400 text-xs rounded-lg bg-red-500/10 px-3 py-2">{createAccount.error.message}</p>
            )}
            <Btn
              onClick={() => createAccount.mutate({ tenantId, name: name.trim(), email: email.trim() || undefined })}
              disabled={!name.trim() || createAccount.isPending}
              className="w-full justify-center py-2.5">
              {createAccount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("master.createAccount", lang)}
            </Btn>
          </>
        )}

        {step === 2 && credentials && (
          <>
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
              {t("master.saveWarning", lang)}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">{t("master.loginLabel", lang)}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 bg-slate-100 dark:bg-white/5 rounded-lg px-3 py-2 text-sm font-mono text-slate-900 dark:text-white break-all">{credentials.login}</code>
                  <button
                    onClick={() => copy(credentials.login, "login")}
                    className="shrink-0 h-9 w-9 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 hover:text-brand-400 transition-colors">
                    {copiedLogin ? <span className="text-[10px] text-emerald-400 font-bold">✓</span> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">{t("master.passwordLabel", lang)}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 bg-slate-100 dark:bg-white/5 rounded-lg px-3 py-2 text-sm font-mono text-slate-900 dark:text-white break-all">{credentials.password}</code>
                  <button
                    onClick={() => copy(credentials.password, "pw")}
                    className="shrink-0 h-9 w-9 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 hover:text-brand-400 transition-colors">
                    {copiedPw ? <span className="text-[10px] text-emerald-400 font-bold">✓</span> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <Btn onClick={onClose} className="w-full justify-center py-2.5">
              {t("master.done", lang)}
            </Btn>
          </>
        )}
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
    onSuccess: () => { utils.salon.getMasters.invalidate(); void utils.onboarding.getStatus.invalidate({ tenantId }); onClose(); },
  });

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
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
                <p className="text-xs text-slate-500">{t("salon.branding.displayName", lang)}</p>
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
                  <p className="text-xs text-slate-500 mb-1">{t("salon.branding.logo", lang)}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.logo} alt="logo" className="h-14 w-14 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                </div>
              )}
              {profile.coverPhoto && (
                <div className="flex-1">
                  <p className="text-xs text-slate-500 mb-1">{t("salon.branding.cover", lang)}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.coverPhoto} alt="cover" className="h-14 w-full rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                </div>
              )}
              {profile.brandPalette?.primary && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">{t("salon.branding.brandColor", lang)}</p>
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
          label={t("salon.branding.displayNameOptional", lang)}
          value={displayName}
          onChange={setDisplayName}
          placeholder={t("salon.branding.displayNameHint", lang)}
        />
        <Input label={t("salon.address", lang)} value={address} onChange={setAddress} />
        <Input label={t("salon.phone", lang)} value={phone} onChange={setPhone} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("salon.workHoursFrom", lang)} value={hoursFrom} onChange={setHoursFrom} type="number" />
          <Input label={t("salon.workHoursTo", lang)} value={hoursTo} onChange={setHoursTo} type="number" />
        </div>
        <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
          <AssetUploadField
            label={t("salon.branding.logo", lang)}
            tenantId={tenantId}
            kind="logo"
            value={logo}
            onChange={({ url, key }) => {
              setLogo(url);
              setLogoR2Key(key);
            }}
            preview="square"
            hint={t("salon.branding.logoHint", lang)}
          />
          <AssetUploadField
            label={t("salon.branding.cover", lang)}
            tenantId={tenantId}
            kind="cover"
            value={coverPhoto}
            onChange={({ url, key }) => {
              setCoverPhoto(url);
              setCoverR2Key(key);
            }}
            preview="cover"
            hint={t("salon.branding.coverHint", lang)}
          />
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.branding.brandColor", lang)}</label>
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
    { key: "web",       label: t("salon.channels.web.label", lang),       hint: t("salon.channels.web.hint", lang) },
    { key: "telegram",  label: "Telegram",                                  hint: t("salon.channels.telegram.hint", lang) },
    { key: "whatsapp",  label: "WhatsApp",                                  hint: t("salon.channels.whatsapp.hint", lang) },
    { key: "instagram", label: t("salon.channels.instagram.label", lang),  hint: t("salon.channels.instagram.hint", lang) },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader title={t("salon.autoConfirm.title", lang)} />
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("salon.autoConfirm.body", lang)}
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
function parseGoogleMapsUrl(input: string): { lat: number; lng: number } | null {
  const validate = (lat: number, lng: number) =>
    isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      ? { lat, lng } : null;
  // @lat,lng pattern (e.g. /place/.../@55.7558,37.6173,17z/)
  const atMatch = input.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) return validate(parseFloat(atMatch[1]!), parseFloat(atMatch[2]!));
  // ?q=lat,lng or ?ll=lat,lng
  try {
    const url = new URL(input);
    for (const key of ["q", "ll", "query"]) {
      const v = url.searchParams.get(key);
      const m = v?.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (m) return validate(parseFloat(m[1]!), parseFloat(m[2]!));
    }
  } catch { /* not a URL */ }
  // Bare coordinate pair: "55.7558, 37.6173"
  const bare = input.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (bare) return validate(parseFloat(bare[1]!), parseFloat(bare[2]!));
  return null;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function PublicProfileEditor({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const profile = api.salon.getSalonProfile.useQuery({ tenantId });
  const servicesList = api.salon.getServices.useQuery({ tenantId });
  const [publishError, setPublishError] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [slugError, setSlugError] = useState("");
  const [slugChecked, setSlugChecked] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  // Branding section
  const [logo, setLogo] = useState("");
  const [coverPhoto, setCoverPhoto] = useState("");
  const [brandPrimary, setBrandPrimary] = useState("");
  const [brandBg, setBrandBg] = useState("");
  const [brandText, setBrandText] = useState("");
  // Contacts section
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  // Schedule section
  const [workHours, setWorkHours] = useState<WorkHoursState>(DEFAULT_WORK_HOURS);
  // Field-level validation errors (key → message)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const data = profile.data as any;

  useEffect(() => {
    if (data && !editing) {
      setSlug(data.slug ?? "");
      setDescription(data.description ?? "");
      setCity(data.city ?? "");
      if (data.mapsUrl) {
        setMapsUrl(data.mapsUrl);
        setParsedCoords(parseGoogleMapsUrl(data.mapsUrl));
      } else if (data.lat != null && data.lng != null) {
        setMapsUrl(`${data.lat}, ${data.lng}`);
        setParsedCoords({ lat: data.lat, lng: data.lng });
      } else {
        setMapsUrl("");
        setParsedCoords(null);
      }
      setIsPublic(!!data.publicActive);
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
      // Branding
      setLogo(data.logo ?? "");
      setCoverPhoto(data.coverPhoto ?? "");
      setBrandPrimary(data.brandPalette?.primary ?? "");
      setBrandBg(data.brandPalette?.bg ?? "");
      setBrandText(data.brandPalette?.text ?? "");
      // Contacts
      setAddress(data.salon?.address ?? "");
      setPhone(data.salon?.phone ?? "");
      setInstagramUrl(data.instagramUrl ?? "");
      // Schedule
      setWorkHours(hydrateWorkHours(data.salon?.workHours));
      setFieldErrors({});
    }
  }, [data, editing]);

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      setEditing(false);
      setPublishError(null);
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.startsWith("NOT_READY_TO_PUBLISH:")) {
        setPublishError(msg.replace("NOT_READY_TO_PUBLISH:", "").split(","));
        setIsPublic(false);
      }
    },
  });

  const readinessMissing: string[] = [];
  if (!data?.slug) readinessMissing.push("slug");
  if (!data?.name || !String(data.name).trim()) readinessMissing.push("name");
  if (servicesList.data && servicesList.data.length === 0) readinessMissing.push("services");
  const isReadyToPublish = readinessMissing.length === 0;

  const MISSING_LABELS: Record<string, string> = {
    slug: t("salon.publicProfile.slugReq", lang),
    name: t("salon.publicProfile.nameReq", lang),
    services: t("salon.publicProfile.servicesReq", lang),
  };

  const slugCheck = api.salon.checkSlugAvailable.useQuery(
    { slug, tenantId },
    { enabled: editing && slug.length > 0 && !slugError, staleTime: 5000 },
  );

  function validateSlug(v: string) {
    if (v && !/^[a-z0-9-]+$/.test(v)) {
      setSlugError(t("salon.publicProfile.slugError", lang));
      setSlugChecked(null);
      return false;
    }
    setSlugError("");
    return true;
  }

  function validateExtras(): Record<string, string> {
    const errs: Record<string, string> = {};
    // Mirror the server regexes in `salon.updateSalonProfile` — keep client +
    // server in lockstep so the form blocks before round-trip and bad payloads
    // can't slip past a customised client either.
    if (logo && !/^https:\/\//i.test(logo)) errs.logo = t("salon.publicProfile.urlHttpsError", lang);
    if (coverPhoto && !/^https:\/\//i.test(coverPhoto)) errs.coverPhoto = t("salon.publicProfile.urlHttpsError", lang);
    if (brandPrimary && !HEX_RE.test(brandPrimary)) errs.brandPrimary = t("salon.publicProfile.hexError", lang);
    if (brandBg && !HEX_RE.test(brandBg)) errs.brandBg = t("salon.publicProfile.hexError", lang);
    if (brandText && !HEX_RE.test(brandText)) errs.brandText = t("salon.publicProfile.hexError", lang);
    if (instagramUrl && !/^https:\/\/(www\.)?instagram\.com\//i.test(instagramUrl)) {
      errs.instagramUrl = t("salon.publicProfile.instagramError", lang);
    }
    return errs;
  }

  function handleSave() {
    if (!validateSlug(slug)) return;
    const extras = validateExtras();
    if (Object.keys(extras).length) {
      setFieldErrors(extras);
      return;
    }
    setFieldErrors({});
    // Client-side pre-check: if trying to enable publishing without a ready
    // profile, surface the red banner without round-tripping to the server.
    if (isPublic) {
      const missing: string[] = [];
      if (!slug) missing.push("slug");
      if (!data?.name || !String(data.name).trim()) missing.push("name");
      if (servicesList.data && servicesList.data.length === 0) missing.push("services");
      if (missing.length) {
        setPublishError(missing);
        setIsPublic(false);
        return;
      }
    }
    setPublishError(null);

    // Brand palette: required `primary` per server schema, so only send a
    // palette object when primary is present. Otherwise emit `null` to clear.
    let brandPalette: { primary: string; bg?: string; text?: string } | null | undefined;
    if (brandPrimary) {
      brandPalette = { primary: brandPrimary };
      if (brandBg) brandPalette.bg = brandBg;
      if (brandText) brandPalette.text = brandText;
    } else if (brandBg || brandText) {
      // Partial palette without primary — drop silently rather than error.
      brandPalette = undefined;
    } else {
      brandPalette = null;
    }

    update.mutate({
      tenantId,
      slug: slug || undefined,
      description: description || undefined,
      city: city || undefined,
      lat: parsedCoords?.lat,
      lng: parsedCoords?.lng,
      mapsUrl: mapsUrl.startsWith("http") ? mapsUrl : undefined,
      publicActive: isPublic ? 1 : 0,
      photos,
      // Branding
      logo: logo || "",
      coverPhoto: coverPhoto || "",
      brandPalette,
      // Contacts (stored under tenants.salon JSON + tenant_config)
      address: address || "",
      phone: phone || "",
      instagramUrl: instagramUrl || "",
      // Schedule (per-day JSON string under tenants.salon.workHours +
      // tenant_config.work_hours).
      workHours: serializeWorkHours(workHours),
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
  if (profile.isError) return <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("salon.publicProfile.title", lang)}
        action={editing
          ? <Btn variant="ghost" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" />{t("common.cancel", lang)}</Btn>
          : <Btn onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />{t("common.edit", lang)}</Btn>
        }
      />

      {/* Status banner */}
      <div className={`rounded-xl p-4 flex items-center gap-3 ${isPublic ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"}`}>
        {isPublic
          ? <ToggleRight className="h-6 w-6 text-emerald-400 shrink-0" />
          : <ToggleLeft className="h-6 w-6 text-slate-500 shrink-0" />}
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isPublic ? "text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}>
            {isPublic ? t("salon.publicProfile.visibleInCatalog", lang) : t("salon.publicProfile.hiddenFromCatalog", lang)}
          </p>
          {publicUrl && (
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
            if (newVal === 1 && !isReadyToPublish) {
              setPublishError(readinessMissing);
              return;
            }
            setPublishError(null);
            setIsPublic(!!newVal);
            update.mutate({ tenantId, publicActive: newVal });
          }}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${isPublic ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"}`}>
            {isPublic ? t("salon.publicProfile.hide", lang) : t("salon.publicProfile.publish", lang)}
          </button>
        )}
      </div>

      {publishError && publishError.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                {t("salon.publicProfile.cantPublish", lang)}
              </p>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-red-700/90 dark:text-red-300/90">
                {publishError.map((k) => (
                  <li key={k}>{MISSING_LABELS[k] ?? k}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-500/30 dark:text-red-200"
                >
                  {t("salon.publicProfile.editProfile", lang)}
                </button>
                <button
                  onClick={() => setPublishError(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-700/70 transition hover:text-red-700 dark:text-red-300/70 dark:hover:text-red-300"
                >
                  {t("common.close", lang)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!editing ? (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          {[
            { label: "URL (slug)", value: data?.slug, icon: Globe },
            { label: t("salon.publicProfile.city", lang), value: data?.city, icon: MapPin },
            { label: t("common.description", lang), value: data?.description, icon: null },
            { label: t("salon.publicProfile.coords", lang), value: (data?.lat && data?.lng) ? `${data.lat}, ${data.lng}` : null, icon: null },
            { label: t("salon.publicProfile.address", lang), value: data?.salon?.address, icon: MapPin },
            { label: t("salon.publicProfile.phone", lang), value: data?.salon?.phone, icon: Phone },
          ].map(({ label, value, icon: Icon }) => value ? (
            <div key={label} className="flex items-start gap-3">
              {Icon ? <Icon className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" /> : <div className="w-4 shrink-0" />}
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm text-slate-900 dark:text-white">{value}</p>
              </div>
            </div>
          ) : null)}
          {data?.instagramUrl && (
            <div className="flex items-start gap-3">
              <InstagramIcon className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">{t("salon.publicProfile.instagramUrl", lang)}</p>
                <a href={data.instagramUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-brand-400 hover:underline break-all">
                  {data.instagramUrl}
                </a>
              </div>
            </div>
          )}
          {(data?.logo || data?.coverPhoto) && (
            <div className="flex gap-3 border-t border-slate-200 dark:border-white/5 pt-3">
              {data.logo && <img src={data.logo} alt="logo" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
              {data.coverPhoto && <img src={data.coverPhoto} alt="cover" className="h-12 flex-1 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
            </div>
          )}
          {/* Brand palette swatches */}
          {(data?.brandPalette?.primary || data?.brandPalette?.bg || data?.brandPalette?.text) && (
            <div className="flex items-center gap-2 border-t border-slate-200 dark:border-white/5 pt-3">
              <Palette className="h-4 w-4 text-slate-500 shrink-0" />
              <p className="text-xs text-slate-500 mr-1">{t("salon.publicProfile.brandingSection", lang)}:</p>
              {(["primary", "bg", "text"] as const).map((k) => {
                const c = data.brandPalette?.[k];
                if (!c) return null;
                return (
                  <span key={k} className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                    <span className="h-4 w-4 rounded border border-slate-200 dark:border-slate-700 shadow-sm shrink-0" style={{ backgroundColor: c }} aria-label={`${k} ${c}`} />
                    {c}
                  </span>
                );
              })}
            </div>
          )}
          {/* Work hours summary — only rendered when the value is parsable
              (per-day JSON, legacy short string, or legacy {from,to}). */}
          {data?.salon?.workHours && (() => {
            const wh = data.salon.workHours as unknown;
            const perDay = typeof wh === "string" ? decodePerDayWorkHours(wh) : null;
            const dayLabels = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
            let legacyLine: string | null = null;
            if (!perDay) {
              if (typeof wh === "string" && wh.trim()) legacyLine = wh;
              else if (wh && typeof wh === "object") {
                const obj = wh as { from?: number | string; to?: number | string };
                if (obj.from !== undefined && obj.to !== undefined) {
                  const fmt = (v: number | string) => typeof v === "string" ? v : `${v}:00`;
                  legacyLine = `${fmt(obj.from)} – ${fmt(obj.to)}`;
                }
              }
            }
            if (!perDay && !legacyLine) return null;
            return (
              <div className="border-t border-slate-200 dark:border-white/5 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-slate-500" />
                  <p className="text-xs text-slate-500">{t("salon.publicProfile.scheduleSection", lang)}</p>
                </div>
                {perDay ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pl-6">
                    {dayLabels.map((d, i) => {
                      const slot = perDay[i];
                      return (
                        <div key={d} className="flex justify-between">
                          <span className="text-slate-500">{t(`salon.publicProfile.day.${d}`, lang)}</span>
                          <span className={slot ? "text-slate-900 dark:text-white font-medium" : "text-slate-400"}>
                            {slot ? `${slot.open}–${slot.close}` : t("salon.publicProfile.dayOff", lang)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-900 dark:text-white pl-6">{legacyLine}</p>
                )}
              </div>
            );
          })()}
          {photos.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">{t("salon.publicProfile.gallerySimple", lang)} ({photos.length})</p>
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
              {t("salon.publicProfile.setSlugFirst", lang)}
            </p>
          )}
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t("salon.publicProfile.showInCatalog", lang)}</p>
              <p className="text-xs text-slate-500">{t("salon.publicProfile.findInSearch", lang)}</p>
            </div>
            <Switch
              checked={isPublic}
              onChange={setIsPublic}
              aria-label={t("salon.publicProfile.showInCatalog", lang)}
              data-testid="public-profile-visibility-toggle"
            />
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">URL slug</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-500 shrink-0">manicbot.com/salon/</span>
                <input value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase()); validateSlug(e.target.value.toLowerCase()); }}
                  placeholder="moj-salon-warszawa"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                {slug && !slugError && (
                  <span className={`shrink-0 text-xs font-medium ${slugCheck.data?.available === false ? "text-red-400" : slugCheck.data?.available ? "text-emerald-400" : "text-slate-500"}`}>
                    {slugCheck.isLoading ? "..." : slugCheck.data?.available === false ? `❌ ${t("salon.publicProfile.taken", lang)}` : slugCheck.data?.available ? "✅" : ""}
                  </span>
                )}
              </div>
              {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.city", lang)}</label>
              <input value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Warszawa"
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("common.description", lang)}</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} placeholder={t("salon.publicProfile.descriptionPlaceholder", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.mapsLabel", lang)}</label>
              <input value={mapsUrl} onChange={(e) => { setMapsUrl(e.target.value); setParsedCoords(parseGoogleMapsUrl(e.target.value)); }}
                placeholder={t("salon.publicProfile.mapsPlaceholder", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
              {mapsUrl && parsedCoords && (
                <p className="text-xs text-emerald-500 mt-1">{t("salon.publicProfile.coords", lang)}: {parsedCoords.lat}, {parsedCoords.lng}</p>
              )}
              {mapsUrl && !parsedCoords && (
                <p className="text-xs text-amber-400 mt-1">{t("salon.publicProfile.coordsBad", lang)}</p>
              )}
            </div>

            {/* Branding section: logo / cover / brand palette */}
            <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t("salon.publicProfile.brandingSection", lang)}</h4>
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.logoUrl", lang)}</label>
                <input value={logo} onChange={(e) => setLogo(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                {fieldErrors.logo && <p className="text-xs text-red-400 mt-1">{fieldErrors.logo}</p>}
                {logo && /^https:\/\//.test(logo) && (
                  <img src={logo} alt="logo preview" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 mt-2" />
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.coverUrl", lang)}</label>
                <input value={coverPhoto} onChange={(e) => setCoverPhoto(e.target.value)}
                  placeholder="https://example.com/cover.jpg"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                {fieldErrors.coverPhoto && <p className="text-xs text-red-400 mt-1">{fieldErrors.coverPhoto}</p>}
                {coverPhoto && /^https:\/\//.test(coverPhoto) && (
                  <img src={coverPhoto} alt="cover preview" className="h-16 w-full rounded-lg object-cover border border-slate-200 dark:border-slate-700 mt-2" />
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "brandPrimary", label: t("salon.publicProfile.brandPrimary", lang), value: brandPrimary, setter: setBrandPrimary },
                  { key: "brandBg", label: t("salon.publicProfile.brandBg", lang), value: brandBg, setter: setBrandBg },
                  { key: "brandText", label: t("salon.publicProfile.brandText", lang), value: brandText, setter: setBrandText },
                ].map(({ key, label, value, setter }) => (
                  <div key={key}>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">{label}</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="color"
                        value={HEX_RE.test(value) ? value : "#000000"}
                        onChange={(e) => setter(e.target.value)}
                        aria-label={label}
                        className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent cursor-pointer"
                      />
                      <input
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        placeholder="#000000"
                        className="flex-1 min-w-0 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-2 text-xs font-mono text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
                      />
                    </div>
                    {fieldErrors[key] && <p className="text-[10px] text-red-400 mt-1">{fieldErrors[key]}</p>}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">{t("salon.publicProfile.hexHint", lang)}</p>
            </div>

            {/* Contacts section: address / phone / instagram */}
            <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t("salon.publicProfile.contactsSection", lang)}</h4>
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.address", lang)}</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder="ul. Marszałkowska 1, Warszawa"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.phone", lang)}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="+48 600 000 000"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                  <InstagramIcon className="h-3.5 w-3.5 text-pink-400" />
                  {t("salon.publicProfile.instagramUrl", lang)}
                </label>
                <input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)}
                  placeholder="https://instagram.com/your_salon"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                {fieldErrors.instagramUrl && <p className="text-xs text-red-400 mt-1">{fieldErrors.instagramUrl}</p>}
                <p className="text-[10px] text-slate-500 mt-1">{t("salon.publicProfile.instagramHint", lang)}</p>
              </div>
            </div>

            {/* Schedule section: per-day work hours */}
            <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t("salon.publicProfile.scheduleSection", lang)}</h4>
              </div>
              <p className="text-[11px] text-slate-500">{t("salon.publicProfile.scheduleHint", lang)}</p>
              <div className="space-y-2">
                {WEEKDAY_KEYS.map((day) => {
                  const value = workHours[day];
                  const isOff = value === null;
                  return (
                    <div key={day} data-testid={`workhours-row-${day}`} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-slate-700 dark:text-slate-300">{t(`salon.publicProfile.day.${day}`, lang)}</span>
                      <Switch
                        size="sm"
                        checked={!isOff}
                        onChange={(next) => setWorkHours((prev) => ({
                          ...prev,
                          [day]: next ? { open: "09:00", close: "18:00" } : null,
                        }))}
                        aria-label={t("salon.publicProfile.workingDay", lang)}
                        data-testid={`workhours-toggle-${day}`}
                      />
                      {isOff ? (
                        <span className="flex-1 text-xs text-slate-500 italic">{t("salon.publicProfile.dayOff", lang)}</span>
                      ) : (
                        <>
                          <input
                            type="time"
                            aria-label={`${t(`salon.publicProfile.day.${day}`, lang)} ${t("salon.publicProfile.opens", lang)}`}
                            value={value.open}
                            onChange={(e) => setWorkHours((prev) => ({ ...prev, [day]: { ...value, open: e.target.value } }))}
                            className="flex-1 min-w-0 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
                          />
                          <span className="text-xs text-slate-500">—</span>
                          <input
                            type="time"
                            aria-label={`${t(`salon.publicProfile.day.${day}`, lang)} ${t("salon.publicProfile.closes", lang)}`}
                            value={value.close}
                            onChange={(e) => setWorkHours((prev) => ({ ...prev, [day]: { ...value, close: e.target.value } }))}
                            className="flex-1 min-w-0 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Photos */}
            <div className="border-t border-slate-200 dark:border-white/5 pt-3">
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-2 block">{t("salon.publicProfile.gallery", lang)} ({photos.length})</label>
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
                  {t("common.add", lang)}
                </button>
              </div>
            </div>
          </div>

          <Btn onClick={handleSave} disabled={update.isPending || !!slugError || slugCheck.data?.available === false} className="w-full justify-center py-2.5">
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("salon.publicProfile.savePublic", lang)}
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

// ─── Salon BigCalendar — thin wrapper around shared MonthCalendar ──────────
function SalonBigCalendar({
  apts,
  masters,
  viewDate,
  setViewDate,
  selectedDay,
  setSelectedDay,
  isLoading,
  lang,
  onAction,
  onNoShow,
  serviceNames,
}: {
  apts: any[];
  masters?: Array<{ chatId: number; name: string | null }>;
  viewDate: Date;
  setViewDate: (d: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (iso: string | null) => void;
  isLoading: boolean;
  lang: Lang;
  onAction: (id: number, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow: (id: number, noShowBy: "client" | "master") => void;
  serviceNames?: Record<string, string>;
}) {
  const dayMap = useMemo(() => {
    const m: Record<string, any[]> = {};
    apts.forEach((a) => { (m[a.date] ??= []).push(a); });
    return m;
  }, [apts]);
  const selectedDayApts = selectedDay ? dayMap[selectedDay] ?? [] : [];

  return (
    <div className="space-y-3">
      <MonthCalendar
        apts={apts}
        masters={masters}
        viewDate={viewDate}
        setViewDate={setViewDate}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        isLoading={isLoading}
        lang={lang}
      />

      {selectedDay && (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
              {new Date(selectedDay + "T12:00:00").toLocaleDateString(
                lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU",
                { weekday: "long", day: "numeric", month: "long" },
              )}
              {selectedDayApts.length > 0 && (
                <span className="ml-2 text-slate-400 dark:text-slate-500 font-medium">· {selectedDayApts.length}</span>
              )}
            </h3>
            <button
              onClick={() => setSelectedDay(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {selectedDayApts.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-4">{t("salon.noApts", lang)}</p>
          )}
          <div className="space-y-2">
            {selectedDayApts.map((a: any) => (
              <AptCard key={a.id} a={a} lang={lang} onAction={onAction} onNoShow={onNoShow} />
            ))}
          </div>
        </div>
      )}
      {/* serviceNames reserved for future row enrichment */}
      {!serviceNames && null}
    </div>
  );
}


export function SalonDashboard({ tenantId, forceTab }: { tenantId: string; forceTab?: Tab }) {
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const inWeb = useInWebShell();
  const { prefs: dashPrefs } = useDashboardPrefs();

  const VALID_SALON_TABS: Tab[] = ["overview", "appointments", "masters", "services", "clients", "channels", "reviews", "settings", "public_profile", "analytics", "promo_codes", "staff"];
  const urlTab = searchParams.get("tab");
  const fallbackTab = (dashPrefs.defaultTab && VALID_SALON_TABS.includes(dashPrefs.defaultTab as Tab)) ? (dashPrefs.defaultTab as Tab) : "overview";
  const resolvedSalonTab: Tab =
    urlTab === "instagram" || urlTab === "whatsapp" ? "channels"
    : urlTab && VALID_SALON_TABS.includes(urlTab as Tab) ? (urlTab as Tab)
    : fallbackTab;

  const [tab, setTab] = useState<Tab>(forceTab ?? resolvedSalonTab);

  // Sync tab when URL changes (sidebar click in WebShell) or forceTab changes
  useEffect(() => {
    if (forceTab) { setTab(forceTab); return; }
    if (inWeb) setTab(resolvedSalonTab);
  }, [resolvedSalonTab, inWeb, forceTab]);
  // Calendar overhaul (2026-05-16): default flipped from "day" → "week" to
  // match Google Calendar parity. The previous five-pill switcher (incl.
  // «Агенда») is replaced with CalendarViewSwitcher; the 5th mode is
  // collapsed into "list" since the user explicitly noted nobody knows
  // the word «Агенда». normalizeViewMode handles any persisted "agenda"
  // value coming back from URL params or localStorage.
  const [aptViewMode, setAptViewMode] = useState<CalendarViewMode>(() => normalizeViewMode("week"));
  const [calViewDate, setCalViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [svcModal, setSvcModal] = useState<{ open: boolean; svc: any | null; initialData?: ServiceTemplate }>({ open: false, svc: null });
  const [showTemplates, setShowTemplates] = useState(false);
  const [masterModal, setMasterModal] = useState<"telegram" | "create" | "invite" | null>(null);
  const [deleteSvcConfirm, setDeleteSvcConfirm] = useState<{ active: boolean; svcId: string | null }>({ active: false, svcId: null });
  const [removeMasterConfirm, setRemoveMasterConfirm] = useState<{ active: boolean; chatId: string | null }>({ active: false, chatId: null });

  function handleAddNew() { setSvcModal({ open: true, svc: null }); }
  function handleAddTemplates() { setShowTemplates(true); }
  function handleTemplateSelect(tmpl: ServiceTemplate) {
    setShowTemplates(false);
    setSvcModal({ open: true, svc: null, initialData: tmpl });
  }

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
  const apts = api.salon.getAppointments.useQuery({ tenantId }, { enabled: tab === "appointments" && aptViewMode === "list" });

  // Calendar data: full month
  const calYear = calViewDate.getFullYear();
  const calMonth = calViewDate.getMonth();
  const fmtISO = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const calDateFrom = fmtISO(calYear, calMonth, 1);
  const calDateTo = fmtISO(calYear, calMonth, new Date(calYear, calMonth + 1, 0).getDate());
  const calApts = api.salon.getAppointments.useQuery(
    { tenantId, dateFrom: calDateFrom, dateTo: calDateTo, limit: 300 },
    { enabled: tab === "appointments" && aptViewMode === "calendar" },
  );
  // Day view: single-date fetch + masters list (also enabled outside masters tab).
  const dayApts = api.salon.getAppointments.useQuery(
    { tenantId, date: fmtISO(calViewDate.getFullYear(), calViewDate.getMonth(), calViewDate.getDate()) },
    { enabled: tab === "appointments" && aptViewMode === "day" },
  );
  // Week view: 7-day range starting from Mon of the week containing calViewDate.
  const weekFrom = (() => {
    const d = new Date(calViewDate);
    const dayIdx = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - dayIdx);
    return fmtISO(d.getFullYear(), d.getMonth(), d.getDate());
  })();
  const weekTo = (() => {
    const d = new Date(calViewDate);
    const dayIdx = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dayIdx + 6);
    return fmtISO(d.getFullYear(), d.getMonth(), d.getDate());
  })();
  const weekApts = api.salon.getAppointments.useQuery(
    { tenantId, dateFrom: weekFrom, dateTo: weekTo, limit: 200 },
    { enabled: tab === "appointments" && aptViewMode === "week" },
  );
  // Calendar overhaul (2026-05-16): pull appointment_blocks for the active
  // day/week range so reservations + time-off bands render in the grid.
  // Query window: day-mode → single day; week-mode → mon-sun span.
  const blocksRange = useMemo(() => {
    if (aptViewMode === "day") {
      const iso = fmtISO(calViewDate.getFullYear(), calViewDate.getMonth(), calViewDate.getDate());
      return { dateFrom: iso, dateTo: iso };
    }
    if (aptViewMode === "week") return { dateFrom: weekFrom, dateTo: weekTo };
    return { dateFrom: calDateFrom, dateTo: calDateTo };
  }, [aptViewMode, calViewDate, weekFrom, weekTo, calDateFrom, calDateTo]);
  const blocksQuery = api.appointmentBlocks.listByRange.useQuery(
    { tenantId, dateFrom: blocksRange.dateFrom, dateTo: blocksRange.dateTo },
    { enabled: tab === "appointments" && (aptViewMode === "day" || aptViewMode === "week") },
  );
  const blockRows = useMemo(() => {
    return (blocksQuery.data?.blocks ?? []).map((b) => ({
      id: b.id,
      date: b.date,
      time: b.time,
      durationMin: b.durationMin,
      endDate: b.endDate ?? null,
      masterId: b.masterId,
      type: b.type as "reservation" | "time_off",
      reason: b.reason ?? null,
    }));
  }, [blocksQuery.data]);
  const deleteBlock = api.appointmentBlocks.delete.useMutation({
    onSuccess: () => { void blocksQuery.refetch(); },
  });
  const mastersList = api.salon.getMasters.useQuery(
    { tenantId },
    {
      // Masters power the rail's "My calendars" + every appointment view's
      // master coloring, so keep the query enabled for the whole tab.
      enabled: tab === "masters" || tab === "appointments",
    },
  );
  // Auto-confirm settings — surfaced in the calendar left rail so the
  // owner can flip channels without leaving the appointments view.
  const autoConfirmQuery = api.salon.getAutoConfirmSettings.useQuery(
    { tenantId },
    { enabled: tab === "appointments" },
  );
  const autoConfirmMut = api.salon.setAutoConfirm.useMutation({
    onSuccess: () => { void utils.salon.getAutoConfirmSettings.invalidate({ tenantId }); },
  });
  // Shared master-visibility state — both CalendarLeftRail and SalonDayView
  // read from the same source. localStorage-backed so the owner's
  // preference survives reloads.
  const masterVis = useMasterVisibility();
  // Calendar/agenda filter state — local to the appointments tab. Status
  // filter persists on page reload via localStorage so the user's choice
  // survives refresh; service filter is session-local since the service
  // catalog can change.
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem("manicbot_apt_hidden_statuses");
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggleStatusHidden = (s: string) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      try { window.localStorage.setItem("manicbot_apt_hidden_statuses", JSON.stringify(Array.from(next))); } catch { /* noop */ }
      return next;
    });
  };
  const showAllStatuses = () => {
    setHiddenStatuses(new Set());
    try { window.localStorage.setItem("manicbot_apt_hidden_statuses", "[]"); } catch { /* noop */ }
  };
  const [hiddenServiceIds, setHiddenServiceIds] = useState<Set<string>>(new Set());
  const toggleServiceHidden = (svcId: string) => {
    setHiddenServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(svcId)) next.delete(svcId);
      else next.add(svcId);
      return next;
    });
  };
  const showAllServices = () => setHiddenServiceIds(new Set());
  // Services list is needed in the appointments tab too — we use it both
  // for the rail filter and to look up service display names in the
  // agenda/list rows.
  const svcList = api.salon.getServices.useQuery({ tenantId }, { enabled: tab === "services" || tab === "appointments" });
  const clients = api.salon.getClients.useQuery({ tenantId }, { enabled: tab === "clients" || tab === "overview" });
  const billing = api.salon.getBillingStatus.useQuery({ tenantId }, { enabled: tab === "overview" });
  const profile = api.salon.getSalonProfile.useQuery({ tenantId }, { enabled: tab === "settings" || tab === "public_profile" || tab === "analytics" || tab === "channels" });
  const reviewStats = api.reviews.getStats.useQuery({ tenantId }, { enabled: tab === "reviews" || tab === "overview" });
  const reviewList = api.reviews.getForSalon.useQuery({ tenantId }, { enabled: tab === "reviews" });
  const botStatus = api.salon.getBotStatus.useQuery({ tenantId }, { enabled: tab === "analytics" || tab === "channels" });

  // Optimistic status state — mirrors `pendingMoves` below, but for status
  // mutations (confirm / cancel / reject / no-show). Without this the click
  // → mutate → invalidate → refetch round-trip takes 300–800 ms, during
  // which the AptCard is visually unchanged and the user reads it as
  // "nothing happened". Patch shape + merge live in `optimisticStatusMerge`
  // so AptCard's read contract stays pinned by a unit test.
  const [pendingStatusChanges, setPendingStatusChanges] = useState<PendingStatusPatches>({});

  const updateAptStatus = api.salon.updateAppointmentStatus.useMutation({
    onMutate: ({ appointmentId, status }) => {
      setPendingStatusChanges((prev) => ({
        ...prev,
        [appointmentId]: status === "cancelled"
          ? buildCancelPatch()
          : buildStatusChangePatch(status),
      }));
    },
    onError: (err) => {
      toast.error(t("salon.apt.statusUpdateFailed", lang), err?.message || undefined);
    },
    onSuccess: () => {
      toast.success(t("salon.apt.statusUpdated", lang));
    },
    onSettled: (_data, _err, vars) => {
      setPendingStatusChanges((prev) => {
        const next = { ...prev };
        delete next[vars.appointmentId];
        return next;
      });
      utils.salon.getAppointments.invalidate();
      todayApts.refetch();
    },
  });
  const markNoShow = api.salon.markNoShow.useMutation({
    onMutate: ({ id, noShowBy }) => {
      setPendingStatusChanges((prev) => ({
        ...prev,
        [id]: buildNoShowPatch(noShowBy),
      }));
    },
    onError: (err) => {
      toast.error(t("salon.apt.noShowFailed", lang), err?.message || undefined);
    },
    onSuccess: () => {
      toast.success(t("salon.apt.statusUpdated", lang));
    },
    onSettled: (_data, _err, vars) => {
      setPendingStatusChanges((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      utils.salon.getAppointments.invalidate();
      todayApts.refetch();
    },
  });

  // Drag-to-reschedule optimistic state.
  //   pendingMoves holds in-flight (id → new {date,time,masterId}) so we can
  //   patch the rendered appointment arrays without waiting for the server
  //   round-trip. Cleared in onSettled regardless of success/error — on
  //   success the cache refetch lands the canonical data; on error we
  //   surface a toast and let the cache restore the original slot.
  const [pendingMoves, setPendingMoves] = useState<Record<string, { date: string; time: string; masterId: number }>>({});
  const rescheduleApt = api.appointments.rescheduleAppointment.useMutation({
    onMutate: (vars) => {
      setPendingMoves((prev) => ({
        ...prev,
        [vars.appointmentId]: {
          date: vars.newDate,
          time: vars.newTime,
          masterId: vars.newMasterId ?? 0,
        },
      }));
    },
    onError: (err, vars) => {
      const msg = err?.message ?? "";
      if (msg === "slot_conflict") {
        toast.error(t("salon.reschedule.conflict", lang));
      } else if (msg === "appointment_terminal") {
        toast.error(t("salon.reschedule.failed", lang));
      } else {
        toast.error(t("salon.reschedule.failed", lang), msg || undefined);
      }
      // Snapshot rollback: removing the entry restores the source slot
      // visually until the next query refetch confirms.
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[vars.appointmentId];
        return next;
      });
    },
    onSuccess: () => {
      toast.success(t("salon.reschedule.success", lang));
    },
    onSettled: (_data, _err, vars) => {
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[vars.appointmentId];
        return next;
      });
      utils.salon.getAppointments.invalidate();
      todayApts.refetch();
    },
  });

  // Apply pending optimistic moves on top of the appointment arrays before
  // they reach the views. Same patch runs for Day/Week/calendar caches so
  // the dragged block visually settles into its new slot immediately.
  const applyPendingMoves = (rows: any[] | undefined): any[] => {
    if (!rows) return [];
    const ids = Object.keys(pendingMoves);
    if (ids.length === 0) return rows;
    return rows.map((r) => {
      const patch = pendingMoves[String(r.id)];
      if (!patch) return r;
      // Recompute `ts` so cross-day moves don't desync the agenda sort.
      const [hh, mm] = patch.time.split(":").map(Number);
      const [y, mo, d] = patch.date.split("-").map(Number);
      const ts = Math.floor(Date.UTC(y!, mo! - 1, d!, hh!, mm!) / 1000);
      return { ...r, date: patch.date, time: patch.time, masterId: patch.masterId || r.masterId, ts };
    });
  };

  // Layer in-flight status mutations onto the appointment arrays — twin of
  // applyPendingMoves, but for confirm/cancel/no-show. The merged row gets
  // the new status + cancelled/noShow flags so AptCard.statusKey flips
  // instantly to the terminal state and the card dims. Merge logic lives in
  // `~/lib/optimisticStatusMerge` (unit-tested) — this closure just plugs
  // the current `pendingStatusChanges` state into it.
  const applyPendingStatusChanges = (rows: any[] | undefined): any[] =>
    mergeStatusPatches(rows, pendingStatusChanges);

  const handleMoveAppointment = (move: MoveCommit) => {
    if (move.toMasterId == null) {
      // Week view drops carry masterId=null (the column is per-day). The
      // mutation needs an explicit masterId, so fall back to the row's
      // current one. Looking it up via the patched arrays would be racy;
      // omitting newMasterId tells the server to keep masterId unchanged.
      rescheduleApt.mutate({
        tenantId,
        appointmentId: String(move.appointmentId),
        newDate: move.toDate,
        newTime: move.toTime,
      });
      return;
    }
    rescheduleApt.mutate({
      tenantId,
      appointmentId: String(move.appointmentId),
      newDate: move.toDate,
      newTime: move.toTime,
      newMasterId: move.toMasterId,
    });
  };
  const removeMaster = api.salon.removeMaster.useMutation({
    onSuccess: () => { utils.salon.getMasters.invalidate(); void utils.onboarding.getStatus.invalidate({ tenantId }); },
  });
  const setMasterPublicHidden = api.salon.setMasterPublicHidden.useMutation({
    onSuccess: () => { utils.salon.getMasters.invalidate(); },
  });
  const deleteSvc = api.salon.deleteService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); void utils.onboarding.getStatus.invalidate({ tenantId }); },
  });

  const role = useRole().role;
  const perms = useRole().permissions;
  const isOwnerLevel = role === "tenant_owner" || role === "system_admin" || (role === "master" && useRole().isPersonalTenant);
  const canSee = (p: PermissionKey | null) => {
    if (isOwnerLevel) return true;
    if (role !== "tenant_manager") return false;
    return p === null || perms.includes(p);
  };
  const allTabs: { key: Tab; label: string; perm: PermissionKey | null; ownerOnly?: boolean }[] = [
    { key: "overview", label: t("salon.overview", lang), perm: "appointments.view" },
    { key: "appointments", label: t("salon.appointments", lang), perm: "appointments.view" },
    { key: "services", label: t("salon.services", lang), perm: "services.view" },
    { key: "masters", label: t("salon.masters", lang), perm: "masters.view" },
    { key: "clients", label: t("salon.clients", lang), perm: "clients.view" },
    { key: "analytics", label: `📊 ${t("salon.tabs.analytics", lang)}`, perm: null, ownerOnly: true },
    { key: "promo_codes", label: `🎟 ${t("salon.tabs.promoCodes", lang)}`, perm: null, ownerOnly: true },
    { key: "channels", label: t("salon.tabs.channels", lang), perm: "settings.manage" },
    { key: "reviews", label: t("salon.tabs.reviews", lang), perm: "reviews.view" },
    { key: "public_profile", label: `🌐 ${t("salon.tabs.publicProfile", lang)}`, perm: "branding.manage" },
    { key: "staff", label: `👥 ${t("salon.tabs.staff", lang)}`, perm: null, ownerOnly: true },
    { key: "settings", label: t("common.settings", lang), perm: "settings.manage" },
  ];
  const tabs = allTabs.filter((tb) => {
    if (tb.ownerOnly) return isOwnerLevel;
    return canSee(tb.perm);
  });

  // Sprint 3/4 — manual booking modal state
  const [manualBookingOpen, setManualBookingOpen] = useState(false);
  // 0062: Clients tab overhaul — FAB switches to "+ Add client" on the
  // Clients tab and opens this dedicated form (no appointment required).
  const [clientFormOpen, setClientFormOpen] = useState(false);
  // Calendar overhaul (2026-05-16): two new FAB scenarios — calendar block
  // (reservation) and break / day-off / vacation (time_off). Both write
  // to `appointment_blocks` via the new `appointmentBlocks.create` tRPC.
  const [timeReservationOpen, setTimeReservationOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  // Drag-to-create prefill (Day/Week grids → ManualBookingModal /
  // TimeReservationDialog). Cleared on dialog close.
  const [dragPrefill, setDragPrefill] = useState<{ date?: string; time?: string; masterId?: number | null; durationMin?: number } | null>(null);
  // Reminders plugin — FAB-launched modal state.
  const [reminderModal, setReminderModal] = useState<null | "reminder" | "routine">(null);
  // Which plugins are installed for this tenant. Drives the FAB extraItems list.
  // Skipped (enabled:false) until tenantId is known so we don't fetch on the
  // public landing pre-auth render.
  const installedPlugins = api.plugins.getInstalled.useQuery(undefined, {
    enabled: !!tenantId,
  });
  const remindersInstalled = !!installedPlugins.data?.find(
    (p) => p.pluginSlug === "reminders" && p.enabled === 1,
  );
  const fabExtraItems: FabExtraItem[] = remindersInstalled
    ? [
        {
          id: "reminder",
          icon: Bell,
          label: "Напоминание",
          description: "Однократное напоминание для себя или мастера",
          onClick: () => setReminderModal("reminder"),
        },
        {
          id: "routine",
          icon: Repeat,
          label: "Рутина",
          description: "Циклическое напоминание (например, по будням)",
          onClick: () => setReminderModal("routine"),
        },
      ]
    : [];

  const isTest = useRole().isTest;

  // Delete service confirmation modal
  const deleteSvcConfirmModal = deleteSvcConfirm.active && (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setDeleteSvcConfirm({ active: false, svcId: null })}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("confirm.deleteService", lang)}</h3>
        <div className="flex gap-2">
          <button onClick={() => setDeleteSvcConfirm({ active: false, svcId: null })}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            {t("action.cancel", lang)}
          </button>
          <button onClick={() => {
            if (deleteSvcConfirm.svcId) deleteSvc.mutate({ tenantId, svcId: deleteSvcConfirm.svcId });
            setDeleteSvcConfirm({ active: false, svcId: null });
          }}
            className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-colors">
            {t("action.delete", lang)}
          </button>
        </div>
      </div>
    </div>
  );

  // Remove master confirmation modal
  const removeMasterConfirmModal = removeMasterConfirm.active && (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setRemoveMasterConfirm({ active: false, chatId: null })}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("confirm.removeMaster", lang)}</h3>
        <div className="flex gap-2">
          <button onClick={() => setRemoveMasterConfirm({ active: false, chatId: null })}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            {t("action.cancel", lang)}
          </button>
          <button onClick={() => {
            if (removeMasterConfirm.chatId) removeMaster.mutate({ tenantId, chatId: Number(removeMasterConfirm.chatId) });
            setRemoveMasterConfirm({ active: false, chatId: null });
          }}
            className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-colors">
            {t("action.delete", lang)}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Shell navItems={salonNavItems} title={t("salon.title", lang)} subtitle="ManicBot Salon">
      {isTest && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-yellow-300/40 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <TestBadge />
          <span>{t("master.testAccountBanner", lang)}</span>
        </div>
      )}
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

      {/* Floating quick-add menu — Appointments and Clients tabs only.
          User feedback (2026-05-16): keep this OFF the Overview tab and
          every other section — a "+ Новая запись" CTA over Settings or
          Billing is just noise. The same FAB switches to "+ Add client"
          mode when the user is on the Clients tab (handled by the
          QuickAddFab `mode` prop and the dedicated `ClientFormModal`
          below). */}
      {(tab === "appointments" || tab === "clients") && (
        <QuickAddFab
          lang={lang}
          mode={tab === "clients" ? "client" : "booking"}
          onNewBooking={() => setManualBookingOpen(true)}
          onTimeReservation={() => setTimeReservationOpen(true)}
          onTimeOff={() => setTimeOffOpen(true)}
          onAddClient={() => setClientFormOpen(true)}
          extraItems={fabExtraItems}
        />
      )}

      {/* 0062: dedicated "create client" form, mounted globally so the
          FAB on the Clients tab can fire it without depending on tab
          render order. */}
      {clientFormOpen && (
        <ClientFormModal
          tenantId={tenantId}
          onClose={() => setClientFormOpen(false)}
          onSaved={() => setClientFormOpen(false)}
        />
      )}

      {manualBookingOpen && (
        <ManualBookingModal
          tenantId={tenantId}
          defaultMasterId={dragPrefill?.masterId ?? undefined}
          defaultDate={dragPrefill?.date}
          defaultTime={dragPrefill?.time}
          onClose={() => { setManualBookingOpen(false); setDragPrefill(null); }}
          onCreated={() => {
            apts.refetch();
            todayApts.refetch();
            void blocksQuery.refetch();
          }}
        />
      )}

      {reminderModal && (
        <ReminderModal
          tenantId={tenantId}
          defaultKind={reminderModal}
          onClose={() => setReminderModal(null)}
        />
      )}

      {/* ── OVERVIEW ──
          The Overview tab is now a focused two-card surface:
          (1) the merged setup checklist (auto-hides when 10/10 done) and
          (2) today's appointments sorted descending — no stat grid, no
          secondary wizard. Per-section pages own their own stats; the home
          page is for setup progress and what's on the schedule now. */}
      {tab === "overview" && (
        <div className="space-y-4">
          <OnboardingChecklist tenantId={tenantId} />
          <ReferralOverviewTeaser />
          {dashPrefs.showTodayApts && (
            <>
              {todayApts.isLoading && (
                <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="glass-card rounded-xl h-16 animate-pulse" />)}</div>
              )}
              {todayApts.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
              {todayApts.data && todayApts.data.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("salon.todayApts", lang)}</h3>
                    <button onClick={() => setTab("appointments")}
                      className="flex items-center gap-0.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                      {t("salon.appointments", lang)} <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                  {[...applyPendingStatusChanges(todayApts.data)]
                    .sort((a: any, b: any) => String(b.time ?? "").localeCompare(String(a.time ?? "")))
                    .map((a: any) => (
                      <AptCard key={a.id} a={a} lang={lang}
                        onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
                        onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })} />
                    ))}
                </div>
              )}
              {todayApts.data?.length === 0 && (
                <EmptyState icon={CalendarDays} title={t("salon.noApts", lang)} description={t("salon.empty.apts", lang)} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── APPOINTMENTS ── */}
      {tab === "appointments" && (() => {
        // ── Service catalog → rail items + name lookup ────────────────
        const svcRows = (svcList.data ?? []) as Array<{ svcId: string; names?: string | null; active?: number }>;
        const parseSvcName = (raw: string | null | undefined, fallback: string): string => {
          if (!raw) return fallback;
          const trimmed = raw.trim();
          if (!trimmed) return fallback;
          if (trimmed.startsWith("{")) {
            try {
              const parsed = JSON.parse(trimmed) as Record<string, string>;
              return parsed[lang] ?? parsed.en ?? parsed.ru ?? Object.values(parsed)[0] ?? fallback;
            } catch {
              return trimmed;
            }
          }
          return trimmed;
        };
        const serviceNames: Record<string, string> = {};
        const serviceRailItems = svcRows
          .filter((s) => s.active !== 0)
          .map((s) => {
            const name = parseSvcName(s.names ?? null, s.svcId);
            serviceNames[s.svcId] = name;
            return { svcId: s.svcId, name };
          });

        // ── Apply filters to whichever apt set we're rendering ────────
        const filterApt = (a: any): boolean => {
          const status = a.noShow
            ? "no_show"
            : a.cancelled || a.status === "cancelled" || a.status === "rejected"
              ? "cancelled"
              : a.status === "done"
                ? "done"
                : a.status === "confirmed"
                  ? "confirmed"
                  : "pending";
          if (hiddenStatuses.has(status)) return false;
          if (a.svcId && hiddenServiceIds.has(a.svcId)) return false;
          if (a.masterId != null && masterVis.hiddenMasterIds.has(Number(a.masterId))) return false;
          return true;
        };
        const filtersActive =
          hiddenStatuses.size > 0 ||
          hiddenServiceIds.size > 0 ||
          masterVis.hiddenMasterIds.size > 0;

        const aptsFiltered = applyPendingStatusChanges((apts.data ?? []).filter(filterApt));
        // applyPendingMoves layers in-flight drag-reschedules on top of the
        // server snapshot so the dragged block visually settles into its
        // new slot immediately (the cache invalidate in onSettled will
        // overwrite with canonical data once the mutation resolves).
        // applyPendingStatusChanges does the same for confirm/cancel/no-show
        // mutations — without it the user reads the 300–800 ms refetch gap
        // as "nothing happened" after clicking the status dropdown.
        const dayAptsFiltered = applyPendingMoves(applyPendingStatusChanges((dayApts.data ?? []).filter(filterApt)));
        const weekAptsFiltered = applyPendingMoves(applyPendingStatusChanges((weekApts.data ?? []).filter(filterApt)));
        const calAptsFiltered = applyPendingStatusChanges((calApts.data ?? []).filter(filterApt));

        return (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left rail — mini-month + my calendars + status / services filters
              + auto-confirm + jump-by-week. GCal/Booksy-parity vertical stack.
              Desktop only. */}
          <CalendarLeftRail
            selectedDate={calViewDate}
            setSelectedDate={setCalViewDate}
            lang={lang}
            masters={(mastersList.data ?? []).filter((m: any) => m.active === 1).map((m: any) => ({
              chatId: m.chatId,
              name: m.name,
            }))}
            hiddenMasterIds={masterVis.hiddenMasterIds}
            toggleMasterVisible={masterVis.toggleMasterVisible}
            showAllMasters={masterVis.showAllMasters}
            hiddenStatuses={hiddenStatuses as Set<any>}
            toggleStatusVisible={(s) => toggleStatusHidden(s)}
            showAllStatuses={showAllStatuses}
            services={serviceRailItems}
            hiddenServiceIds={hiddenServiceIds}
            toggleServiceVisible={toggleServiceHidden}
            showAllServices={showAllServices}
            autoConfirm={autoConfirmQuery.data}
            autoConfirmLoading={autoConfirmMut.isPending}
            setAutoConfirm={(channel, enabled) =>
              autoConfirmMut.mutate({ tenantId, channel, enabled })
            }
          />
          {/* Main column — header + view */}
          <div className="flex-1 min-w-0 space-y-3">
          {/* Calendar overhaul (2026-05-16): the duplicated «Записи» H2 lived
              here next to the inline 5-pill switcher. PageHeader / Shell
              already shows the page title — we drop the H2 and let the
              dropdown sit at the right of an empty bar. */}
          <div className="flex items-center justify-end">
            <CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} testIdPrefix="salon-apt" />
          </div>

          <div
            key={aptViewMode}
            data-testid="salon-apt-view-transition"
            data-mode={aptViewMode}
            className="apt-view-transition space-y-3"
          >
          {aptViewMode === "calendar" && (
            <SalonBigCalendar
              apts={calAptsFiltered}
              masters={(mastersList.data ?? []).map((m: any) => ({ chatId: m.chatId, name: m.name }))}
              viewDate={calViewDate}
              setViewDate={setCalViewDate}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              isLoading={calApts.isFetching}
              lang={lang}
              onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
              onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })}
              serviceNames={serviceNames}
            />
          )}

          {aptViewMode === "day" && (
            <SalonDayView
              date={calViewDate}
              setDate={setCalViewDate}
              apts={dayAptsFiltered}
              masters={(mastersList.data ?? []) as any}
              isLoading={dayApts.isLoading || mastersList.isLoading}
              lang={lang}
              onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
              onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })}
              hiddenMasterIds={masterVis.hiddenMasterIds}
              toggleMasterVisible={masterVis.toggleMasterVisible}
              showAllMasters={masterVis.showAllMasters}
              blocks={blockRows}
              onDeleteBlock={(id) => deleteBlock.mutate({ tenantId, id })}
              onCreateAt={(info) => {
                setDragPrefill({ date: info.date, time: info.time, masterId: info.masterId, durationMin: info.durationMin });
                if (info.modifier === "shift") setTimeReservationOpen(true);
                else setManualBookingOpen(true);
              }}
              onMoveAppointment={handleMoveAppointment}
              tenantId={tenantId}
              services={
                (svcList.data ?? []).map((s) => ({
                  svcId: s.svcId,
                  names: s.names ?? null,
                  duration: s.duration,
                  price: typeof s.price === "number" ? s.price : Number(s.price ?? 0),
                }))
              }
              onUpdated={() => {
                void utils.salon.getAppointments.invalidate();
              }}
            />
          )}

          {aptViewMode === "week" && (
            <SalonWeekView
              date={calViewDate}
              setDate={setCalViewDate}
              apts={weekAptsFiltered}
              masters={(mastersList.data ?? []) as any}
              isLoading={weekApts.isLoading || mastersList.isLoading}
              lang={lang}
              onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
              onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })}
              blocks={blockRows}
              onDeleteBlock={(id) => deleteBlock.mutate({ tenantId, id })}
              onCreateAt={(info) => {
                setDragPrefill({ date: info.date, time: info.time, masterId: info.masterId, durationMin: info.durationMin });
                if (info.modifier === "shift") setTimeReservationOpen(true);
                else setManualBookingOpen(true);
              }}
              onMoveAppointment={handleMoveAppointment}
            />
          )}

          {/* Calendar overhaul (2026-05-16): «Агенда» mode is gone. List
              mode now uses SalonAgendaView (the dense, GCal-style row
              renderer) so users get the better visual without learning
              the word «Агенда» the user explicitly wanted dropped. */}
          {aptViewMode === "list" && (
            <SalonAgendaView
              apts={aptsFiltered}
              isLoading={apts.isLoading}
              lang={lang}
              onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
              onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })}
              masters={(mastersList.data ?? []).map((m: any) => ({ chatId: m.chatId, name: m.name }))}
              serviceNames={serviceNames}
              filtersActive={filtersActive && (apts.data?.length ?? 0) > 0}
            />
          )}
          </div>
          </div>
        </div>
        );
      })()}

      {/* ── SERVICES ── */}
      {tab === "services" && (
        <div className="space-y-3">
          <SectionHeader title={t("salon.services", lang)} action={
            (svcList.data?.length ?? 0) > 0
              ? <AddServiceDropdown lang={lang} onNew={handleAddNew} onTemplates={handleAddTemplates} />
              : undefined
          } />
          {svcList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {svcList.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
          <div className="space-y-2">
            {svcList.data?.map((s: any) => {
              let names: Record<string, string> = {};
              try { names = s.names ? JSON.parse(s.names) : {}; } catch { /* ignore */ }
              const name = names.ru ?? names.en ?? s.svcId;
              const svcPhotos: string[] = (() => { try { return JSON.parse(s.photos ?? "[]"); } catch { return []; } })();
              return (
                <div key={s.svcId} className="glass-card rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      {svcPhotos[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={svcPhotos[0]} alt="" className="w-10 h-10 rounded-xl object-cover" />
                      ) : (
                        <span className="text-2xl w-10 h-10 flex items-center justify-center">{s.emoji ?? "💅"}</span>
                      )}
                      {s.promo && (
                        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow leading-none whitespace-nowrap">
                          {s.promo}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white text-sm">{name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.duration} {t("service.duration", lang).split("(")[0]?.trim()} · {`${s.price} zł`}</p>
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
                    <button onClick={() => setDeleteSvcConfirm({ active: true, svcId: s.svcId })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400/70 text-xs hover:text-red-400 hover:bg-red-500/20 transition-colors">
                      <Trash2 className="h-3 w-3" /> {t("action.delete", lang)}
                    </button>
                  </div>
                </div>
              );
            })}
            {svcList.data?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 gap-5">
                <span className="text-4xl">💅</span>
                <p className="text-slate-500 dark:text-slate-400 text-sm text-center">{t("salon.noServices", lang)}</p>
                <AddServiceDropdown lang={lang} onNew={handleAddNew} onTemplates={handleAddTemplates} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MASTERS ── */}
      {tab === "masters" && (
        <div className="space-y-3">
          <SectionHeader title={t("salon.masters", lang)} action={
            <div className="flex items-center gap-2">
              <Btn onClick={() => setMasterModal("telegram")}><Plus className="h-3.5 w-3.5" />{t("master.addViaTelegram", lang)}</Btn>
              <Btn onClick={() => setMasterModal("create")}><Plus className="h-3.5 w-3.5" />{t("master.createAccount", lang)}</Btn>
            </div>
          } />
          {mastersList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {mastersList.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
          <div className="space-y-2">
            {mastersList.data?.map((m: any) => {
              const isWebAccount = m.chatId >= 10_000_000_000;
              const isHidden = m.publicHidden === 1;
              // Live vacation derivation — mirrors publicSalon.getProfile so the
              // owner sees the same state customers do.
              const nowSec = Math.floor(Date.now() / 1000);
              const inRange =
                typeof m.vacationFrom === "number" &&
                typeof m.vacationUntil === "number" &&
                m.vacationFrom <= nowSec &&
                nowSec <= m.vacationUntil;
              const onVacation = m.onVacation === 1 || inRange;
              return (
                <div key={m.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-brand-500 flex items-center justify-center text-sm font-bold text-white shrink-0 ${isHidden ? "opacity-50" : ""}`}>
                    {(m.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-medium text-sm ${isHidden ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>{m.name ?? `#${m.chatId}`}</p>
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
                    {!isWebAccount && <p className="text-[10px] text-slate-500">ID: {m.chatId}</p>}
                  </div>
                  <button
                    onClick={() => setMasterPublicHidden.mutate({ tenantId, chatId: m.chatId, hidden: isHidden ? 0 : 1 })}
                    disabled={setMasterPublicHidden.isPending}
                    title={isHidden ? t("master.showOnPublic", lang) : t("master.hideFromPublic", lang)}
                    className={`h-8 w-8 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 ${
                      isHidden
                        ? "bg-slate-500/10 text-slate-500 hover:bg-slate-500/20"
                        : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                    }`}
                  >
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => setRemoveMasterConfirm({ active: true, chatId: m.chatId })}
                    className="h-8 w-8 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/20 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {mastersList.data?.length === 0 && (
              <EmptyState
                icon={UserCheck}
                title={t("salon.noMasters", lang)}
                description={t("salon.empty.masters", lang)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── CLIENTS ── */}
      {tab === "clients" && <ClientsTab tenantId={tenantId} />}

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
            <EmptyState icon={Star} title={t("salon.noReviews", lang)} description={t("salon.empty.reviews", lang)} />
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

      {/* ── PROMO CODES ── */}
      {tab === "promo_codes" && <PromoCodesTab tenantId={tenantId} />}

      {/* ── STAFF (tenant_owner only) ── */}
      {tab === "staff" && <StaffTab tenantId={tenantId} />}

      {/* ── CHANNELS ── */}
      {tab === "channels" && <SalonChannelsTab tenantId={tenantId} slug={profile.data?.slug ?? null} publicActive={!!profile.data?.publicActive} />}

      {/* ── PUBLIC PROFILE ── */}
      {tab === "public_profile" && (
        <PublicProfileEditor tenantId={tenantId} />
      )}

      {/* ── SETTINGS ── */}
      {tab === "settings" && (
        <>
          {profile.isLoading ? <Loader2 className="animate-spin text-brand-400 mx-auto" /> : profile.isError ? (
            <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>
          ) : (
            <SalonSettingsEditor tenantId={tenantId} profile={profile.data} />
          )}
          <AutoConfirmSettings tenantId={tenantId} />
          <SalonCalendarSection tenantId={tenantId} />
        </>
      )}

      {/* Modals */}
      {showTemplates && <ServiceTemplatesSheet lang={lang} onClose={() => setShowTemplates(false)} onSelect={handleTemplateSelect} />}
      {svcModal.open && <ServiceModal svc={svcModal.svc} onClose={() => setSvcModal({ open: false, svc: null })} tenantId={tenantId} initialData={svcModal.initialData} />}
      {masterModal === "telegram" && <AddMasterModal onClose={() => setMasterModal(null)} tenantId={tenantId} />}
      {masterModal === "create" && <CreateMasterAccountModal onClose={() => setMasterModal(null)} tenantId={tenantId} />}
      {masterModal === "invite" && <InviteByEmailModal onClose={() => setMasterModal(null)} tenantId={tenantId} />}

      {/* Bottom-right FAB on the Masters tab (3 add-master flows). The
          existing top-right buttons remain during the transition. */}
      {tab === "masters" && (
        <AddMasterFab
          onPick={(kind: AddMasterPick) => {
            if (kind === "create_account") setMasterModal("create");
            else if (kind === "add_telegram") setMasterModal("telegram");
            else if (kind === "invite_email") setMasterModal("invite");
          }}
        />
      )}
      {/* Calendar overhaul (2026-05-16): the previous duplicate
          ManualBookingModal mount that lived here at the bottom is
          superseded by the FAB-section render above (line ~1521) which
          carries the proper `onCreated` + `dragPrefill` wiring. */}
      {timeReservationOpen && (
        <TimeReservationDialog
          tenantId={tenantId}
          defaultMasterId={dragPrefill?.masterId ?? undefined}
          defaultDate={dragPrefill?.date}
          defaultTime={dragPrefill?.time}
          defaultDurationMin={dragPrefill?.durationMin}
          onClose={() => { setTimeReservationOpen(false); setDragPrefill(null); }}
          onCreated={() => { void apts.refetch(); void todayApts.refetch(); void blocksQuery.refetch(); }}
        />
      )}
      {timeOffOpen && (
        <TimeOffDialog
          tenantId={tenantId}
          defaultMasterId={dragPrefill?.masterId ?? undefined}
          defaultDate={dragPrefill?.date}
          onClose={() => { setTimeOffOpen(false); setDragPrefill(null); }}
          onCreated={() => { void apts.refetch(); void todayApts.refetch(); void blocksQuery.refetch(); }}
        />
      )}
      {deleteSvcConfirmModal}
      {removeMasterConfirmModal}
    </Shell>
  );
}
