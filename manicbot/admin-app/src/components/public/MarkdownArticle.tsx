"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Zero-dependency Markdown renderer scoped to the blog. The blog is the only
 * place we ship author-controlled prose, so we keep parsing tight: only the
 * subset the editorial team actually uses (H2/H3, paragraphs, ul/ol, bold,
 * italic, inline links, images, hr, blockquote, inline code, soft line breaks).
 *
 * Why not react-markdown:
 *  - +60 KB on a static blog page is a bad trade for a handful of element types.
 *  - The content is trusted (lives in our own `posts/*.ts`), so we don't need
 *    GFM/HTML pass-through or sanitisation beyond escaping inline-link hrefs and
 *    hard-restricting image hosts.
 *  - Tailwind 4 in this repo doesn't ship `@tailwindcss/typography`, so we'd
 *    style every element manually anyway.
 *
 * Editorial dialect:
 *  - `## Heading` → h2; `### Heading` → h3
 *  - blank line separates blocks
 *  - `- item` or `* item` → unordered list; `1. item` → ordered list
 *  - `> quote` → blockquote
 *  - `---` on its own line → hr
 *  - `![alt](url)` on its own line → figure+caption; also valid inline
 *  - inline: `**bold**`, `*italic*`, `` `code` ``, `[text](https://url)`
 *
 * Images render as a plain lazy `<img>` (not next/image) to keep this file
 * dependency-free; the src host is restricted to the two CDNs whitelisted in
 * next.config.js so a content typo can't smuggle in an arbitrary origin.
 */

/** Only these image hosts may render — mirrors next.config.js remotePatterns. */
const SAFE_IMG_SRC = /^https:\/\/(images\.unsplash\.com|images\.pexels\.com)\//i;

type Token =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "blockquote"; text: string }
  | { kind: "image"; url: string; alt: string }
  | { kind: "hr" };

function tokenize(md: string): Token[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const tokens: Token[] = [];
  let buffer: string[] = [];
  let mode: "para" | "ul" | "ol" | "blockquote" | null = null;

  const flush = () => {
    if (!buffer.length || !mode) {
      buffer = [];
      mode = null;
      return;
    }
    if (mode === "para") {
      tokens.push({ kind: "paragraph", text: buffer.join(" ") });
    } else if (mode === "ul") {
      tokens.push({ kind: "ul", items: buffer.slice() });
    } else if (mode === "ol") {
      tokens.push({ kind: "ol", items: buffer.slice() });
    } else if (mode === "blockquote") {
      tokens.push({ kind: "blockquote", text: buffer.join(" ") });
    }
    buffer = [];
    mode = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    // A line that is *only* an image becomes its own figure block, regardless
    // of any paragraph currently accumulating above it.
    const imgBlock = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (imgBlock) {
      flush();
      tokens.push({ kind: "image", url: imgBlock[2] ?? "", alt: imgBlock[1] ?? "" });
      continue;
    }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h && h[1] && h[2]) {
      flush();
      tokens.push({ kind: "heading", level: h[1].length as 2 | 3, text: h[2] });
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flush();
      tokens.push({ kind: "hr" });
      continue;
    }
    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ul && ul[1]) {
      if (mode !== "ul") flush();
      mode = "ul";
      buffer.push(ul[1]);
      continue;
    }
    const ol = /^\d+\.\s+(.+)$/.exec(line);
    if (ol && ol[1]) {
      if (mode !== "ol") flush();
      mode = "ol";
      buffer.push(ol[1]);
      continue;
    }
    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) {
      if (mode !== "blockquote") flush();
      mode = "blockquote";
      buffer.push(bq[1] ?? "");
      continue;
    }
    if (mode !== "para") flush();
    mode = "para";
    buffer.push(line.trim());
  }
  flush();
  return tokens;
}

/** Render inline Markdown (bold/italic/code/link) to ReactNodes. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  // Greedy left-to-right scan for the next markdown token. Image (`![]()`) is
  // listed before link (`[]()`) so a leading `!` is consumed as an image, not
  // as stray text + a link.
  const TOKEN_RE =
    /(!\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/;
  while (rest.length > 0) {
    const m = TOKEN_RE.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    if (m[1]) {
      const url = m[3] ?? "";
      if (SAFE_IMG_SRC.test(url)) {
        nodes.push(
          <img
            key={`img${key++}`}
            src={url}
            alt={m[2] ?? ""}
            loading="lazy"
            decoding="async"
            className="inline-block max-h-80 w-auto rounded-lg align-middle"
          />,
        );
      } else if (m[2]) {
        // Unknown host — fall back to the alt text so meaning isn't lost.
        nodes.push(m[2]);
      }
    } else if (m[4]) {
      nodes.push(<strong key={`s${key++}`}>{m[5]}</strong>);
    } else if (m[6]) {
      nodes.push(<em key={`e${key++}`}>{m[7]}</em>);
    } else if (m[8]) {
      nodes.push(
        <code
          key={`c${key++}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.95em] font-mono text-violet-700 dark:bg-slate-800 dark:text-violet-300"
        >
          {m[9]}
        </code>,
      );
    } else if (m[10]) {
      const href = m[12] ?? "#";
      const safe = /^(https?:|mailto:|\/)/i.test(href) ? href : "#";
      const external = /^https?:/i.test(safe);
      nodes.push(
        <a
          key={`a${key++}`}
          href={safe}
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-700 hover:decoration-violet-500 dark:text-violet-400 dark:hover:text-violet-300"
        >
          {m[11] ?? safe}
        </a>,
      );
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

/** Slugify a heading so we can anchor it for the SERP table-of-contents. */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9а-яёіїєґ\s-]/giu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export function MarkdownArticle({ source }: { source: string }) {
  const tokens = tokenize(source);
  return (
    <div className="article-prose text-slate-700 dark:text-slate-300">
      {tokens.map((t, idx) => {
        if (t.kind === "heading") {
          if (t.level === 2) {
            return (
              <h2
                key={idx}
                id={slugifyHeading(t.text)}
                className="mt-10 mb-4 scroll-mt-24 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
              >
                {renderInline(t.text)}
              </h2>
            );
          }
          return (
            <h3
              key={idx}
              id={slugifyHeading(t.text)}
              className="mt-7 mb-3 scroll-mt-24 text-lg font-semibold tracking-tight text-slate-900 dark:text-white"
            >
              {renderInline(t.text)}
            </h3>
          );
        }
        if (t.kind === "paragraph") {
          return (
            <p
              key={idx}
              className="my-4 text-[15px] leading-7 sm:text-base sm:leading-[1.75]"
            >
              {renderInline(t.text)}
            </p>
          );
        }
        if (t.kind === "ul") {
          return (
            <ul
              key={idx}
              className="my-4 list-disc space-y-1.5 pl-6 text-[15px] leading-7 sm:text-base marker:text-violet-500"
            >
              {t.items.map((it, i) => (
                <li key={i}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (t.kind === "ol") {
          return (
            <ol
              key={idx}
              className="my-4 list-decimal space-y-1.5 pl-6 text-[15px] leading-7 sm:text-base marker:text-violet-500 marker:font-semibold"
            >
              {t.items.map((it, i) => (
                <li key={i}>{renderInline(it)}</li>
              ))}
            </ol>
          );
        }
        if (t.kind === "blockquote") {
          return (
            <blockquote
              key={idx}
              className="my-6 border-l-4 border-violet-300 bg-violet-50/40 px-4 py-3 text-[15px] italic text-slate-700 dark:border-violet-700 dark:bg-violet-900/10 dark:text-slate-200"
            >
              {renderInline(t.text)}
            </blockquote>
          );
        }
        if (t.kind === "image") {
          // Drop a non-whitelisted host rather than render an unknown origin.
          if (!SAFE_IMG_SRC.test(t.url)) return <Fragment key={idx} />;
          return (
            <figure key={idx} className="my-8">
              {/* eslint-disable-next-line @next/next/no-img-element -- intentional plain <img> to keep this renderer dependency-free; hosts are whitelisted above. */}
              <img
                src={t.url}
                alt={t.alt}
                loading="lazy"
                decoding="async"
                className="w-full h-auto rounded-xl bg-slate-100 dark:bg-slate-800"
              />
              {t.alt && (
                <figcaption className="mt-2 text-center text-xs text-slate-400 dark:text-white/40">
                  {t.alt}
                </figcaption>
              )}
            </figure>
          );
        }
        if (t.kind === "hr") {
          return (
            <hr
              key={idx}
              className="my-10 border-0 border-t border-slate-200 dark:border-white/10"
            />
          );
        }
        return <Fragment key={idx} />;
      })}
    </div>
  );
}

/** Estimate reading time (words / 200 wpm) — exported for SEO metadata. */
export function readingMinutes(md: string): number {
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Extract every H2/H3 heading for an in-page table of contents. */
export function extractHeadings(md: string): Array<{ level: 2 | 3; text: string; id: string }> {
  const out: Array<{ level: 2 | 3; text: string; id: string }> = [];
  for (const t of tokenize(md)) {
    if (t.kind === "heading") {
      out.push({ level: t.level, text: t.text, id: slugifyHeading(t.text) });
    }
  }
  return out;
}
