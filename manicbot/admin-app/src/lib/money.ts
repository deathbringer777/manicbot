/** Plan prices for MRR / billing overview — amounts are in PLN (Stripe products must match). */
export const PLAN_PRICES_PLN: Record<string, number> = {
  start: 45,
  pro: 60,
  max: 90,
};

/** Whole złoty, Polish grouping — used across admin UI. */
export function formatPlnWhole(amount: number): string {
  return (
    new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency: "PLN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  );
}

/**
 * Stripe minor units (PLN grosze) → localized currency string with decimals.
 * The God Mode Billing dashboard's real-money widgets carry Stripe amounts in
 * minor units end to end; `locale` should come from i18n `localeFor(lang)`.
 */
export function formatMinorPln(minorUnits: number, locale = "pl-PL", currency = "PLN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((minorUnits ?? 0) / 100);
}
