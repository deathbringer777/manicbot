import { useLanguage } from "@/i18n";

export function HowSection() {
  const { t } = useLanguage();

  return (
    <section id="how" className="py-20 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">{t.how.title}</h2>
        </div>

        <div className="relative">
          {/* Connector line */}
          <div
            className="absolute left-[39px] top-10 bottom-10 w-px hidden sm:block"
            style={{ background: "linear-gradient(to bottom, rgba(124,58,237,0.3), rgba(6,182,212,0.3), transparent)" }}
          />

          <div className="space-y-6">
            {t.how.steps.map((step, i) => (
              <div key={step.num} className="flex gap-6 group">
                {/* Number circle */}
                <div className="flex-shrink-0 relative">
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold font-mono transition-all duration-300 group-hover:scale-105"
                    style={{
                      background: i === 0
                        ? "linear-gradient(135deg,rgba(124,58,237,0.2),rgba(168,85,247,0.15))"
                        : i === 1
                        ? "linear-gradient(135deg,rgba(6,182,212,0.15),rgba(59,130,246,0.15))"
                        : "linear-gradient(135deg,rgba(16,185,129,0.15),rgba(6,182,212,0.15))",
                      border: `1px solid ${i === 0 ? "rgba(124,58,237,0.3)" : i === 1 ? "rgba(6,182,212,0.3)" : "rgba(16,185,129,0.3)"}`,
                      color: i === 0 ? "#a78bfa" : i === 1 ? "#67e8f9" : "#6ee7b7",
                    }}
                  >
                    {step.num}
                  </div>
                </div>

                {/* Content */}
                <div
                  className="flex-1 rounded-2xl p-6 transition-all duration-300 group-hover:-translate-y-0.5"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <h3 className="text-base font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-sm text-white/45 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
