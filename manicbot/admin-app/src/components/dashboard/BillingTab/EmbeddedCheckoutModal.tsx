"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { t, type Lang } from "~/lib/i18n";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

export const hasEmbeddedCheckout = !!stripePromise;

interface EmbeddedCheckoutModalProps {
  clientSecret: string | null;
  onClose: () => void;
  lang: Lang;
}

export function EmbeddedCheckoutModal({ clientSecret, onClose, lang }: EmbeddedCheckoutModalProps) {
  useEffect(() => {
    if (!clientSecret) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [clientSecret, onClose]);

  if (!clientSecret) return null;
  if (!stripePromise) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("billing.checkout.title", lang)}
      data-testid="checkout-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("billing.checkout.title", lang)}
          </span>
          <button
            type="button"
            onClick={onClose}
            data-testid="checkout-close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label={t("common.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}
