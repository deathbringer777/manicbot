import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "@/i18n";

export function Header() {
  const { t } = useLanguage();

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: "rgba(5,8,18,0.8)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-base font-bold text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            M
          </div>
          <span className="font-bold text-white text-sm tracking-tight">ManicBot</span>
        </div>

        {/* Nav links (desktop) */}
        <nav className="hidden md:flex items-center gap-6">
          {[
            { label: t.nav.features, id: "features" },
            { label: t.nav.howItWorks, id: "how" },
            { label: t.nav.pricing, id: "pricing" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              className="text-sm text-white/50 hover:text-white transition-colors duration-150"
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <button
            onClick={() => scrollTo("pricing")}
            className="hidden sm:flex items-center px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all duration-200 hover:opacity-90 hover:scale-[1.02]"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            {t.nav.cta}
          </button>
        </div>
      </div>
    </header>
  );
}
