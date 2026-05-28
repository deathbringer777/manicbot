// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { User, Mail } from "lucide-react";

import { CollapsibleSection } from "~/components/settings/CollapsibleSection";

afterEach(() => cleanup());

describe("CollapsibleSection — shared primitive", () => {
  it("renders collapsed by default", () => {
    render(
      <CollapsibleSection icon={User} title="Account" desc="Manage account">
        <p>body-content</p>
      </CollapsibleSection>
    );
    const trigger = screen.getByRole("button", { name: /Account/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Body is conditionally rendered — not in the DOM when collapsed.
    expect(screen.queryByText("body-content")).toBeNull();
  });

  it("opens with defaultOpen=true", () => {
    render(
      <CollapsibleSection icon={User} title="Account" defaultOpen>
        <p>body-content</p>
      </CollapsibleSection>
    );
    const trigger = screen.getByRole("button", { name: /Account/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("body-content")).toBeTruthy();
  });

  it("toggles open/close on click", () => {
    render(
      <CollapsibleSection icon={User} title="Account">
        <p>body-content</p>
      </CollapsibleSection>
    );
    const trigger = screen.getByRole("button", { name: /Account/ });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("body-content")).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("body-content")).toBeNull();
  });

  it("links the trigger to the body via aria-controls / id", () => {
    render(
      <CollapsibleSection icon={User} title="Account" defaultOpen>
        <p>body-content</p>
      </CollapsibleSection>
    );
    const trigger = screen.getByRole("button", { name: /Account/ });
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();

    const body = document.getElementById(controlsId!);
    expect(body).toBeTruthy();
    expect(body!.textContent).toContain("body-content");
  });

  it("omits the description paragraph when desc is not provided", () => {
    const { container } = render(
      <CollapsibleSection icon={User} title="Account">
        <p>body-content</p>
      </CollapsibleSection>
    );
    // Header has the title <h2> but no sibling <p> beneath it (the desc one).
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("Account");
    const siblingDescP = h2?.parentElement?.querySelector("p");
    expect(siblingDescP).toBeNull();
  });

  it("renders the description paragraph when desc is provided", () => {
    render(
      <CollapsibleSection icon={User} title="Account" desc="Manage your account">
        <p>body-content</p>
      </CollapsibleSection>
    );
    expect(screen.getByText("Manage your account")).toBeTruthy();
  });

  it("each instance manages its own open state independently", () => {
    render(
      <>
        <CollapsibleSection icon={User} title="First">
          <p>first-body</p>
        </CollapsibleSection>
        <CollapsibleSection icon={Mail} title="Second">
          <p>second-body</p>
        </CollapsibleSection>
      </>
    );
    const first = screen.getByRole("button", { name: /First/ });
    const second = screen.getByRole("button", { name: /Second/ });

    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("first-body")).toBeTruthy();
    expect(screen.queryByText("second-body")).toBeNull();
  });
});
