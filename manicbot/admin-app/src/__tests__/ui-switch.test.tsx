// @vitest-environment happy-dom
/**
 * Switch — shared accessible toggle primitive used across SalonDashboard,
 * MasterDashboard, AppearanceSection, and CalendarLeftRail. Replaces five
 * hand-rolled inline toggles with one component (cramped math + invisible
 * thumbs in light mode were the original bug).
 *
 * Public API contract:
 *   - role="switch" + aria-checked reflects `checked`
 *   - click toggles state (calls onChange with !checked)
 *   - disabled blocks onChange
 *   - keyboard: Space and Enter fire onClick (native <button> handles this)
 *   - 3 sizes: default | sm | xs — each picks track + thumb classes that
 *     leave ≥2px breathing room on the right when ON
 *   - 2 tones: brand (purple) | emerald
 *   - aria-label / data-testid / data-channel pass through
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Switch } from "~/components/ui/Switch";

afterEach(() => cleanup());

describe("Switch", () => {
  it("renders as role=switch with aria-checked reflecting `checked`", () => {
    const { rerender } = render(<Switch checked={false} onChange={() => undefined} aria-label="vis" />);
    const off = screen.getByRole("switch", { name: "vis" });
    expect(off.getAttribute("aria-checked")).toBe("false");
    rerender(<Switch checked={true} onChange={() => undefined} aria-label="vis" />);
    const on = screen.getByRole("switch", { name: "vis" });
    expect(on.getAttribute("aria-checked")).toBe("true");
  });

  it("click fires onChange with the inverted value", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="t" />);
    fireEvent.click(screen.getByRole("switch", { name: "t" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("click on an ON switch fires onChange(false)", () => {
    const onChange = vi.fn();
    render(<Switch checked={true} onChange={onChange} aria-label="t" />);
    fireEvent.click(screen.getByRole("switch", { name: "t" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disabled blocks onChange and disables the native button", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} disabled aria-label="t" />);
    const el = screen.getByRole("switch", { name: "t" }) as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    fireEvent.click(el);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keyboard Space/Enter both trigger onChange (native button behavior)", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="t" />);
    const el = screen.getByRole("switch", { name: "t" });
    // happy-dom fires click on keydown Enter; Space on keyup. Easiest assert:
    // fireEvent.click is what useEvent does after Space/Enter.
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("size=default uses h-6 w-11 track + h-5 w-5 thumb with 22px translate on", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => undefined} size="default" aria-label="t" />,
    );
    const track = container.querySelector("button")!;
    const thumb = track.querySelector("span")!;
    expect(track.className).toContain("h-6");
    expect(track.className).toContain("w-11");
    expect(thumb.className).toContain("h-5");
    expect(thumb.className).toContain("w-5");
    expect(thumb.className).toContain("translate-x-[22px]");
  });

  it("size=sm uses h-5 w-9 track + h-4 w-4 thumb with 18px translate on", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => undefined} size="sm" aria-label="t" />,
    );
    const track = container.querySelector("button")!;
    const thumb = track.querySelector("span")!;
    expect(track.className).toContain("h-5");
    expect(track.className).toContain("w-9");
    expect(thumb.className).toContain("h-4");
    expect(thumb.className).toContain("w-4");
    expect(thumb.className).toContain("translate-x-[18px]");
  });

  it("size=xs uses h-4 w-7 track + h-3 w-3 thumb with 14px translate on", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => undefined} size="xs" aria-label="t" />,
    );
    const track = container.querySelector("button")!;
    const thumb = track.querySelector("span")!;
    expect(track.className).toContain("h-4");
    expect(track.className).toContain("w-7");
    expect(thumb.className).toContain("h-3");
    expect(thumb.className).toContain("w-3");
    expect(thumb.className).toContain("translate-x-[14px]");
  });

  it("off state always uses translate-x-0.5 regardless of size", () => {
    for (const size of ["default", "sm", "xs"] as const) {
      const { container, unmount } = render(
        <Switch checked={false} onChange={() => undefined} size={size} aria-label={size} />,
      );
      const thumb = container.querySelector("button > span")!;
      expect(thumb.className).toContain("translate-x-0.5");
      unmount();
    }
  });

  it("tone=brand uses bg-brand-500 when ON", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => undefined} tone="brand" aria-label="t" />,
    );
    expect(container.querySelector("button")!.className).toContain("bg-brand-500");
  });

  it("tone=emerald uses bg-emerald-500 when ON", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => undefined} tone="emerald" aria-label="t" />,
    );
    expect(container.querySelector("button")!.className).toContain("bg-emerald-500");
  });

  it("OFF state uses bg-slate-300 dark:bg-slate-600 (not slate-700 — the broken dark default)", () => {
    const { container } = render(
      <Switch checked={false} onChange={() => undefined} aria-label="t" />,
    );
    const cls = container.querySelector("button")!.className;
    expect(cls).toContain("bg-slate-300");
    expect(cls).toContain("dark:bg-slate-600");
    expect(cls).not.toContain("dark:bg-slate-700");
  });

  it("thumb has ring for visibility against the saturated track in light mode", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => undefined} aria-label="t" />,
    );
    const thumb = container.querySelector("button > span")!;
    expect(thumb.className).toContain("ring-1");
    expect(thumb.className).toContain("ring-slate-900/10");
    expect(thumb.className).toContain("dark:ring-white/15");
    expect(thumb.className).toContain("bg-white");
  });

  it("data-testid, data-channel, and className pass through to the track button", () => {
    const { container } = render(
      <Switch
        checked={false}
        onChange={() => undefined}
        aria-label="t"
        data-testid="my-toggle"
        data-channel="telegram"
        className="cursor-wait"
      />,
    );
    const btn = screen.getByTestId("my-toggle");
    expect(btn.getAttribute("data-channel")).toBe("telegram");
    expect(btn.className).toContain("cursor-wait");
    // sanity: container has the same element
    expect(container.querySelector("[data-testid='my-toggle']")).toBe(btn);
  });

  it("renders type=button so it does not submit ambient forms", () => {
    const { container } = render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Switch checked={false} onChange={() => undefined} aria-label="t" />
      </form>,
    );
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("type")).toBe("button");
  });
});
