import { useState } from "react";
import { useLanguage } from "@/i18n";

export function FaqSection() {
  const { t } = useLanguage();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="py-20 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">{t.faq.title}</h2>
        </div>

        <div className="space-y-2">
          {t.faq.items.map((item, i) => (
            <div
              key={i}
              className="rounded-2xl overflow-hidden transition-all duration-200"
              style={{
                background: open === i ? "rgba(124,58,237,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${open === i ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.07)"}`,
              }}
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-4"
              >
                <span className="text-sm font-medium text-white">{item.q}</span>
                <span
                  className="text-lg leading-none flex-shrink-0 transition-transform duration-200"
                  style={{
                    color: "rgba(255,255,255,0.3)",
                    transform: open === i ? "rotate(45deg)" : "rotate(0)",
                  }}
                >
                  +
                </span>
              </button>
              {open === i && (
                <div className="px-5 pb-4">
                  <p className="text-sm text-white/50 leading-relaxed">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
