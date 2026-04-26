"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  CreditCard, Settings, ChevronLeft, ChevronRight, AlertCircle,
  Loader2, Plus, Pencil, Trash2, Save, X, List,
  Eye, EyeOff, Globe, ExternalLink, MapPin, ToggleLeft, ToggleRight,
  Star, MessageSquare, Reply, Camera, Tag, ImageIcon, Copy,
} from "lucide-react";
import { resizeImageClientSide, validateUploadFile, uploadAssetFile } from "~/lib/uploadAsset";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useInWebShell } from "~/components/layout/WebShell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";
import { StatCard, AptCard, SectionHeader, Btn, Input } from "~/components/salon/SalonShared";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";
import { SalonChannelsTab } from "~/components/salon/SalonChannelsTab";
import { AssetUploadField } from "~/components/salon/AssetUploadField";
import { AnalyticsTab } from "~/components/salon/AnalyticsTab";
import { ClientsTab } from "~/components/salon/tabs/ClientsTab";
import { StaffTab } from "~/components/salon/tabs/StaffTab";
import { SERVICE_TEMPLATES, type ServiceTemplate } from "~/lib/serviceTemplates";
import { AddServiceDropdown, ServiceTemplatesSheet } from "~/components/salon/ServiceAddMenu";
import { ManualBookingModal } from "~/components/dashboard/ManualBookingModal";
import { OnboardingChecklist } from "~/components/dashboard/OnboardingChecklist";
import { PromoCodesTab } from "~/components/dashboard/PromoCodesTab";
import { BillingTabContent } from "~/components/dashboard/BillingTabContent";
import { TestBadge } from "~/components/ui/TestBadge";
import { EmptyState } from "~/components/ui/EmptyState";
import { useRole } from "~/components/RoleContext";
import type { PermissionKey } from "~/server/api/permissions";
import { NAIL_EMOJIS } from "~/lib/appointments";

type Tab = "overview" | "appointments" | "masters" | "services" | "clients" | "billing" | "channels" | "reviews" | "settings" | "public_profile" | "analytics" | "promo_codes" | "staff";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mintToken = api.salon.mintUploadToken.useMutation();
  const updateSvc = api.salon.updateService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); onClose(); },
  });
  const createSvc = api.salon.createService.useMutation({
    onSuccess: () => { utils.salon.getServices.invalidate(); onClose(); },
  });

  const isNew = !svc;
  const isBusy = updateSvc.isPending || createSvc.isPending || uploading;

  async function handlePhotoFile(file: File) {
    if (photos.length >= 5) return;
    const err = validateUploadFile(file);
    if (err) { alert(err); return; }
    setUploading(true);
    try {
      const compressed = await resizeImageClientSide(file, 1200, "image/webp", 0.82);
      const { uploadUrl } = await mintToken.mutateAsync({ tenantId, kind: "service_photo" });
      const result = await uploadAssetFile(uploadUrl, compressed);
      setPhotos(prev => [...prev, result.url].slice(0, 5));
    } catch {
      alert(t("master.photoUploadError", lang));
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
    onSuccess: () => { utils.salon.getMasters.invalidate(); onClose(); },
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

  function handleSave() {
    if (!validateSlug(slug)) return;
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
                    {slugCheck.isLoading ? "..." : slugCheck.data?.available === false ? `❌ ${t("salon.publicProfile.taken", lang)}` : slugCheck.data?.available ? "✅" : ""}
                  </span>
                )}
              </div>
              {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.city", lang)}</label>
              <input value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Москва"
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

// ─── Salon BigCalendar ────────────────────────────────────────────────────
const WEEKDAYS_SHORT: Record<string, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  ua: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
};

function SalonBigCalendar({
  apts,
  viewDate,
  setViewDate,
  selectedDay,
  setSelectedDay,
  isLoading,
  lang,
  onAction,
  onNoShow,
}: {
  apts: any[];
  viewDate: Date;
  setViewDate: (d: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (iso: string | null) => void;
  isLoading: boolean;
  lang: Lang;
  onAction: (id: number, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow: (id: number, noShowBy: "client" | "master") => void;
}) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const fmtISO = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const firstDowSun = new Date(year, month, 1).getDay();
  const firstDow = (firstDowSun + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const dayMap = useMemo(() => {
    const m: Record<string, any[]> = {};
    apts.forEach((a) => {
      if (!m[a.date]) m[a.date] = [];
      m[a.date]!.push(a);
    });
    return m;
  }, [apts]);

  const monthLabel = viewDate.toLocaleString(lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU", { month: "long", year: "numeric" });
  const weekdays = WEEKDAYS_SHORT[lang] ?? WEEKDAYS_SHORT.ru!;

  const selectedDayApts = useMemo(
    () => (selectedDay ? (dayMap[selectedDay] ?? []) : []),
    [selectedDay, dayMap],
  );

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-2xl p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white capitalize">{monthLabel}</h2>
            {isLoading && (
              <div className="w-3 h-3 rounded-full border-2 border-brand-500/40 border-t-brand-400 animate-spin" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setViewDate(new Date(year, month - 1))}
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => { setViewDate(new Date()); setSelectedDay(null); }}
              className="px-2 py-1 rounded-lg text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
              {t("salon.cal.todaySmall", lang)}
            </button>
            <button onClick={() => setViewDate(new Date(year, month + 1))}
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {weekdays.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-slate-500 py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px">
          {cells.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} className="min-h-[64px]" />;

            const iso = fmtISO(year, month, day);
            const dayApts = dayMap[iso] ?? [];
            const count = dayApts.length;
            const isSelected = selectedDay === iso;
            const todayDay = isToday(day);
            const visible = dayApts.slice(0, 2);
            const overflow = count - visible.length;

            return (
              <button key={iso}
                onClick={() => setSelectedDay(isSelected ? null : iso)}
                className={`relative flex flex-col rounded-xl p-1.5 text-left transition-all min-h-[64px] ${
                  isSelected ? "bg-brand-500/25 ring-1 ring-brand-500/60"
                  : todayDay ? "bg-brand-500/15 ring-1 ring-brand-500/30"
                  : "hover:bg-white/[0.04] active:bg-white/[0.08]"
                }`}>
                <span className={`text-xs font-bold leading-none mb-1 ${
                  todayDay ? "text-brand-400"
                  : isSelected ? "text-slate-900 dark:text-white"
                  : count > 0 ? "text-slate-200" : "text-slate-600"
                }`}>{day}</span>
                <div className="flex flex-col gap-0.5 w-full">
                  {visible.map((a: any) => {
                    const sk = a.noShow ? "no_show" : a.cancelled ? "cancelled" : a.status;
                    const chipColor =
                      sk === "pending" ? "bg-amber-500/20 text-amber-300"
                      : sk === "confirmed" ? "bg-emerald-500/20 text-emerald-300"
                      : sk === "done" ? "bg-brand-500/20 text-brand-300"
                      : sk === "no_show" ? "bg-orange-500/20 text-orange-300"
                      : "bg-slate-700/40 text-slate-400";
                    return (
                      <div key={a.id} className={`text-[9px] leading-tight rounded px-1 py-0.5 truncate font-medium ${chipColor}`}>
                        {a.time} {a.userName ?? a.userTg ?? ""}
                      </div>
                    );
                  })}
                  {overflow > 0 && <div className="text-[9px] text-slate-500 pl-1">+{overflow}</div>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded bg-brand-500/40 ring-1 ring-brand-500/40" />
            <span>{t("salon.cal.today", lang)}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded bg-amber-500/25" />
            <span>{t("salon.cal.pending", lang)}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded bg-emerald-500/25" />
            <span>{t("salon.cal.confirmed", lang)}</span>
          </div>
        </div>
      </div>

      {/* Selected day panel */}
      {selectedDay && (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
              {new Date(selectedDay + "T12:00:00").toLocaleDateString(
                lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU",
                { weekday: "long", day: "numeric", month: "long" }
              )}
            </h3>
            <button onClick={() => setSelectedDay(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
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
    </div>
  );
}

export function SalonDashboard({ tenantId, forceTab }: { tenantId: string; forceTab?: Tab }) {
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const inWeb = useInWebShell();
  const { prefs: dashPrefs } = useDashboardPrefs();

  const VALID_SALON_TABS: Tab[] = ["overview", "appointments", "masters", "services", "clients", "billing", "channels", "reviews", "settings", "public_profile", "analytics", "promo_codes", "staff"];
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
  const [aptViewMode, setAptViewMode] = useState<"calendar" | "list">("calendar");
  const [calViewDate, setCalViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [svcModal, setSvcModal] = useState<{ open: boolean; svc: any | null; initialData?: ServiceTemplate }>({ open: false, svc: null });
  const [showTemplates, setShowTemplates] = useState(false);
  const [masterModal, setMasterModal] = useState<"telegram" | "create" | null>(null);

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
  const mastersList = api.salon.getMasters.useQuery({ tenantId }, { enabled: tab === "masters" });
  const svcList = api.salon.getServices.useQuery({ tenantId }, { enabled: tab === "services" });
  const clients = api.salon.getClients.useQuery({ tenantId }, { enabled: tab === "clients" || tab === "overview" });
  const billing = api.salon.getBillingStatus.useQuery({ tenantId }, { enabled: tab === "billing" || tab === "overview" });
  const profile = api.salon.getSalonProfile.useQuery({ tenantId }, { enabled: tab === "settings" || tab === "public_profile" || tab === "analytics" || tab === "channels" });
  const reviewStats = api.reviews.getStats.useQuery({ tenantId }, { enabled: tab === "reviews" || tab === "overview" });
  const reviewList = api.reviews.getForSalon.useQuery({ tenantId }, { enabled: tab === "reviews" });
  const botStatus = api.salon.getBotStatus.useQuery({ tenantId }, { enabled: tab === "analytics" || tab === "channels" });

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
    { key: "billing", label: t("salon.billing", lang), perm: "billing.manage" },
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

  const isTest = useRole().isTest;

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

      {/* Floating "+ New booking" button — visible on Overview / Appointments / Clients */}
      {(tab === "overview" || tab === "appointments" || tab === "clients") && (
        <button
          type="button"
          onClick={() => setManualBookingOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_12px_40px_-8px_rgba(124,58,237,0.55)] transition hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6 sm:h-auto sm:w-auto sm:px-5 sm:py-3 sm:text-sm sm:font-semibold"
          style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          aria-label={t("appointments.newBooking", lang)}
        >
          <Plus className="h-6 w-6 sm:hidden" />
          <span className="hidden sm:inline">+ {t("appointments.newBooking", lang)}</span>
        </button>
      )}

      {manualBookingOpen && (
        <ManualBookingModal
          tenantId={tenantId}
          onClose={() => setManualBookingOpen(false)}
          onCreated={() => {
            apts.refetch();
            todayApts.refetch();
          }}
        />
      )}

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <OnboardingChecklist tenantId={tenantId} />
          {overview.isLoading ? (
            <div className="grid grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="glass-card rounded-2xl h-20 animate-pulse" />)}</div>
          ) : overview.isError ? (
            <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>
          ) : overview.data && (
            <div className="grid grid-cols-2 gap-3">
              {!dashPrefs.hiddenStatCards.includes("todayAppointments") && (
                <StatCard label={t("salon.todayApts", lang)} value={overview.data.todayAppointments} icon={CalendarDays} color="bg-brand-500/20 text-brand-400" />
              )}
              {!dashPrefs.hiddenStatCards.includes("activeMasters") && (
                <StatCard label={t("salon.activeMasters", lang)} value={overview.data.activeMasters} icon={Scissors} color="bg-purple-500/20 text-purple-400" />
              )}
              {!dashPrefs.hiddenStatCards.includes("openTickets") && (
                <StatCard label={t("salon.openTickets", lang)} value={overview.data.openTickets} icon={AlertCircle} color="bg-amber-500/20 text-amber-400" />
              )}
              {!dashPrefs.hiddenStatCards.includes("billingPlan") && (
                <StatCard label={t("billing.plan", lang)} value={overview.data.plan?.toUpperCase() ?? "START"}
                  sub={t(`billing.${overview.data.billingStatus ?? "trialing"}` as any, lang)}
                  icon={CreditCard} color="bg-emerald-500/20 text-emerald-400" />
              )}
            </div>
          )}
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
            </>
          )}
        </div>
      )}

      {/* ── APPOINTMENTS ── */}
      {tab === "appointments" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("salon.appointments", lang)}</h2>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 gap-0.5">
                <button onClick={() => setAptViewMode("calendar")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${aptViewMode === "calendar" ? "bg-brand-500/20 text-brand-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-200"}`}>
                  <CalendarDays className="w-3.5 h-3.5" />
                  {t("salon.cal.calendar", lang)}
                </button>
                <button onClick={() => setAptViewMode("list")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${aptViewMode === "list" ? "bg-brand-500/20 text-brand-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-200"}`}>
                  <List className="w-3.5 h-3.5" />
                  {t("salon.cal.list", lang)}
                </button>
              </div>
            </div>
          </div>

          {aptViewMode === "calendar" && (
            <SalonBigCalendar
              apts={calApts.data ?? []}
              viewDate={calViewDate}
              setViewDate={setCalViewDate}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              isLoading={calApts.isFetching}
              lang={lang}
              onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
              onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })}
            />
          )}

          {aptViewMode === "list" && (
            <>
              {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
              {apts.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
              <div className="space-y-2">
                {apts.data?.map((a: any) => (
                  <AptCard key={a.id} a={a} lang={lang}
                    onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
                    onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })} />
                ))}
                {apts.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noApts", lang)}</p>}
              </div>
            </>
          )}
        </div>
      )}

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
                    <button onClick={() => { if (confirm(t("confirm.deleteService", lang))) deleteSvc.mutate({ tenantId, svcId: s.svcId }); }}
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
              return (
                <div key={m.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-brand-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {(m.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900 dark:text-white text-sm">{m.name ?? `#${m.chatId}`}</p>
                      {isWebAccount && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20">
                          {t("master.webBadge", lang)}
                        </span>
                      )}
                    </div>
                    {!isWebAccount && <p className="text-[10px] text-slate-500">ID: {m.chatId}</p>}
                  </div>
                  <button onClick={() => { if (confirm(t("confirm.removeMaster", lang))) removeMaster.mutate({ tenantId, chatId: m.chatId }); }}
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

      {/* ── BILLING ── */}
      {tab === "billing" && (
        <BillingTabContent tenantId={tenantId} billing={billing} lang={lang} />
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
    </Shell>
  );
}
