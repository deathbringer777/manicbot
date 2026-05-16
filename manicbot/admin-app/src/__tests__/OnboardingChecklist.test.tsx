// @vitest-environment happy-dom
/**
 * OnboardingChecklist — visual state contract.
 *
 * Locks in the 2026-05-16 «wake up the 0/10 state» polish:
 *   * the first incomplete step carries `data-next-action="true"` and the
 *     violet pulse halo;
 *   * done steps render strike-through + emerald check;
 *   * upcoming steps render visible outline circles (border-2);
 *   * progress bar gets a 4-px anchor at 0/10 so it's never invisible,
 *     and a proportional `width: NN%` at partial progress;
 *   * the whole component hides itself once everything is done.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});

describe("OnboardingChecklist — 0/10 (empty) state", () => {
  it("first step carries data-next-action and a pulse halo", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 10 };
    renderChecklist();

    const items = screen.getAllByRole("listitem");
    const first = items[0]!;
    expect(first.getAttribute("data-next-action")).toBe("true");
    expect(first.getAttribute("data-step-id")).toBe("add_service");

    // Halo only on the next-action row (not on subsequent rows).
    const halos = document.querySelectorAll('[data-testid="onboarding-next-halo"]');
    expect(halos.length).toBe(1);
    expect(halos[0]!.className).toContain("animate-pulse");
  });

  it("no other row carries data-next-action", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 10 };
    renderChecklist();
    const items = screen.getAllByRole("listitem");
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.getAttribute("data-next-action")).toBeNull();
    }
  });

  it("progress bar has a 4px anchor at zero progress", () => {
    mockData = { completedSteps: [], allCompletedAt: null, totalSteps: 10 };
    renderChecklist();
    const fill = screen.getByTestId("onboarding-progress-fill") as HTMLDivElement;
    expect(fill.style.width).toBe("4px");
  });
});

describe("OnboardingChecklist — partial (4/10) state", () => {
  it("progress bar maps 4/10 to width: 40%", () => {
    mockData = {
      completedSteps: ["add_service", "invite_master", "first_booking", "activate_public"],
      allCompletedAt: null,
      totalSteps: 10,
    };
    renderChecklist();
    const fill = screen.getByTestId("onboarding-progress-fill") as HTMLDivElement;
    expect(fill.style.width).toBe("40%");
  });

  it("done rows carry line-through and the next-action attribute moves to the first incomplete row", () => {
    mockData = {
      completedSteps: ["add_service", "invite_master", "first_booking", "activate_public"],
      allCompletedAt: null,
      totalSteps: 10,
    };
    renderChecklist();

    // add_service is done → its <a> has line-through.
    const doneRow = document.querySelector('[data-step-id="add_service"]') as HTMLElement;
    const doneLink = doneRow.querySelector("a") as HTMLAnchorElement;
    expect(doneLink.className).toContain("line-through");

    // First incomplete step in STEPS order is connect_bot — that one should
    // be the next-action carrier.
    const next = document.querySelector('[data-next-action="true"]');
    expect(next?.getAttribute("data-step-id")).toBe("connect_bot");
  });

  it("exactly one pulse halo regardless of how many steps are done", () => {
    mockData = {
      completedSteps: ["add_service", "invite_master", "first_booking", "activate_public"],
      allCompletedAt: null,
      totalSteps: 10,
    };
    renderChecklist();
    const halos = document.querySelectorAll('[data-testid="onboarding-next-halo"]');
    expect(halos.length).toBe(1);
  });
});

describe("OnboardingChecklist — completion + loading edges", () => {
  it("renders nothing while loading", () => {
    mockIsLoading = true;
    mockData = null;
    const { container } = renderChecklist();
    expect(container.firstChild).toBeNull();
  });

  it("hides itself once all 10 steps are done", () => {
    mockData = {
      completedSteps: [
        "add_service", "connect_bot", "invite_master", "set_schedule",
        "share_link", "first_booking", "fill_description", "add_logo",
        "add_cover", "activate_public",
      ],
      allCompletedAt: 1700000000,
      totalSteps: 10,
    };
    const { container } = renderChecklist();
    expect(container.firstChild).toBeNull();
  });
});
