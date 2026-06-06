"use client";

/**
 * RetentionFlow — 3-stage cancellation modal (migration 0086).
 *
 * Stage 1: counter-offer ("stay for -50% / -25%"). If the user is in cooldown
 *          (already accepted an offer in the last 12 months), skip directly
 *          to Stage 2.
 * Stage 2: structured churn reason form + free text + optional photo.
 * Stage 3: red-confirm summary — last chance to back out before the Stripe
 *          cancel_at_period_end flip.
 *
 * Modal stacking: matches the 0062 contract (z-[100] overlay, slate-950/70
 * backdrop-blur-md, solid card, ring-1 ring-black/5). Pinned in
 * `src/__tests__/modal-styling-regression.test.ts`.
 *
 * ESC behaviour: closes on Stage 1 / Stage 2. NOT on Stage 3 — the user must
 * explicitly choose between "Cancel" (close) or "Yes, cancel my subscription"
 * (confirm). Prevents accidentally cancelling by tapping ESC.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Heart, AlertTriangle, Loader2, ImagePlus, Trash2 } from "lucide-react";
import { api } from "~/trpc/react";
import { toast } from "~/lib/toast";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import {
  uploadAssetFile,
  validateUploadFile,
  UPLOAD_ACCEPT_MIME,
} from "~/lib/uploadAsset";

// ─── Reason enum (mirror of router's CANCELLATION_REASON_ENUM) ──────────────
const REASONS = [
  "too_expensive",
  "no_clients",
  "confusing_ui",
  "bad_support",
  "switched_competitor",
  "temporary_break",
  "other",
] as const;
type Reason = (typeof REASONS)[number];

// ─── Localized strings ───────────────────────────────────────────────────────
const LABELS: Record<
  Lang,
  {
    titleOffer: string;
    titleReason: string;
    titleConfirm: string;
    offerHeadingMonthly: string;
    offerHeadingAnnual: string;
    offerBody: string;
    offerAccept: string;
    offerDecline: string;
    reasonHeading: string;
    reasonSub: string;
    reasonLabels: Record<Reason, string>;
    freeTextLabel: string;
    freeTextPlaceholder: string;
    photoLabel: string;
    photoCta: string;
    photoRemove: string;
    back: string;
    next: string;
    confirmHeading: string;
    confirmBody: string;
    confirmTryAgain: string;
    confirmYes: string;
    successAcceptedToast: string;
    successCancelledToast: string;
    errorGeneric: string;
    errorNoSubscription: string;
    errorAlreadyCancelling: string;
    counter: (n: number) => string;
  }
> = {
  ru: {
    titleOffer: "Не уходите так быстро",
    titleReason: "Почему вы отменяете подписку?",
    titleConfirm: "Подтверждение отмены",
    offerHeadingMonthly: "Останьтесь со скидкой -50% на 3 месяца",
    offerHeadingAnnual: "Останьтесь со скидкой -25% на год",
    offerBody:
      "Мы хотим, чтобы вы остались. Возьмите скидку — это разовое предложение, доступное один раз в год.",
    offerAccept: "Принять предложение",
    offerDecline: "Всё равно отменить",
    reasonHeading: "Помогите нам стать лучше",
    reasonSub: "Выберите хотя бы одну причину. Это полностью анонимно.",
    reasonLabels: {
      too_expensive: "Дорого",
      no_clients: "Мало клиентов",
      confusing_ui: "Неудобный интерфейс",
      bad_support: "Плохая поддержка",
      switched_competitor: "Перешёл к конкуренту",
      temporary_break: "Временно приостанавливаю",
      other: "Другое",
    },
    freeTextLabel: "Расскажите подробнее (по желанию)",
    freeTextPlaceholder: "Что бы вас удержало?",
    photoLabel: "Скриншот проблемы (по желанию)",
    photoCta: "Добавить фото",
    photoRemove: "Удалить",
    back: "Назад",
    next: "Далее",
    confirmHeading: "Точно отменить подписку?",
    confirmBody:
      "Подписка останется активной до конца оплаченного периода. После этого бот и панель будут приостановлены.",
    confirmTryAgain: "Назад",
    confirmYes: "Да, отменить",
    successAcceptedToast: "Скидка применена. Спасибо, что остались!",
    successCancelledToast: "Подписка отменена",
    errorGeneric: "Что-то пошло не так. Попробуйте ещё раз.",
    errorNoSubscription: "Активной подписки нет — отменять нечего.",
    errorAlreadyCancelling: "Подписка уже отменяется.",
    counter: (n) => `${n}/2000`,
  },
  ua: {
    titleOffer: "Не йдіть так швидко",
    titleReason: "Чому ви скасовуєте підписку?",
    titleConfirm: "Підтвердження скасування",
    offerHeadingMonthly: "Залишіться зі знижкою -50% на 3 місяці",
    offerHeadingAnnual: "Залишіться зі знижкою -25% на рік",
    offerBody:
      "Ми хочемо, щоб ви залишилися. Візьміть знижку — це разова пропозиція, доступна раз на рік.",
    offerAccept: "Прийняти пропозицію",
    offerDecline: "Все одно скасувати",
    reasonHeading: "Допоможіть нам стати кращими",
    reasonSub: "Виберіть хоча б одну причину. Це повністю анонімно.",
    reasonLabels: {
      too_expensive: "Дорого",
      no_clients: "Мало клієнтів",
      confusing_ui: "Незручний інтерфейс",
      bad_support: "Погана підтримка",
      switched_competitor: "Перейшов до конкурента",
      temporary_break: "Тимчасово зупиняю",
      other: "Інше",
    },
    freeTextLabel: "Розкажіть детальніше (за бажанням)",
    freeTextPlaceholder: "Що б вас утримало?",
    photoLabel: "Скріншот проблеми (за бажанням)",
    photoCta: "Додати фото",
    photoRemove: "Видалити",
    back: "Назад",
    next: "Далі",
    confirmHeading: "Точно скасувати підписку?",
    confirmBody:
      "Підписка залишиться активною до кінця сплаченого періоду. Після цього бот і панель буде призупинено.",
    confirmTryAgain: "Назад",
    confirmYes: "Так, скасувати",
    successAcceptedToast: "Знижку застосовано. Дякуємо, що залишилися!",
    successCancelledToast: "Підписку скасовано",
    errorGeneric: "Щось пішло не так. Спробуйте ще раз.",
    errorNoSubscription: "Активної підписки немає — скасовувати нічого.",
    errorAlreadyCancelling: "Підписку вже скасовано.",
    counter: (n) => `${n}/2000`,
  },
  en: {
    titleOffer: "Don't leave so soon",
    titleReason: "Why are you cancelling?",
    titleConfirm: "Confirm cancellation",
    offerHeadingMonthly: "Stay with -50% off for 3 months",
    offerHeadingAnnual: "Stay with -25% off for a year",
    offerBody:
      "We'd love you to stay. Take the discount — it's a one-time offer, available once per year.",
    offerAccept: "Accept the offer",
    offerDecline: "Cancel anyway",
    reasonHeading: "Help us improve",
    reasonSub: "Pick at least one reason. Fully anonymous.",
    reasonLabels: {
      too_expensive: "Too expensive",
      no_clients: "Not enough clients",
      confusing_ui: "Confusing interface",
      bad_support: "Poor support",
      switched_competitor: "Switched to a competitor",
      temporary_break: "Taking a break",
      other: "Other",
    },
    freeTextLabel: "Tell us more (optional)",
    freeTextPlaceholder: "What would have made you stay?",
    photoLabel: "Screenshot of the problem (optional)",
    photoCta: "Add a photo",
    photoRemove: "Remove",
    back: "Back",
    next: "Next",
    confirmHeading: "Cancel for sure?",
    confirmBody:
      "Your subscription stays active until the end of the current billing period. After that, the bot and dashboard are paused.",
    confirmTryAgain: "Back",
    confirmYes: "Yes, cancel",
    successAcceptedToast: "Discount applied. Thanks for staying!",
    successCancelledToast: "Subscription cancelled",
    errorGeneric: "Something went wrong. Please try again.",
    errorNoSubscription: "There's no active subscription to cancel.",
    errorAlreadyCancelling: "Subscription is already being cancelled.",
    counter: (n) => `${n}/2000`,
  },
  pl: {
    titleOffer: "Nie odchodź tak szybko",
    titleReason: "Dlaczego anulujesz subskrypcję?",
    titleConfirm: "Potwierdź anulowanie",
    offerHeadingMonthly: "Zostań z 50% zniżki na 3 miesiące",
    offerHeadingAnnual: "Zostań z 25% zniżki na rok",
    offerBody:
      "Chcielibyśmy, żebyś został. Skorzystaj ze zniżki — to jednorazowa oferta, dostępna raz w roku.",
    offerAccept: "Skorzystaj ze zniżki",
    offerDecline: "Anuluj mimo to",
    reasonHeading: "Pomóż nam się poprawić",
    reasonSub: "Wybierz co najmniej jeden powód. W pełni anonimowe.",
    reasonLabels: {
      too_expensive: "Za drogo",
      no_clients: "Mało klientów",
      confusing_ui: "Trudny interfejs",
      bad_support: "Słabe wsparcie",
      switched_competitor: "Przeniosłem się do konkurencji",
      temporary_break: "Tymczasowa przerwa",
      other: "Inne",
    },
    freeTextLabel: "Powiedz nam więcej (opcjonalnie)",
    freeTextPlaceholder: "Co by Cię zatrzymało?",
    photoLabel: "Zrzut ekranu problemu (opcjonalnie)",
    photoCta: "Dodaj zdjęcie",
    photoRemove: "Usuń",
    back: "Wstecz",
    next: "Dalej",
    confirmHeading: "Na pewno anulować?",
    confirmBody:
      "Twoja subskrypcja pozostanie aktywna do końca opłaconego okresu. Po tym czasie bot i panel zostaną wstrzymane.",
    confirmTryAgain: "Wstecz",
    confirmYes: "Tak, anuluj",
    successAcceptedToast: "Zniżka zastosowana. Dziękujemy, że zostałeś!",
    successCancelledToast: "Subskrypcja anulowana",
    errorGeneric: "Coś poszło nie tak. Spróbuj ponownie.",
    errorNoSubscription: "Brak aktywnej subskrypcji do anulowania.",
    errorAlreadyCancelling: "Subskrypcja jest już anulowana.",
    counter: (n) => `${n}/2000`,
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────
type Stage = "loading" | "offer" | "reason" | "confirm" | "done";
type OfferType = "monthly_50_3m" | "annual_25_1y";

interface Props {
  tenantId: string;
  onClose: () => void;
  /**
   * Called after a successful cancellation so the parent can refresh
   * `salon.getBillingStatus` (to show the "active until …" cancellation pill).
   */
  onCancelled?: () => void;
  /**
   * Called after a successful offer acceptance so the parent can refresh
   * billing state.
   */
  onRetained?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function RetentionFlow({ tenantId, onClose, onCancelled, onRetained }: Props) {
  const { lang } = useLang();
  const L = LABELS[lang];

  // Eligibility probe runs once when the modal mounts. Until it resolves we
  // show a centered spinner — same modal frame, different body.
  const [stage, setStage] = useState<Stage>("loading");
  const [offerType, setOfferType] = useState<OfferType | null>(null);
  const [eligibleForOffer, setEligibleForOffer] = useState(false);

  // Stage-2 state
  const [reasons, setReasons] = useState<Set<Reason>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestMut = api.billing.requestCancellation.useMutation();
  const acceptMut = api.billing.acceptRetentionOffer.useMutation();
  const confirmMut = api.billing.confirmCancellation.useMutation();
  const mintToken = api.salon.mintUploadToken.useMutation();

  // ── Eligibility probe on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await requestMut.mutateAsync({ tenantId });
        if (cancelled) return;
        setEligibleForOffer(res.eligibleForOffer);
        setOfferType(res.offerType);
        // If user is in cooldown OR no offer applies, skip Stage 1.
        setStage(res.eligibleForOffer && res.offerType ? "offer" : "reason");
      } catch (err) {
        if (cancelled) return;
        // The probe rejected. Surface the real reason instead of swallowing it
        // into a generic toast — the cancel button is now gated on a real
        // subscription, so reaching here at all signals a stale UI state worth
        // naming. The BillingSection reflects the actual state on next refetch.
        const msg = err instanceof Error ? err.message : "";
        const friendly =
          msg.includes("already_cancelling")
            ? L.errorAlreadyCancelling
            : msg.includes("no_active_subscription") || msg.includes("stripe_subscription_missing")
              ? L.errorNoSubscription
              : L.errorGeneric;
        toast.error(friendly);
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // ── ESC handling — disabled on Stage 3 ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stage === "confirm") return; // disabled on Stage 3 — must be explicit
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  // ── Photo upload ────────────────────────────────────────────────────────
  const handlePhotoPick = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const valErr = validateUploadFile(file);
    if (valErr) {
      toast.error(valErr);
      return;
    }
    setPhotoUploading(true);
    try {
      const { uploadUrl } = await mintToken.mutateAsync({
        tenantId,
        kind: "cancellation_feedback",
      });
      const uploaded = await uploadAssetFile(uploadUrl, file);
      setPhotoUrl(uploaded.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L.errorGeneric);
    } finally {
      setPhotoUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [tenantId, mintToken, L.errorGeneric]);

  // ── Stage 1 actions ─────────────────────────────────────────────────────
  const handleAcceptOffer = useCallback(async () => {
    if (!offerType) return;
    try {
      await acceptMut.mutateAsync({ tenantId, offerType });
      toast.success(L.successAcceptedToast);
      onRetained?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L.errorGeneric);
    }
  }, [offerType, tenantId, acceptMut, L, onRetained, onClose]);

  const handleDeclineOffer = useCallback(() => {
    setStage("reason");
  }, []);

  // ── Stage 2 actions ─────────────────────────────────────────────────────
  const toggleReason = useCallback((r: Reason) => {
    setReasons((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }, []);

  const canAdvanceToConfirm = reasons.size >= 1;

  const handleAdvanceToConfirm = useCallback(() => {
    if (!canAdvanceToConfirm) return;
    setStage("confirm");
  }, [canAdvanceToConfirm]);

  const handleBackFromReason = useCallback(() => {
    // If there was no offer (cooldown), the only way out is to close.
    // Otherwise rewind to the offer card.
    if (eligibleForOffer && offerType) setStage("offer");
    else onClose();
  }, [eligibleForOffer, offerType, onClose]);

  // ── Stage 3 action ──────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    try {
      await confirmMut.mutateAsync({
        tenantId,
        reasonTags: Array.from(reasons),
        freeText: freeText.trim() || undefined,
        photoUrl: photoUrl ?? undefined,
        retentionOfferShown: eligibleForOffer,
      });
      toast.success(L.successCancelledToast);
      onCancelled?.();
      setStage("done");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L.errorGeneric);
    }
  }, [
    tenantId,
    reasons,
    freeText,
    photoUrl,
    eligibleForOffer,
    confirmMut,
    L,
    onCancelled,
    onClose,
  ]);

  const offerHeading = useMemo(() => {
    if (offerType === "annual_25_1y") return L.offerHeadingAnnual;
    return L.offerHeadingMonthly;
  }, [offerType, L]);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      onClick={(e) => {
        // Click on overlay closes — but only on Stage 1/2.
        if (e.target !== e.currentTarget) return;
        if (stage === "confirm") return;
        onClose();
      }}
      data-testid="retention-flow-overlay"
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-black/5 shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {stage === "offer" && L.titleOffer}
            {stage === "reason" && L.titleReason}
            {stage === "confirm" && L.titleConfirm}
            {(stage === "loading" || stage === "done") && " "}
          </span>
          {stage !== "confirm" && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close"
              data-testid="retention-flow-close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {stage === "loading" && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          )}

          {stage === "offer" && (
            <div className="space-y-4" data-testid="stage-offer">
              <div className="flex items-start gap-3">
                <Heart className="h-6 w-6 text-rose-500 shrink-0 mt-1" />
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {offerHeading}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                    {L.offerBody}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleAcceptOffer}
                  disabled={acceptMut.isPending}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold text-sm hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  data-testid="offer-accept-btn"
                >
                  {acceptMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : (
                    L.offerAccept
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDeclineOffer}
                  className="w-full py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  data-testid="offer-decline-btn"
                >
                  {L.offerDecline}
                </button>
              </div>
            </div>
          )}

          {stage === "reason" && (
            <div className="space-y-4" data-testid="stage-reason">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {L.reasonHeading}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{L.reasonSub}</p>
              </div>

              <div className="flex flex-col gap-2">
                {REASONS.map((r) => {
                  const checked = reasons.has(r);
                  return (
                    <label
                      key={r}
                      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                        checked
                          ? "border-brand-500/40 bg-brand-500/10"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleReason(r)}
                        className="mt-0.5 accent-brand-500"
                        data-testid={`reason-${r}`}
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-200">
                        {L.reasonLabels[r]}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {L.freeTextLabel}
                </label>
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value.slice(0, 2000))}
                  placeholder={L.freeTextPlaceholder}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none resize-none"
                  data-testid="reason-free-text"
                />
                <div className="text-right text-[10px] text-slate-400 mt-0.5">
                  {L.counter(freeText.length)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {L.photoLabel}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT_MIME.join(",")}
                  className="hidden"
                  onChange={handlePhotoPick}
                  data-testid="reason-photo-input"
                />
                {photoUrl ? (
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                    <img
                      src={photoUrl}
                      alt=""
                      className="h-12 w-12 rounded-md object-cover shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoUrl(null)}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600"
                      data-testid="reason-photo-remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {L.photoRemove}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photoUploading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400 hover:border-brand-500 hover:text-brand-500 disabled:opacity-50 transition-colors"
                    data-testid="reason-photo-add"
                  >
                    {photoUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <ImagePlus className="h-4 w-4" />
                        {L.photoCta}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {stage === "confirm" && (
            <div className="space-y-4" data-testid="stage-confirm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-1" />
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {L.confirmHeading}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                    {L.confirmBody}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer (buttons) */}
        {stage === "reason" && (
          <div className="flex gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handleBackFromReason}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              data-testid="reason-back-btn"
            >
              {L.back}
            </button>
            <button
              type="button"
              onClick={handleAdvanceToConfirm}
              disabled={!canAdvanceToConfirm}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white font-semibold text-sm hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="reason-next-btn"
            >
              {L.next}
            </button>
          </div>
        )}

        {stage === "confirm" && (
          <div className="flex gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setStage("reason")}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              data-testid="confirm-back-btn"
            >
              {L.confirmTryAgain}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmMut.isPending}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              data-testid="confirm-yes-btn"
            >
              {confirmMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              ) : (
                L.confirmYes
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RetentionFlow;
