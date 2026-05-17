// @vitest-environment happy-dom
/**
 * Button + Pill primitive contrast contract.
 *
 * Asserts that every tone × variant combination renders a class string with
 * BOTH a light-mode utility AND a `dark:` variant — the contract that
 * prevents the 2026-05-16 HelpSection pale-on-pale regression.
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  Button,
  type ButtonTone,
  type ButtonVariant,
  type ButtonSize,
} from "~/components/ui/Button";
import {
  Pill,
  type PillTone,
  type PillVariant,
  type PillSize,
} from "~/components/ui/Pill";

const BUTTON_TONES: ButtonTone[] = [
  "brand",
  "accent",
  "emerald",
  "amber",
  "red",
  "violet",
  "sky",
  "slate",
  "neutral",
];
const BUTTON_VARIANTS: ButtonVariant[] = ["solid", "soft", "outline", "ghost"];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];

const PILL_TONES: PillTone[] = [...BUTTON_TONES];
const PILL_VARIANTS: PillVariant[] = ["soft", "solid", "outline"];
const PILL_SIZES: PillSize[] = ["xs", "sm", "md"];

afterEach(() => cleanup());

describe("Button primitive", () => {
  it("sets data-tone / data-variant / data-size attributes", () => {
    const { getByRole } = render(
      <Button tone="violet" variant="soft" size="md">click</Button>,
    );
    const el = getByRole("button");
    expect(el.getAttribute("data-tone")).toBe("violet");
    expect(el.getAttribute("data-variant")).toBe("soft");
    expect(el.getAttribute("data-size")).toBe("md");
  });

  for (const tone of BUTTON_TONES) {
    for (const variant of BUTTON_VARIANTS) {
      it(`tone=${tone} variant=${variant} ships both a light AND a dark class`, () => {
        const { getByRole } = render(
          <Button tone={tone} variant={variant}>x</Button>,
        );
        const cls = getByRole("button").className;
        // Light mode: must have at least one non-`dark:` utility that sets a color.
        // (We accept text-, bg-, border-, hover:bg-, hover:text-.)
        const hasLight =
          /\b(?:text|bg|border)-[a-z]+-(?:50|100|200|300|400|500|600|700|800|900)\b/.test(cls) ||
          /\b(?:text|bg|border)-white\b/.test(cls) ||
          /\btext-transparent\b/.test(cls);
        // Dark mode: must have at least one `dark:` utility.
        const hasDark = /\bdark:/.test(cls);
        if (!hasLight || !hasDark) {
          throw new Error(
            `tone=${tone} variant=${variant} missing pair. Class: ${cls}`,
          );
        }
        expect(hasLight && hasDark).toBe(true);
      });
    }
  }

  for (const size of BUTTON_SIZES) {
    it(`size=${size} sets the data-size attribute`, () => {
      const { getByRole } = render(<Button size={size}>x</Button>);
      expect(getByRole("button").getAttribute("data-size")).toBe(size);
    });
  }
});

describe("Pill primitive", () => {
  it("sets data-tone / data-variant / data-size attributes", () => {
    const { container } = render(
      <Pill tone="amber" variant="soft" size="xs">badge</Pill>,
    );
    const el = container.querySelector("span")!;
    expect(el.getAttribute("data-tone")).toBe("amber");
    expect(el.getAttribute("data-variant")).toBe("soft");
    expect(el.getAttribute("data-size")).toBe("xs");
  });

  for (const tone of PILL_TONES) {
    for (const variant of PILL_VARIANTS) {
      it(`tone=${tone} variant=${variant} ships both a light AND a dark class`, () => {
        const { container } = render(
          <Pill tone={tone} variant={variant}>x</Pill>,
        );
        const cls = container.querySelector("span")!.className;
        const hasLight =
          /\b(?:text|bg|border)-[a-z]+-(?:50|100|200|300|400|500|600|700|800|900)\b/.test(cls) ||
          /\b(?:text|bg|border)-white\b/.test(cls);
        const hasDark = /\bdark:/.test(cls);
        if (!hasLight || !hasDark) {
          throw new Error(
            `Pill tone=${tone} variant=${variant} missing pair. Class: ${cls}`,
          );
        }
        expect(hasLight && hasDark).toBe(true);
      });
    }
  }

  for (const size of PILL_SIZES) {
    it(`size=${size} sets the data-size attribute`, () => {
      const { container } = render(<Pill size={size}>x</Pill>);
      expect(container.querySelector("span")!.getAttribute("data-size")).toBe(size);
    });
  }
});

describe("Button — soft variant uses light text on light bg in LIGHT mode (regression for HelpSection 2026-05-16)", () => {
  // The exact bug: text-{c}-200 on bg-{c}-500/10 was invisible in light theme.
  // The fix: soft variant must ship explicit light-mode text-{c}-700/800 (dark text)
  // alongside light bg-{c}-50, and pair them with dark:text-{c}-200 + dark:bg-{c}-500/15.
  for (const tone of ["brand", "violet", "emerald", "amber", "red"] as const) {
    it(`soft tone=${tone} has explicit dark text in light theme`, () => {
      const { getByRole } = render(
        <Button tone={tone} variant="soft">x</Button>,
      );
      const cls = getByRole("button").className;
      // Dark text shade (700+) must appear WITHOUT a dark: prefix.
      const darkTextInLight = new RegExp(
        `(?:^|\\s)(?!dark:)text-${tone}-(?:700|800|900)\\b`,
      );
      expect(cls).toMatch(darkTextInLight);
    });
  }
});
