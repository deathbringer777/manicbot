/**
 * Role-selector labels on the registration page must be gender-neutral in
 * every locale (the previous PL build shipped feminine-only forms — see the
 * "Właścicielka salonu / Stylistka" bug).
 *
 * This test locks the agreed neutral wording so a future re-translation can't
 * silently regress back to gendered nouns.
 */
import { describe, it, expect } from "vitest";
import { authCopy } from "~/components/auth/copy";

describe("authCopy — role labels are gender-neutral", () => {
  it("uses neutral nouns (Salon / private master) in every locale", () => {
    expect(authCopy.ru.register.roleOwner).toBe("Салон");
    expect(authCopy.ru.register.roleMaster).toBe("Частный мастер");

    expect(authCopy.ua.register.roleOwner).toBe("Салон");
    expect(authCopy.ua.register.roleMaster).toBe("Приватний майстер");

    expect(authCopy.en.register.roleOwner).toBe("Salon");
    expect(authCopy.en.register.roleMaster).toBe("Independent master");

    expect(authCopy.pl.register.roleOwner).toBe("Salon");
    expect(authCopy.pl.register.roleMaster).toBe("Niezależny mistrz");
  });

  it("does NOT use feminine-only PL nouns anywhere in the auth surface", () => {
    const banned = ["Właścicielka", "właścicielka", "Stylistka", "stylistka", "Stylistki", "stylistki", "stylistek", "klientką", "klientki"];
    const pl = authCopy.pl;
    const allStrings = [
      ...Object.values(pl.shared),
      ...Object.values(pl.login),
      ...Object.values(pl.verifyEmail),
      ...Object.values(pl.forgotPassword),
      ...Object.values(pl.resetPassword),
      ...Object.values(pl.register),
      ...Object.values(pl.confirmEmailChange),
    ].filter((v): v is string => typeof v === "string");

    for (const word of banned) {
      for (const str of allStrings) {
        expect(str, `PL string "${str}" must not contain feminine-only "${word}"`).not.toContain(word);
      }
    }
  });
});
