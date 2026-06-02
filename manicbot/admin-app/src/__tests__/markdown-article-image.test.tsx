// @vitest-environment happy-dom
/**
 * MarkdownArticle — inline image support.
 *
 * The blog corpus moved to image-rich long-form posts (2026-06 SEO sweep),
 * so the renderer must turn a standalone `![alt](url)` line into a real
 * `<figure><img>` with the alt surfaced as a caption. Images are trusted
 * (authored in our own `posts/*.ts`) but we still hard-restrict the src host
 * to the two CDNs whitelisted in next.config.js so a typo can't smuggle in
 * an arbitrary origin.
 *
 * Contract pinned here:
 *   * A line that is exactly `![alt](https://images.unsplash.com/..)` renders
 *     a <figure> with one <img> carrying that src + alt, and a <figcaption>.
 *   * An inline `![a](url)` inside a paragraph also renders an <img>.
 *   * A normal `[text](url)` link still renders an <a> (not an <img>).
 *   * A non-whitelisted image host is dropped (no <img> with that src).
 *   * Headings / paragraphs are untouched.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarkdownArticle } from "~/components/public/MarkdownArticle";

afterEach(cleanup);

const UNSPLASH = "https://images.unsplash.com/photo-1607779097040-26e80aa78e66?w=1600&q=80";
const PEXELS = "https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=1600";

describe("MarkdownArticle inline images", () => {
  it("renders a standalone image line as a figure with img src + alt", () => {
    const { container } = render(
      <MarkdownArticle source={`Intro paragraph.\n\n![Nail technician at work](${UNSPLASH})\n\nNext paragraph.`} />,
    );
    const fig = container.querySelector("figure");
    expect(fig, "expected a <figure> for the image block").toBeTruthy();
    const img = fig?.querySelector("img");
    expect(img, "expected an <img> inside the figure").toBeTruthy();
    expect(img?.getAttribute("src")).toBe(UNSPLASH);
    expect(img?.getAttribute("alt")).toBe("Nail technician at work");
    // alt doubles as a visible caption for accessibility + SEO context.
    expect(fig?.querySelector("figcaption")?.textContent).toBe("Nail technician at work");
    // Lazy by default so a 6-image article doesn't block first paint.
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("accepts the Pexels host too", () => {
    const { container } = render(<MarkdownArticle source={`![salon](${PEXELS})`} />);
    expect(container.querySelector("figure img")?.getAttribute("src")).toBe(PEXELS);
  });

  it("renders an inline image inside a paragraph", () => {
    const { container } = render(
      <MarkdownArticle source={`Before ![inline shot](${UNSPLASH}) after.`} />,
    );
    const img = container.querySelector("img");
    expect(img, "expected an inline <img>").toBeTruthy();
    expect(img?.getAttribute("src")).toBe(UNSPLASH);
  });

  it("still renders a normal markdown link as an anchor, not an image", () => {
    render(<MarkdownArticle source={`See [our pricing](https://manicbot.com/pricing) page.`} />);
    const link = screen.getByRole("link", { name: "our pricing" });
    expect(link.getAttribute("href")).toBe("https://manicbot.com/pricing");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("drops a non-whitelisted image host (no img with that src)", () => {
    const evil = "https://evil.example.com/x.jpg";
    const { container } = render(<MarkdownArticle source={`![x](${evil})`} />);
    expect(container.querySelector(`img[src="${evil}"]`)).toBeNull();
  });

  it("leaves headings and paragraphs intact", () => {
    const { container } = render(
      <MarkdownArticle source={`## Heading One\n\nA paragraph.\n\n![pic](${UNSPLASH})`} />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("Heading One");
    expect(container.querySelector("p")?.textContent).toBe("A paragraph.");
    expect(container.querySelector("figure img")).toBeTruthy();
  });
});
