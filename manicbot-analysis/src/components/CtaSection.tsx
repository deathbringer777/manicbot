import { useLanguage } from "@/i18n";
import { MANICBOT_TELEGRAM_URL } from "@/constants";

export function CtaSection() {
  const { t } = useLanguage();

  return (
    <section className="py-20 px-4">
      <div className="max-w-3xl mx-auto text-center relative">
        <div
          className="rounded-3xl p-10 sm:p-16 relative overflow-hidden"
          style={{
            background: "linear-gradient(145deg,rgba(124,58,237,0.15),rgba(6,182,212,0.08))",
            border: "1px solid rgba(124,58,237,0.25)",
          }}
        >
          {/* Background glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(124,58,237,0.2) 0%, transparent 70%)",
            }}
          />

          <h2 className="relative text-3xl sm:text-4xl font-bold text-white mb-4">
            {t.cta.title}
          </h2>
          <p className="relative text-white/50 text-sm mb-8 max-w-md mx-auto leading-relaxed">
            {t.cta.sub}
          </p>
          <a
            href={MANICBOT_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="relative inline-flex items-center justify-center px-8 py-4 rounded-2xl font-semibold text-white text-sm transition-all duration-200 hover:opacity-90 hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
              boxShadow: "0 0 40px rgba(124,58,237,0.4)",
            }}
          >
            {t.cta.button}
          </a>
        </div>
      </div>
    </section>
  );
}
