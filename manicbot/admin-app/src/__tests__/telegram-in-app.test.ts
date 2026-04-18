import { describe, expect, it } from "vitest";
import { isTelegramInAppContext } from "~/lib/telegramInApp";

function makeWindow(
  p: Partial<{
    Telegram: object;
    userAgent: string;
    search: string;
    referrer: string;
  }>,
) {
  const w = {
    navigator: { userAgent: p.userAgent ?? "" } as Navigator,
    location: { search: p.search ?? "" } as Location,
    document: { referrer: p.referrer ?? "" } as Document,
  } as Window & { Telegram?: object };
  if (p.Telegram !== undefined) w.Telegram = p.Telegram;
  return w;
}

describe("isTelegramInAppContext", () => {
  it("is true when window.Telegram is set (injected on Mini App / WebView)", () => {
    expect(isTelegramInAppContext(makeWindow({ Telegram: { WebApp: {} } }))).toBe(
      true,
    );
  });

  it("is true when user agent contains Telegram (in-app browser etc.)", () => {
    expect(
      isTelegramInAppContext(
        makeWindow({ userAgent: "Mozilla/5.0 (Linux; Android 14) Telegram" }),
      ),
    ).toBe(true);
  });

  it("is true when location has tgWebApp query (Telegram bridge parameters)", () => {
    expect(
      isTelegramInAppContext(
        makeWindow({ search: "?startapp=1&tgWebApp=1" }),
      ),
    ).toBe(true);
  });

  it("is true when document.referrer is t.me", () => {
    expect(
      isTelegramInAppContext(
        makeWindow({ referrer: "https://t.me/ManicbotBot?start=admin" }),
      ),
    ).toBe(true);
  });

  it("is true when document.referrer is web.telegram.org", () => {
    expect(
      isTelegramInAppContext(
        makeWindow({ referrer: "https://web.telegram.org/k/..." }),
      ),
    ).toBe(true);
  });

  it("is false in a normal browser profile", () => {
    expect(
      isTelegramInAppContext(
        makeWindow({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0",
          search: "?lang=ru",
          referrer: "https://google.com/",
        }),
      ),
    ).toBe(false);
  });
});
