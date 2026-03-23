import { useLanguage } from "@/i18n";
import { MANICBOT_TELEGRAM_URL } from "@/constants";

const checkIcon = (
  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

export function PricingSection() {
  const { t } = useLanguage();

  return (
    <section id="pricing" className="py-20 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">{t.pricing.title}</h2>
          <p className="text-white/45 text-sm">{t.pricing.sub}</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {t.pricing.plans.map((plan) => (
            <div
              key={plan.name}
              className="relative rounded-2xl p-6 flex flex-col transition-all duration-300 hover:-translate-y-1"
              style={
                plan.highlighted
                  ? {
                      background: "linear-gradient(145deg,rgba(124,58,237,0.15),rgba(6,182,212,0.08))",
                      border: "1px solid rgba(124,58,237,0.4)",
                      boxShadow: "0 0 40px rgba(124,58,237,0.15)",
                    }
                  : {
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }
              }
            >
              {plan.highlighted && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[10px] font-semibold tracking-wide text-white"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
                >
                  {t.pricing.popularBadge}
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-sm font-semibold text-white/70 mb-1">{plan.name}</h3>
                <div className="flex items-end gap-1 mb-1">
                  <span
                    className="text-4xl font-bold font-mono"
                    style={
                      plan.highlighted
                        ? {
                            background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            backgroundClip: "text",
                          }
                        : { color: "white" }
                    }
                  >
                    {plan.price}
                  </span>
                  <span className="text-white/35 text-sm mb-1">{plan.period}</span>
                </div>
                <p className="text-xs text-white/35">{plan.desc}</p>
              </div>

              <ul className="space-y-2.5 mb-7 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-xs text-white/60">
                    <span style={{ color: plan.highlighted ? "#a78bfa" : "#4ade80" }}>
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
                className="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 hover:opacity-90 hover:scale-[1.02] text-center block"
                style={
                  plan.highlighted
                    ? {
                        background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
                        color: "white",
                        boxShadow: "0 0 20px rgba(124,58,237,0.3)",
                      }
                    : {
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.7)",
                      }
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
