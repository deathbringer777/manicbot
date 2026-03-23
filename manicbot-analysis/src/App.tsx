import { LanguageProvider } from "@/i18n";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { FeaturesSection } from "@/components/FeaturesSection";
import { HowSection } from "@/components/HowSection";
import { PricingSection } from "@/components/PricingSection";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { FaqSection } from "@/components/FaqSection";
import { CtaSection } from "@/components/CtaSection";
import { Footer } from "@/components/Footer";

function Landing() {
  return (
    <div
      className="min-h-screen text-white antialiased relative overflow-x-hidden"
      style={{ background: "#050812", fontFamily: "Space Grotesk, sans-serif" }}
    >
      {/* Background orbs */}
      <div
        className="fixed pointer-events-none"
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
        className="fixed pointer-events-none"
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
        <Header />
        <HeroSection />
        <FeaturesSection />
        <HowSection />
        <TestimonialsSection />
        <PricingSection />
        <FaqSection />
        <CtaSection />
        <Footer />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <Landing />
    </LanguageProvider>
  );
}
