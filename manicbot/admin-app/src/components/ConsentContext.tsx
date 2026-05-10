"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type ConsentCategories,
  type CookieConsentRecord,
  POLICY_VERSION,
  buildCategoriesAcceptAll,
  buildCategoriesRejectAll,
  getOrCreateAnonymousId,
  readCookieConsent,
  writeCookieConsent,
} from "~/lib/cookieConsentStorage";
import { api } from "~/trpc/react";

/**
 * The "true" state of consent lives server-side in cookie_consent_log. This
 * context exposes a *cached read* of the latest local decision plus helpers
 * to set it. Anything that loads a third-party script must:
 *   1. Call useConsent()
 *   2. Check the relevant category boolean
 *   3. AND verify on the server that a matching cookie_consent_log row exists
 *      (the second check happens in the worker /api/track endpoint).
 *
 * Consent state defaults to ALL FALSE (except `necessary`) until the user has
 * explicitly chosen. We never load analytics or marketing scripts under an
 * unknown state — the absence of a decision is not consent.
 */
type ConsentSource = "banner" | "settings" | "api" | "accept_all" | "reject_all";

type ConsentContextValue = {
  decided: boolean;
  categories: ConsentCategories;
  policyVersion: string;
  acceptAll: () => void;
  rejectAll: () => void;
  setCategories: (cats: ConsentCategories, source?: ConsentSource) => void;
};

const DEFAULT_CATEGORIES: ConsentCategories = {
  necessary: true,
  analytics: false,
  marketing: false,
  ux: false,
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = useState<CookieConsentRecord | null>(null);
  const recordMutation = api.consent.record.useMutation();

  useEffect(() => {
    setRecord(readCookieConsent());
  }, []);

  const persistAndAudit = useCallback(
    (cats: ConsentCategories, source: ConsentSource) => {
      const written = writeCookieConsent(cats);
      setRecord(written);
      // Fire-and-forget server audit. localStorage write happens regardless;
      // a failed audit just means we miss the log entry — never block the UX.
      try {
        const anonymousId = getOrCreateAnonymousId();
        recordMutation.mutate({
          anonymousId,
          categories: written.categories,
          policyVersion: written.policyVersion,
          source,
        });
      } catch {
        /* noop */
      }
    },
    [recordMutation],
  );

  const acceptAll = useCallback(() => {
    persistAndAudit(buildCategoriesAcceptAll(), "accept_all");
  }, [persistAndAudit]);

  const rejectAll = useCallback(() => {
    persistAndAudit(buildCategoriesRejectAll(), "reject_all");
  }, [persistAndAudit]);

  const setCategories = useCallback(
    (cats: ConsentCategories, source: ConsentSource = "settings") => {
      persistAndAudit(cats, source);
    },
    [persistAndAudit],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({
      decided: record !== null,
      categories: record?.categories ?? DEFAULT_CATEGORIES,
      policyVersion: record?.policyVersion ?? POLICY_VERSION,
      acceptAll,
      rejectAll,
      setCategories,
    }),
    [record, acceptAll, rejectAll, setCategories],
  );

  return (
    <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (ctx) return ctx;
  // Outside the provider (build-time / tests) — return safe defaults that
  // never grant consent. A consumer that calls acceptAll/rejectAll here is a
  // no-op, which is the correct behaviour for SSR snapshots.
  return {
    decided: false,
    categories: DEFAULT_CATEGORIES,
    policyVersion: POLICY_VERSION,
    acceptAll: () => undefined,
    rejectAll: () => undefined,
    setCategories: () => undefined,
  };
}
