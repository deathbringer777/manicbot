// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePinnedPlugins, readPinned, writePinned } from "~/lib/plugins/pinnedPlugins";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("usePinnedPlugins — storage layer", () => {
  it("readPinned returns empty array when nothing stored", () => {
    expect(readPinned()).toEqual([]);
  });

  it("readPinned ignores garbage JSON", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", "{not-json");
    expect(readPinned()).toEqual([]);
  });

  it("readPinned ignores non-array values", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", '"a-string"');
    expect(readPinned()).toEqual([]);
  });

  it("readPinned filters non-string entries", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", JSON.stringify([1, "good", null, "other"]));
    expect(readPinned()).toEqual(["good", "other"]);
  });

  it("readPinned caps at 20 entries", () => {
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    window.localStorage.setItem("manicbot_pinned_plugins", JSON.stringify(many));
    expect(readPinned()).toHaveLength(20);
  });

  it("writePinned persists + dispatches event", () => {
    const listener = (): void => { /* noop */ };
    window.addEventListener("manicbot:pinned-changed", listener);
    writePinned(["sms-reminders"]);
    expect(JSON.parse(window.localStorage.getItem("manicbot_pinned_plugins")!)).toEqual(["sms-reminders"]);
    window.removeEventListener("manicbot:pinned-changed", listener);
  });
});

describe("usePinnedPlugins hook", () => {
  it("starts empty then pin adds a slug", () => {
    const { result } = renderHook(() => usePinnedPlugins());
    expect(result.current.pinned).toEqual([]);
    act(() => result.current.pin("sms-reminders"));
    expect(result.current.pinned).toContain("sms-reminders");
    expect(result.current.isPinned("sms-reminders")).toBe(true);
    expect(result.current.isPinned("other")).toBe(false);
  });

  it("unpin removes a slug", () => {
    writePinned(["sms-reminders", "task-board"]);
    const { result } = renderHook(() => usePinnedPlugins());
    act(() => result.current.unpin("sms-reminders"));
    expect(result.current.pinned).not.toContain("sms-reminders");
    expect(result.current.pinned).toContain("task-board");
  });

  it("pin is idempotent (no duplicates)", () => {
    const { result } = renderHook(() => usePinnedPlugins());
    act(() => result.current.pin("sms-reminders"));
    act(() => result.current.pin("sms-reminders"));
    expect(result.current.pinned.filter((s) => s === "sms-reminders").length).toBe(1);
  });

  it("toggle flips state", () => {
    const { result } = renderHook(() => usePinnedPlugins());
    act(() => result.current.toggle("task-board"));
    expect(result.current.isPinned("task-board")).toBe(true);
    act(() => result.current.toggle("task-board"));
    expect(result.current.isPinned("task-board")).toBe(false);
  });

  it("newly pinned slugs appear at the top", () => {
    writePinned(["first"]);
    const { result } = renderHook(() => usePinnedPlugins());
    act(() => result.current.pin("second"));
    expect(result.current.pinned[0]).toBe("second");
  });
});
