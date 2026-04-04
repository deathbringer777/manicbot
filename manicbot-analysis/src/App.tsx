import { ThemeProvider } from "@/theme/ThemeProvider";
import { LanguageProvider } from "@/i18n";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { FeaturesSection } from "@/components/FeaturesSection";
import { ChannelsSection } from "@/components/ChannelsSection";
import { HowSection } from "@/components/HowSection";
import { CompareSection } from "@/components/CompareSection";
import { PricingSection } from "@/components/PricingSection";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { FaqSection } from "@/components/FaqSection";
import { CtaSection } from "@/components/CtaSection";
import { Footer } from "@/components/Footer";
import { SeoHead } from "@/components/SeoHead";
import { LegalPage } from "@/pages/LegalPage";

const LEGAL_ROUTES: Record<string, string> = {
  "/privacy": "privacy",
  "/terms": "terms",
  "/cookies": "cookies",
  "/support": "support",
};

function Landing() {
  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900 antialiased dark:bg-[#050812] dark:text-white"
      style={{ fontFamily: "Space Grotesk, sans-serif" }}
    >
      <div
        className="pointer-events-none fixed dark:hidden"
        style={{
          top: "-12%",
          right: "-10%",
          width: "65vw",
          height: "65vw",
          background: "radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 62%)",
          filter: "blur(72px)",
          zIndex: 0,
        }}
      />
      <div
        className="pointer-events-none fixed dark:hidden"
        style={{
          bottom: "5%",
          left: "-15%",
          width: "55vw",
          height: "55vw",
          background: "radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 62%)",
          filter: "blur(72px)",
          zIndex: 0,
        }}
      />
      <div
        className="pointer-events-none fixed hidden dark:block"
        style={{
          top: "-15%",
          right: "-15%",
          width: "70vw",
          height: "70vw",
          background: "radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 65%)",
          filter: "blur(80px)",
          zIndex: 0,
        }}
      />
      <div
        className="pointer-events-none fixed hidden dark:block"
        style={{
          bottom: "10%",
          left: "-20%",
          width: "60vw",
          height: "60vw",
          background: "radial-gradient(circle, rgba(6,182,212,0.07) 0%, transparent 65%)",
          filter: "blur(80px)",
          zIndex: 0,
        }}
      />

      <div className="relative z-10">
        <SeoHead />
        <Header />
        <HeroSection />
        <FeaturesSection />
        <ChannelsSection />
        <HowSection />
        <TestimonialsSection />
        <CompareSection />
        <PricingSection />
        <FaqSection />
        <CtaSection />
        <Footer />
      </div>
    </div>
  );
}

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const legalPage = LEGAL_ROUTES[path];

  return (
    <ThemeProvider>
      <LanguageProvider>
        {legalPage ? <LegalPage page={legalPage} /> : <Landing />}
      </LanguageProvider>
    </ThemeProvider>
  );
}
