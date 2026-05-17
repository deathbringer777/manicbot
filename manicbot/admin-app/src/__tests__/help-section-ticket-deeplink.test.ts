/**
 * HelpSection — pins the ?ticket=<id> deep-link auto-open behaviour.
 *
 * The notification-bell row for a `support.reply` event links to
 *   /settings?section=help&ticket=<ticketId>
 * and the salon owner needs to land directly on the ticket conversation,
 * not on the empty "list" view. If this regresses, the bell click feels
 * broken: badge clears, page changes, but no thread opens.
 *
 * Source-level pin to avoid pulling in RTL + tRPC + Next router for what
 * is essentially "the useEffect block exists and references the right
 * search-param".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(
  __dirname,
  "../components/settings/sections/HelpSection.tsx",
);

describe("HelpSection.tsx — ?ticket= deep link", () => {
  const src = readFileSync(FILE, "utf8");

  it("imports useSearchParams from next/navigation", () => {
    expect(src).toMatch(/import \{ useSearchParams \} from "next\/navigation"/);
  });

  it("reads the 'ticket' query param", () => {
    expect(src).toMatch(/searchParams\?\.get\("ticket"\)/);
  });

  it("opens the detail view when ticket param is present", () => {
    expect(src).toMatch(/setSelectedTicketId\(ticketQuery\)/);
    expect(src).toMatch(/setView\("detail"\)/);
  });
});
