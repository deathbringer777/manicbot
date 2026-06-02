import { describe, it, expect } from "vitest";
import { isDateKeyboard, parseDateKeyboard } from "../components/chat/chatKeyboards";

const b = (text: string, callback_data: string | null) => ({ text, callback_data, url: null });

// calKb-shaped keyboard (manicbot/src/ui/keyboards.js) for June 2026, today = 2026-06-02.
const calKb = [
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

const serviceList = [[b("💅 Маникюр", "sv:classic")], [b("◀️ Назад", "main")]];
const photoNav = [
  [b("◀️", "cc:classic:0"), b("1 / 3", "_"), b("▶️", "cc:classic:2")],
  [b("Записаться", "sv:classic")],
];

describe("isDateKeyboard", () => {
  it("detects a calendar keyboard (dt:/cm:)", () => {
    expect(isDateKeyboard(calKb)).toBe(true);
  });
  it("ignores a service list", () => {
    expect(isDateKeyboard(serviceList)).toBe(false);
  });
  it("ignores catalog photo navigation", () => {
    expect(isDateKeyboard(photoNav)).toBe(false);
  });
  it("handles null/empty", () => {
    expect(isDateKeyboard(null)).toBe(false);
    expect(isDateKeyboard([])).toBe(false);
  });
});

describe("parseDateKeyboard", () => {
  const parsed = parseDateKeyboard(calKb);

  it("extracts only day cells, dropping NOOP spacers/headers", () => {
    expect(parsed.days.map((d) => d.day)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(parsed.days[0]).toMatchObject({
      iso: "2026-06-02",
      callbackData: "dt:2026-06-02",
      isToday: true,
    });
    expect(parsed.days[1]?.isToday).toBe(false);
  });

  it("splits month arrows and finds the trailing footer button", () => {
    expect(parsed.prevMonth).toBeNull();
    expect(parsed.nextMonth?.callback_data).toBe("cm:1");
    expect(parsed.footer?.callback_data).toBe("book");
  });
});
