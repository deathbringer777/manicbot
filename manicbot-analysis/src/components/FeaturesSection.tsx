import { useLanguage } from "@/i18n";

const iconPaths: Record<string, string> = {
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  brain: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  "credit-card": "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  globe: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
  "calendar-sync": "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  bell: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  users: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  shield: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
};

const gradients = [
  "linear-gradient(135deg,#7c3aed,#a855f7)",
  "linear-gradient(135deg,#06b6d4,#3b82f6)",
  "linear-gradient(135deg,#10b981,#06b6d4)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#a855f7,#ec4899)",
  "linear-gradient(135deg,#3b82f6,#7c3aed)",
  "linear-gradient(135deg,#06b6d4,#10b981)",
  "linear-gradient(135deg,#ec4899,#7c3aed)",
];

export function FeaturesSection() {
  const { t } = useLanguage();

  return (
    <section id="features" className="py-20 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            {t.features.title}
          </h2>
          <p className="text-white/45 max-w-md mx-auto text-sm leading-relaxed">
            {t.features.sub}
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {t.features.items.map((f, i) => (
            <div
              key={f.title}
              className="group rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 cursor-default"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,58,237,0.3)";
                (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.06)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
              }}
            >
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: gradients[i % gradients.length] + "20" }}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  style={{ stroke: `url(#grad-${i})` }}
                >
                  <defs>
                    <linearGradient id={`grad-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={gradients[i % gradients.length]!.match(/#[0-9a-f]+/gi)?.[0] ?? "#7c3aed"} />
                      <stop offset="100%" stopColor={gradients[i % gradients.length]!.match(/#[0-9a-f]+/gi)?.[1] ?? "#06b6d4"} />
                    </linearGradient>
                  </defs>
                  <path strokeLinecap="round" strokeLinejoin="round" d={iconPaths[f.icon] ?? iconPaths.calendar} />
                </svg>
              </div>

              <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-xs text-white/40 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
