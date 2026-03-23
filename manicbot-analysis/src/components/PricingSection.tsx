import { useLanguage } from "@/i18n";
import { MANICBOT_TELEGRAM_URL } from "@/constants";

const checkIcon = (
  <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

export function PricingSection() {
  const { t } = useLanguage();

  return (
    <section id="pricing" className="px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-14 text-center">
          <h2 className="mb-3 text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">{t.pricing.title}</h2>
          <p className="text-sm text-slate-600 dark:text-white/45">{t.pricing.sub}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {t.pricing.plans.map((plan) => (
            <div
              key={plan.name}
              className={[
                "relative flex flex-col rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1",
                plan.highlighted
                  ? "border border-violet-300/90 bg-gradient-to-br from-violet-50/90 to-cyan-50/50 shadow-[0_12px_40px_-12px_rgba(124,58,237,0.25)] dark:border-violet-500/40 dark:from-violet-500/[0.15] dark:to-cyan-500/[0.08] dark:shadow-[0_12px_48px_-12px_rgba(124,58,237,0.35)]"
                  : "border border-slate-200/90 bg-white shadow-[0_4px_20px_-8px_rgba(15,23,42,0.08)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-none",
              ].join(" ")}
            >
              {plan.highlighted && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[10px] font-semibold tracking-wide text-white shadow-md"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
                >
                  {t.pricing.popularBadge}
                </div>
              )}

              <div className="mb-5">
                <h3 className="mb-1 text-sm font-semibold text-slate-600 dark:text-white/60">{plan.name}</h3>
                <div className="mb-1 flex items-end gap-1">
                  <span
                    className="font-mono text-4xl font-bold text-slate-900 dark:text-white"
                    style={
                      plan.highlighted
                        ? {
                            background: "linear-gradient(135deg,#6d28d9,#0891b2)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            backgroundClip: "text",
                          }
                        : undefined
                    }
                  >
                    {plan.price}
                  </span>
                  <span className="mb-1 text-sm text-slate-500 dark:text-white/35">{plan.period}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-white/35">{plan.desc}</p>
              </div>

              <ul className="mb-7 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-white/55">
                    <span className={plan.highlighted ? "text-violet-600 dark:text-violet-300" : "text-emerald-600 dark:text-emerald-400"}>
                      {checkIcon}
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <a
                href={MANICBOT_TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={[
                  "block w-full rounded-xl py-3 text-center text-sm font-semibold transition-all duration-200 hover:scale-[1.02] hover:opacity-90",
                  plan.highlighted
                    ? "text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] dark:shadow-[0_8px_28px_-6px_rgba(124,58,237,0.5)]"
                    : "border border-slate-200/90 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/75",
                ].join(" ")}
                style={
                  plan.highlighted
                    ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }
                    : undefined
                }
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
