/**
 * Tests for src/server/security/sanitize.ts
 *
 * Covers XSS vectors, profile enforcement, URL safety, and AI output cleaning.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeText,
  sanitizeAiOutput,
  escapeHtml,
  stripHtml,
} from "../server/security/sanitize";

// ─── escapeHtml ──────────────────────────────────────────────────────────────
describe("escapeHtml", () => {
  it("escapes all five HTML entities", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#x27;");
  });

  it("does not double-escape already escaped text", () => {
    const out = escapeHtml("hello world");
    expect(out).toBe("hello world");
  });
});

// ─── stripHtml ───────────────────────────────────────────────────────────────
describe("stripHtml", () => {
  it("removes all HTML tags", () => {
    // whitespace is collapsed so inline tags leave a single space
    expect(stripHtml("<b>bold</b> <i>italic</i>")).toBe("bold italic");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("<p>  hello   world  </p>")).toBe("hello world");
  });
});

// ─── sanitizeHtml — profile: text ────────────────────────────────────────────
describe('sanitizeHtml — profile "text"', () => {
  it("strips all tags and escapes entities", () => {
    const out = sanitizeHtml('<b>Hello</b> <script>alert(1)</script>', "text");
    expect(out).not.toContain("<");
    expect(out).toContain("Hello");
  });
});

// ─── sanitizeHtml — profile: chat ────────────────────────────────────────────
describe('sanitizeHtml — profile "chat"', () => {
  it("allows <b>, <i>, <code>, <a>", () => {
    const out = sanitizeHtml("<b>bold</b> <i>italic</i> <code>x</code>", "chat");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).toContain("<code>x</code>");
  });

  it("strips <script> tags entirely (including content)", () => {
    const out = sanitizeHtml('<script>alert("xss")</script>hello', "chat");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("<script");
    expect(out).toContain("hello");
  });

  it("strips <img> tags (not in chat allowlist)", () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">', "chat");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
  });

  it("strips event handler attributes", () => {
    const out = sanitizeHtml('<b onclick="evil()">click me</b>', "chat");
    expect(out).not.toContain("onclick");
    expect(out).toContain("click me");
  });

  it("blocks javascript: hrefs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>', "chat");
    expect(out).not.toContain("javascript:");
  });

  it("allows safe https: links", () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a>', "chat");
    expect(out).toContain('href="https://example.com"');
  });

  it("adds rel=noopener noreferrer to links", () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a>', "chat");
    expect(out).toContain("noopener");
  });

  it("strips <style> blocks entirely", () => {
    const out = sanitizeHtml("<style>body{display:none}</style>hello", "chat");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("display:none");
  });

  it("strips <iframe> blocks", () => {
    const out = sanitizeHtml('<iframe src="https://evil.com"></iframe>', "chat");
    expect(out).not.toContain("iframe");
  });
});

// ─── sanitizeHtml — profile: salonBio ────────────────────────────────────────
describe('sanitizeHtml — profile "salonBio"', () => {
  it("allows headings and lists", () => {
    const out = sanitizeHtml("<h2>Services</h2><ul><li>Manicure</li></ul>", "salonBio");
    expect(out).toContain("<h2>Services</h2>");
    expect(out).toContain("<ul><li>Manicure</li></ul>");
  });

  it("strips dangerous data: image src", () => {
    const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">', "salonBio");
    expect(out).not.toContain("data:");
    expect(out).not.toContain("<script");
  });
});

// ─── sanitizeText ─────────────────────────────────────────────────────────────
describe("sanitizeText", () => {
  it("strips HTML and respects maxLen", () => {
    const long = "a".repeat(6000);
    expect(sanitizeText(long, 100).length).toBe(100);
  });
});

// ─── sanitizeAiOutput ────────────────────────────────────────────────────────
describe("sanitizeAiOutput", () => {
  it("converts action tags [TAG:val] to safe text", () => {
    const out = sanitizeAiOutput("Please [BOOK:2024-01-15:10:00] your appointment.");
    expect(out).not.toContain("[BOOK:");
    expect(out).toContain("(BOOK:2024-01-15:10:00)");
  });

  it("removes unknown HTML tags from AI output", () => {
    const out = sanitizeAiOutput('Hello <custom-tag attr="x">world</custom-tag>');
    expect(out).not.toContain("<custom-tag");
  });

  it("preserves safe inline tags like <b> and <code>", () => {
    const out = sanitizeAiOutput("Use <b>bold</b> and <code>code()</code>");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<code>code()</code>");
  });

  it("handles angle-bracket action tags", () => {
    const out = sanitizeAiOutput("Booking <BOOK:2024-01-15> confirmed.");
    expect(out).not.toContain("<BOOK:");
    expect(out).toContain("(BOOK:2024-01-15)");
  });
});
