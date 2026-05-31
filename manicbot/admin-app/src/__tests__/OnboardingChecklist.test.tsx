// @vitest-environment happy-dom
/**
 * OnboardingChecklist — visual state contract.
 *
 * 2026-05-27 rework: the 10-id flat list became a 4 essentials + 4 optional
 * split. Essentials always visible; optional tier is a collapsible
 * disclosure that opens automatically when the user has *started* (1..3
 * essentials done) but not finished, and stays closed otherwise to keep
 * the «0/4» state focused.
 *
 * What this file pins:
 *   * the first incomplete ESSENTIAL step carries `data-next-action="true"`
 *     and the violet pulse halo;
 *   * done steps render strike-through + emerald check;
 *   * progress fill maps to (essentialsDone / 4) — only essentials drive
 *     the headline progress bar;
 *   * the optional tier hides its items behind a disclosure when collapsed;
 *   * 4 / 4 essentials → top label flips to «Готов принимать записи»;
 *   * the whole component disappears only when ALL 8 ids are done;
 *   * fixed click targets — `add_branding` → /settings?section=salon&sub=appearance,
 *     `share_link` → ?tab=public_profile (the two routing bugs the rework
 *     was chartered to fix).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { OnboardingChecklist } from "~/components/dashboard/OnboardingChecklist";

let mockData: { completedSteps: string[]; allCompletedAt: number | null; totalSteps: number } | null;
let mockIsLoading = false;

vi.mock("~/trpc/react", () => ({
  api: {
    onboarding: {
      getStatus: {
        useQuery: () => ({ data: mockData, isLoading: mockIsLoading }),
      },
    },
  },
}));

function renderChecklist() {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <OnboardingChecklist tenantId="t_demo" />
    </LangContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  mockData = null;
  mockIsLoading = false;
  // Clean localStorage so optional-collapse preference doesn't leak between
  // test cases.
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("OnboardingChecklist — empty (0/8) state", () => {
  it("renders the 4 essentials, optional tier collapsed by default", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 8 };
    renderChecklist();

    // Essential rows visible.
    expect(document.querySelector('[data-step-id="connect_bot"]')).not.toBeNull();
    expect(document.querySelector('[data-step-id="add_master"]')).not.toBeNull();
    expect(document.querySelector('[data-step-id="set_master_schedule"]')).not.toBeNull();
    expect(document.querySelector('[data-step-id="add_service"]')).not.toBeNull();

    // Optional rows NOT in the DOM while collapsed (0/4 essentials → closed).
    expect(document.querySelector('[data-step-id="fill_salon_info"]')).toBeNull();
    expect(document.querySelector('[data-step-id="add_branding"]')).toBeNull();
    expect(document.querySelector('[data-step-id="activate_public"]')).toBeNull();
    expect(document.querySelector('[data-step-id="share_link"]')).toBeNull();
  });

  it("first essential carries data-next-action and exactly one pulse halo renders", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 8 };
    renderChecklist();

    const next = document.querySelector('[data-next-action="true"]');
    expect(next?.getAttribute("data-step-id")).toBe("connect_bot");

    const halos = document.querySelectorAll('[data-testid="onboarding-next-halo"]');
    expect(halos.length).toBe(1);
  });

  it("progress bar maps essentials (0/4) to a 4 px anchor", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 8 };
    renderChecklist();
    const fill = screen.getByTestId("onboarding-progress-fill") as HTMLDivElement;
    expect(fill.style.width).toBe("4px");
  });

  it("counter shows essentials progress (0/4), not total (0/8)", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 8 };
    renderChecklist();
    expect(screen.getByTestId("onboarding-counter").textContent).toBe("0/4");
  });
});

describe("OnboardingChecklist — partial (2/4 essentials) state", () => {
  it("opens the optional tier automatically once the user has started but not finished essentials", () => {
    mockData = {
      completedSteps: ["connect_bot", "add_master"],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    // Optional rows now rendered.
    expect(document.querySelector('[data-step-id="fill_salon_info"]')).not.toBeNull();
    expect(document.querySelector('[data-step-id="add_branding"]')).not.toBeNull();
    expect(document.querySelector('[data-step-id="activate_public"]')).not.toBeNull();
    expect(document.querySelector('[data-step-id="share_link"]')).not.toBeNull();
  });

  it("progress bar maps 2/4 to 50 %", () => {
    mockData = {
      completedSteps: ["connect_bot", "add_master"],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    const fill = screen.getByTestId("onboarding-progress-fill") as HTMLDivElement;
    expect(fill.style.width).toBe("50%");
  });

  it("done rows carry line-through; next-action moves to the first incomplete essential", () => {
    mockData = {
      completedSteps: ["connect_bot"],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();

    const doneRow = document.querySelector('[data-step-id="connect_bot"]') as HTMLElement;
    const doneLink = doneRow.querySelector("a") as HTMLAnchorElement;
    expect(doneLink.className).toContain("line-through");

    const next = document.querySelector('[data-next-action="true"]');
    expect(next?.getAttribute("data-step-id")).toBe("add_master");
  });
});

describe("OnboardingChecklist — essentials-done (4/4) state", () => {
  it("top label flips to «Готов принимать записи»", () => {
    mockData = {
      completedSteps: [
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
      ],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    expect(screen.getByTestId("onboarding-headline").textContent).toContain(
      "Готов принимать записи",
    );
  });

  it("counter still uses essentials denominator (4/4)", () => {
    mockData = {
      completedSteps: [
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
      ],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    expect(screen.getByTestId("onboarding-counter").textContent).toBe("4/4");
  });

  it("component is still rendered (only auto-hides when ALL 8 are done)", () => {
    mockData = {
      completedSteps: [
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
      ],
      allCompletedAt: null,
      totalSteps: 8,
    };
    const { container } = renderChecklist();
    expect(container.firstChild).not.toBeNull();
  });

  it("optional tier collapses back to closed when essentials are complete (no nag) — but the disclosure header is clickable", () => {
    mockData = {
      completedSteps: [
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
      ],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    // Closed → optional rows not in the DOM yet.
    expect(document.querySelector('[data-step-id="add_branding"]')).toBeNull();
    // Header carries the toggle.
    const toggle = screen.getByTestId("onboarding-optional-toggle");
    fireEvent.click(toggle);
    // After click, rows render.
    expect(document.querySelector('[data-step-id="add_branding"]')).not.toBeNull();
  });
});

describe("OnboardingChecklist — fixed routing (closes B2 + B3)", () => {
  it("«Логотип и обложка» (add_branding) link points at /settings?section=salon&sub=appearance — NOT the removed /settings?section=public", () => {
    mockData = {
      completedSteps: ["connect_bot", "add_master"], // ensures optional tier auto-opens
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    const row = document.querySelector('[data-step-id="add_branding"]') as HTMLElement;
    const link = row.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings?section=salon&sub=appearance");
  });

  it("«Поделитесь ссылкой» (share_link) link points at ?tab=public_profile — NOT ?tab=channels", () => {
    mockData = {
      completedSteps: ["connect_bot", "add_master"],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    const row = document.querySelector('[data-step-id="share_link"]') as HTMLElement;
    const link = row.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("?tab=public_profile");
  });

  it("«Расписание мастера» (set_master_schedule) link still points at ?tab=masters — but the renamed label removes the ambiguity (closes B1)", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 8 };
    renderChecklist();
    const row = document.querySelector('[data-step-id="set_master_schedule"]') as HTMLElement;
    const link = row.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("?tab=masters");
    // Label no longer reads as «общее расписание салона».
    expect(link.textContent).toContain("Расписание мастера");
  });

  it("fill_salon_info points at /settings?section=salon", () => {
    mockData = {
      completedSteps: ["connect_bot", "add_master"],
      allCompletedAt: null,
      totalSteps: 8,
    };
    renderChecklist();
    const row = document.querySelector('[data-step-id="fill_salon_info"]') as HTMLElement;
    const link = row.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings?section=salon");
  });
});

describe("OnboardingChecklist — completion + loading edges", () => {
  it("renders nothing while loading", () => {
    mockIsLoading = true;
    mockData = null;
    const { container } = renderChecklist();
    expect(container.firstChild).toBeNull();
  });

  it("hides itself only when ALL 8 ids are done", () => {
    mockData = {
      completedSteps: [
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
        "fill_salon_info",
        "add_branding",
        "activate_public",
        "share_link",
      ],
      allCompletedAt: 1700000000,
      totalSteps: 8,
    };
    const { container } = renderChecklist();
    expect(container.firstChild).toBeNull();
  });

  it("does NOT auto-hide on 7/8 (one optional outstanding)", () => {
    mockData = {
      completedSteps: [
        "connect_bot",
        "add_master",
        "set_master_schedule",
        "add_service",
        "fill_salon_info",
        "add_branding",
        "activate_public",
        // share_link missing
      ],
      allCompletedAt: null,
      totalSteps: 8,
    };
    const { container } = renderChecklist();
    expect(container.firstChild).not.toBeNull();
  });
});

describe("OnboardingChecklist — collapse preference persistence", () => {
  it("user-toggled state persists in localStorage", () => {
    mockData = {
      completedSteps: ["connect_bot", "add_master"], // optional tier auto-opens
      allCompletedAt: null,
      totalSteps: 8,
    };
    const { unmount } = renderChecklist();
    // Auto-open path — optional rows visible.
    expect(document.querySelector('[data-step-id="add_branding"]')).not.toBeNull();
    // Click toggle to collapse.
    fireEvent.click(screen.getByTestId("onboarding-optional-toggle"));
    expect(document.querySelector('[data-step-id="add_branding"]')).toBeNull();
    // Persist + remount.
    unmount();
    renderChecklist();
    // Stays collapsed across mounts.
    expect(document.querySelector('[data-step-id="add_branding"]')).toBeNull();
  });
});
