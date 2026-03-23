import { useLanguage } from "@/i18n";
import { TelegramPhoneDemo } from "./TelegramPhoneDemo";

export function HeroSection() {
  const { t } = useLanguage();

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="relative pt-28 pb-16 sm:pb-24 px-4 overflow-hidden">
      {/* Soft grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(124,58,237,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(124,58,237,0.04) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 30%, transparent 100%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-[1fr_minmax(260px,320px)] gap-12 lg:gap-16 items-center">
          {/* Copy */}
          <div className="text-center lg:text-left order-2 lg:order-1">
            <div className="inline-flex lg:flex mb-5">
              <span
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: "rgba(124,58,237,0.1)",
                  border: "1px solid rgba(124,58,237,0.22)",
                  color: "#c4b5fd",
                }}
              >
                {t.hero.badge}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-bold tracking-tight leading-[1.08] mb-4 text-white">
              {t.hero.headline}{" "}
              <span
                className="block sm:inline lg:block mt-1 sm:mt-0"
                style={{
                  background: "linear-gradient(135deg,#a78bfa 0%,#67e8f9 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t.hero.headlineAccent}
              </span>
            </h1>

            <p className="text-base sm:text-lg text-white/50 leading-relaxed max-w-xl mx-auto lg:mx-0 mb-8">
              {t.hero.sub}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mb-8">
              <button
                type="button"
                onClick={() => scrollTo("how")}
                className="w-full sm:w-auto px-7 py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-200 hover:opacity-95 hover:scale-[1.02]"
                style={{
                  background: "linear-gradient(135deg,#6d28d9,#0891b2)",
                  boxShadow: "0 12px 40px rgba(109,40,217,0.25)",
                }}
              >
                {t.hero.ctaPrimary}
              </button>
              <button
                type="button"
                onClick={() => scrollTo("pricing")}
                className="w-full sm:w-auto px-7 py-3.5 rounded-2xl font-medium text-sm transition-all duration-200 hover:bg-white/6"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.75)",
                }}
              >
                {t.hero.ctaSecondary}
              </button>
            </div>

            <p className="text-xs text-white/30 mb-8 lg:mb-0">{t.hero.trustLine}</p>

            {/* Stats — compact row */}
            <div className="flex flex-wrap justify-center lg:justify-start gap-2">
              {t.stats.map((s, i) => (
                <div
                  key={i}
                  className="px-3 py-2 rounded-xl text-left"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <span
                    className="text-lg font-bold font-mono"
                    style={{
                      background: "linear-gradient(135deg,#a78bfa,#5eead4)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    {s.value}
                  </span>
                  <span className="block text-[10px] text-white/35 mt-0.5">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Phone demo */}
          <div
            id="demo"
            className="flex justify-center lg:justify-end order-1 lg:order-2 pt-2"
          >
            <div className="relative w-full max-w-[300px]">
              <p className="text-center lg:text-right text-[11px] text-white/35 mb-3 font-medium tracking-wide uppercase">
                {t.hero.demoCaption}
              </p>
              <TelegramPhoneDemo />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
