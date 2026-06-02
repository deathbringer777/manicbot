// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useRef } from "react";

// useLang is pulled in by ChatDateStrip / MessageBubble — pin the locale.
vi.mock("~/components/LangContext", () => ({
  useLang: () => ({ lang: "ru", setLang: () => {} }),
}));

import { ChatDateStrip } from "~/components/chat/ChatDateStrip";
import { PhotoCarousel } from "~/components/chat/PhotoCarousel";
import { useVisualViewport } from "~/components/chat/useVisualViewport";
import { MessageBubble } from "~/components/chat/MessageBubble";
import type { ChatButton, ChatMessage, ChatSalon } from "~/components/chat/chatTypes";

const b = (text: string, callback_data: string | null): ChatButton => ({
  text,
  callback_data,
  url: null,
});

// calKb-shaped keyboard for June 2026, today = 2026-06-02 (mirrors keyboards.js).
const calKb: ChatButton[][] = [
  [b(" ", "_"), b("Июнь 2026", "_"), b("▶️", "cm:1")],
  [b("Пн", "_"), b("Вт", "_"), b("Ср", "_"), b("Чт", "_"), b("Пт", "_"), b("Сб", "_"), b("Вс", "_")],
  [
    b("·", "_"),
    b("[2]", "dt:2026-06-02"),
    b("3", "dt:2026-06-03"),
    b("4", "dt:2026-06-04"),
    b("5", "dt:2026-06-05"),
    b("6", "dt:2026-06-06"),
    b("7", "dt:2026-06-07"),
  ],
  [b("Другая услуга", "book")],
];

const salon: ChatSalon = {
  slug: "s",
  name: "Salon",
  legalName: "Salon",
  logo: null,
  coverPhoto: null,
  brandPalette: { primary: "#EC4899" },
  description: null,
  city: null,
};

afterEach(() => cleanup());

describe("ChatDateStrip", () => {
  it("renders day cards and fires the dt: callback on tap", () => {
    const onPick = vi.fn();
    render(<ChatDateStrip rows={calKb} brandColor="#EC4899" onPick={onPick} />);
    fireEvent.click(screen.getByText("3"));
    expect(onPick).toHaveBeenCalledWith("dt:2026-06-03");
  });

  it("fires cm: on the next-month chevron and renders the footer link", () => {
    const onPick = vi.fn();
    render(<ChatDateStrip rows={calKb} brandColor="#EC4899" onPick={onPick} />);
    fireEvent.click(screen.getByLabelText("Следующий месяц"));
    expect(onPick).toHaveBeenCalledWith("cm:1");
    expect(screen.getByText("Другая услуга")).toBeTruthy();
  });
});

describe("PhotoCarousel", () => {
  const photos = ["https://e/a.png", "https://e/b.png", "https://e/c.png"];

  it("renders one slide per photo plus one dot per photo", () => {
    const { container } = render(<PhotoCarousel photos={photos} brandColor="#EC4899" />);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.querySelectorAll("button")).toHaveLength(3); // dots
  });

  it("drops a broken image (dead URL never shows a torn icon)", () => {
    const { container } = render(<PhotoCarousel photos={photos} />);
    fireEvent.error(container.querySelectorAll("img")[1]!);
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("renders a single image without dots for a lone photo", () => {
    const { container } = render(<PhotoCarousel photos={["https://e/a.png"]} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("useVisualViewport", () => {
  function makeVV(height: number, offsetTop = 0) {
    const map: Record<string, Set<() => void>> = {};
    return {
      height,
      offsetTop,
      addEventListener: (t: string, cb: () => void) => {
        (map[t] ??= new Set()).add(cb);
      },
      removeEventListener: (t: string, cb: () => void) => {
        map[t]?.delete(cb);
      },
      fire: (t: string) => map[t]?.forEach((cb) => cb()),
      count: (t: string) => map[t]?.size ?? 0,
    };
  }

  function setVV(vv: unknown) {
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  }

  beforeEach(() => {
    // Run the rAF-batched apply() synchronously for deterministic assertions.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setVV(undefined);
  });

  it("sizes the element to the visual viewport and follows the keyboard", () => {
    const vv = makeVV(500, 0);
    setVV(vv);
    const onChange = vi.fn();
    function Host() {
      const ref = useRef<HTMLDivElement>(null);
      useVisualViewport(ref, onChange);
      return <div ref={ref} data-testid="root" />;
    }
    render(<Host />);
    const el = screen.getByTestId("root");
    expect(el.style.height).toBe("500px"); // applied on mount
    expect(onChange).toHaveBeenCalled();

    vv.height = 300; // keyboard opens
    vv.offsetTop = 40; // Safari scrolls the layout viewport
    vv.fire("resize");
    expect(el.style.height).toBe("300px");
    expect(el.style.transform).toBe("translateY(40px)");
  });

  it("removes its listeners and inline styles on unmount", () => {
    const vv = makeVV(500);
    setVV(vv);
    function Host() {
      const ref = useRef<HTMLDivElement>(null);
      useVisualViewport(ref);
      return <div ref={ref} data-testid="r2" />;
    }
    const { unmount } = render(<Host />);
    expect(vv.count("resize")).toBe(1);
    unmount();
    expect(vv.count("resize")).toBe(0);
  });

  it("no-ops where visualViewport is unsupported (keeps the dvh fallback)", () => {
    setVV(undefined);
    function Host() {
      const ref = useRef<HTMLDivElement>(null);
      useVisualViewport(ref);
      return <div ref={ref} data-testid="r3" style={{ height: "123px" }} />;
    }
    render(<Host />);
    expect(screen.getByTestId("r3").style.height).toBe("123px"); // untouched
  });
});

describe("MessageBubble integration", () => {
  it("renders the swipe date strip for a calendar keyboard", () => {
    const msg: ChatMessage = {
      role: "bot",
      id: "m1",
      ts: 1,
      text: "Выбери дату:",
      buttons: calKb,
      photo: null,
      editMessageId: null,
    };
    render(<MessageBubble msg={msg} salon={salon} onButtonClick={() => {}} />);
    // The strip's month chevron (icon button) proves the rich UI replaced the grid.
    expect(screen.getByLabelText("Следующий месяц")).toBeTruthy();
  });

  it("renders the carousel and hides the cc:/counter nav for a multi-photo message", () => {
    const photoKb: ChatButton[][] = [
      [b("◀️", "cc:gel:0"), b("1 / 2", "_"), b("▶️", "cc:gel:1")],
      [b("Записаться", "sv:gel")],
      [b("Назад", "cat")],
    ];
    const msg: ChatMessage = {
      role: "bot",
      id: "m2",
      ts: 1,
      text: "Гель",
      buttons: photoKb,
      photo: "https://e/a.png",
      photos: ["https://e/a.png", "https://e/b.png"],
      editMessageId: null,
    };
    const { container } = render(<MessageBubble msg={msg} salon={salon} onButtonClick={() => {}} />);
    // Carousel slides present (salon.logo is null → bot avatar is a letter div, not an img).
    expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
    // cc: arrows + NOOP counter stripped...
    expect(screen.queryByText("◀️")).toBeNull();
    expect(screen.queryByText("1 / 2")).toBeNull();
    // ...but the book/back actions stay.
    expect(screen.getByText("Записаться")).toBeTruthy();
    expect(screen.getByText("Назад")).toBeTruthy();
  });
});
