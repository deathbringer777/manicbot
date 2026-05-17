// @vitest-environment happy-dom
/**
 * RulesClient — /rules page, 4 locales (ru/ua/en/pl).
 *
 * Pins the contract for the referral footer link target:
 *   * The legal-link footnote rendered under the two referral cards in
 *     ReferralsSection.tsx points to /rules. If this page does NOT have
 *     a "Referral program" section the link is a dead end.
 *   * "Changes to Rules" stays the last section so the doc shape matches
 *     legal-doc convention. The referral block is section 5, "Changes" is 6.
 *   * Each locale carries its own translated section title + body.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { RulesClient } from "~/app/(public)/rules/RulesClient";
import type { Lang } from "~/lib/i18n";

function renderAt(lang: Lang) {
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <RulesClient />
    </LangContext.Provider>,
  );
}

describe("RulesClient — Referral program section", () => {
  const cases: Array<{
    lang: Lang;
    sectionTitle: string;
    monthToken: string;
    discountSnippet: string;
    rewardSnippet: string;
    changesTitle: string;
  }> = [
    {
      lang: "ru",
      sectionTitle: "5. Реферальная программа",
      monthToken: "май",
      discountSnippet: "20% off",
      rewardSnippet: "1 бесплатный месяц",
      changesTitle: "6. Изменения правил",
    },
    {
      lang: "ua",
      sectionTitle: "5. Реферальна програма",
      monthToken: "травень",
      discountSnippet: "20% off",
      rewardSnippet: "1 безкоштовний місяць",
      changesTitle: "6. Зміни правил",
    },
    {
      lang: "en",
      sectionTitle: "5. Referral Program",
      monthToken: "May",
      discountSnippet: "20% off",
      rewardSnippet: "1 free month",
      changesTitle: "6. Changes to Rules",
    },
    {
      lang: "pl",
      sectionTitle: "5. Program polecen",
      monthToken: "maj",
      discountSnippet: "20% znizki",
      rewardSnippet: "1 darmowy miesiac",
      changesTitle: "6. Zmiany zasad",
    },
  ];

  it.each(cases)(
    "[$lang] renders referral section, the reward terms, and renumbered changes section",
    ({ lang, sectionTitle, monthToken, discountSnippet, rewardSnippet, changesTitle }) => {
      const { container, unmount } = renderAt(lang);

      // 1. Updated date contains the new month + 2026
      expect(container.textContent).toContain(monthToken);
      expect(container.textContent).toContain("2026");

      // 2. New 5. Referral section heading exists
      expect(screen.getByRole("heading", { name: sectionTitle, level: 2 })).toBeTruthy();

      // 3. Core reward terms appear in the page body
      expect(container.textContent).toContain(discountSnippet);
      expect(container.textContent).toContain(rewardSnippet);

      // 4. "Changes" section is renumbered to 6 and still last
      const changesHeading = screen.getByRole("heading", { name: changesTitle, level: 2 });
      expect(changesHeading).toBeTruthy();
      const h2s = container.querySelectorAll("h2");
      expect(h2s[h2s.length - 1]?.textContent).toBe(changesTitle);

      // 5. Old "5. Changes / Изменения / ..." must NOT linger — pins clean renumber.
      const stale = within(container).queryByRole("heading", {
        name: changesTitle.replace(/^6\./, "5."),
        level: 2,
      });
      expect(stale).toBeNull();

      unmount();
    },
  );
});
