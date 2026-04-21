// @vitest-environment happy-dom
/**
 * Tests for the 404 Not Found page.
 *
 * Verifies that:
 *  - The "Back" button calls window.history.back() when history.length > 1
 *  - The "Back" button calls router.push("/") when history.length === 1
 *  - A secondary "Go home" link to "/" is always present
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock next/navigation before importing the component
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link as a simple anchor
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import NotFound from "~/app/not-found";

describe("NotFound page", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the 404 heading and description", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByText(/does not exist/i)).toBeTruthy();
  });

  it("renders the Back button and Go home link", () => {
    render(<NotFound />);
    expect(screen.getByRole("button", { name: /back/i })).toBeTruthy();
    const goHome = screen.getByRole("link", { name: /go home/i });
    expect(goHome).toBeTruthy();
    expect((goHome as HTMLAnchorElement).href).toContain("/");
  });

  it("calls window.history.back() when history.length > 1", async () => {
    const user = userEvent.setup();
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});

    // Simulate having a history stack
    Object.defineProperty(window, "history", {
      value: { ...window.history, length: 5, back: backSpy },
      writable: true,
      configurable: true,
    });

    render(<NotFound />);
    const backButton = screen.getByRole("button", { name: /back/i });
    await user.click(backButton);

    expect(backSpy).toHaveBeenCalledOnce();
    expect(mockPush).not.toHaveBeenCalled();

    backSpy.mockRestore();
  });

  it("calls router.push('/') when history.length === 1", async () => {
    const user = userEvent.setup();
    const backSpy = vi.fn();

    // Simulate no history stack
    Object.defineProperty(window, "history", {
      value: { ...window.history, length: 1, back: backSpy },
      writable: true,
      configurable: true,
    });

    render(<NotFound />);
    const backButton = screen.getByRole("button", { name: /back/i });
    await user.click(backButton);

    expect(backSpy).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/");
  });
});
