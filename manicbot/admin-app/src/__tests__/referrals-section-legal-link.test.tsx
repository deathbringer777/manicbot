// @vitest-environment happy-dom
/**
 * ReferralsSection — legal-link footnote under the two reward cards.
 *
 * Pins the user-visible contract behind the small grey footnote that
 * appears under "Друг получает" / "Вы получаете":
 *   * Renders a <a href="/rules"> with target="_blank" + rel="noopener
 *     noreferrer" (standard outbound-to-ToS link). Removing target/rel
 *     would re-introduce the tabnabbing risk on the referral page.
 *   * Both the "В соответствии с " prefix and the "правилами пользования"
 *     link text translate per locale and stay distinct (no fallthrough
 *     to the COPY key name).
 *   * The footnote sits inside the Share Card section, so it only renders
 *     when the user actually sees the reward cards (forbidden state hides
 *     the entire Share Card and therefore the footnote too).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ReferralsSection } from "~/components/settings/sections/ReferralsSection";
import type { Lang } from "~/lib/i18n";

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      referrals: {
        getMyDashboard: { invalidate: vi.fn() },
      },
    }),
    referrals: {
      getMyDashboard: {
        useQuery: () => ({
          data: {
            code: "TEST-CODE",
            shareUrl: "https://manicbot.com/r/TEST-CODE",
            invited: [],
            rewards: [],
            counters: {
              pending: 0,
              firstPaid: 0,
              rewarded: 0,
              invalidated: 0,
              clawback: 0,
              totalEarnedGrosz: 0,
              monthsUsedInRollingYear: 0,
              monthsRemainingInCap: 6,
            },
          },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      rotateMyCode: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

function renderAt(lang: Lang) {
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <ReferralsSection />
    </LangContext.Provider>,
  );
}

afterEach(() => cleanup());

describe("ReferralsSection — legal-link footnote", () => {
  const cases: Array<{ lang: Lang; prefix: string; linkText: string }> = [
    { lang: "ru", prefix: "В соответствии с", linkText: "правилами пользования" },
    { lang: "ua", prefix: "Згідно з", linkText: "правилами користування" },
    { lang: "en", prefix: "As described in the", linkText: "terms of use" },
    { lang: "pl", prefix: "Zgodnie z", linkText: "zasadami korzystania" },
  ];

  it.each(cases)("[$lang] renders translated prefix + link text", ({ lang, prefix, linkText }) => {
    const { container, unmount } = renderAt(lang);
    // Prefix is plain text adjacent to the anchor
    expect(container.textContent).toContain(prefix);
    // Link visible text is the translated linkText
    const link = screen.getByRole("link", { name: linkText });
    expect(link).toBeTruthy();
    unmount();
  });

  it("link points to /rules, opens in a new tab, with noopener+noreferrer", () => {
    renderAt("ru");
    const link = screen.getByRole("link", { name: "правилами пользования" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/rules");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("renders the footnote inside the Share Card (with both reward cards visible)", () => {
    const { container } = renderAt("ru");
    // Sanity: the two reward cards are visible — they're the parents of the footnote
    expect(container.textContent).toContain("Друг получает");
    expect(container.textContent).toContain("Вы получаете");
    // And the legal-link footnote sits below them
    expect(screen.getByRole("link", { name: "правилами пользования" })).toBeTruthy();
  });
});
