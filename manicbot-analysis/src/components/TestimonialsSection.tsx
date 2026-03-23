import { useLanguage } from "@/i18n";

export function TestimonialsSection() {
  const { t } = useLanguage();

  return (
    <section className="py-20 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">{t.testimonials.title}</h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {t.testimonials.items.map((item, i) => (
            <div
              key={i}
              className="rounded-2xl p-6 flex flex-col justify-between transition-all duration-300 hover:-translate-y-1"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {/* Quote */}
              <p className="text-sm text-white/60 leading-relaxed mb-6 italic">
                &ldquo;{item.text}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                  style={{
                    background: [
                      "linear-gradient(135deg,#7c3aed,#a855f7)",
                      "linear-gradient(135deg,#06b6d4,#3b82f6)",
                      "linear-gradient(135deg,#10b981,#06b6d4)",
                    ][i % 3],
                  }}
                >
                  {item.author[0]}
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">{item.author}</p>
                  <p className="text-[11px] text-white/35">{item.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
