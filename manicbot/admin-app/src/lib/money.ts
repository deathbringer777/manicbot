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
