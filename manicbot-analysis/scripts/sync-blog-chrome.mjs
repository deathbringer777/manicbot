#!/usr/bin/env node
/**
 * One-off patcher for blog HTML. Source of truth for new builds is
 * `manicbot-blog/generate.mjs` (run via `npm run generate:blog` in manicbot-analysis).
 * Run from repo root: node manicbot-analysis/scripts/sync-blog-chrome.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blogRoot = path.join(__dirname, "../public/blog");

const BACK = {
  ru: "На сайт ManicBot",
  en: "Back to ManicBot",
  ua: "На сайт ManicBot",
  pl: "Strona główna ManicBot",
};

const FOOTER = {
  ru: {
    links: [
      ["/help", "Помощь"],
      ["/privacy", "Конфиденциальность"],
      ["/terms", "Условия"],
      ["/rules", "Правила"],
      ["/support", "Поддержка"],
    ],
    copy: "© 2026 ManicBot. Все права защищены.",
  },
  en: {
    links: [
      ["/help", "Help center"],
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
      ["/rules", "Rules"],
      ["/support", "Support"],
    ],
    copy: "© 2026 ManicBot. All rights reserved.",
  },
  ua: {
    links: [
      ["/help", "Довідка"],
      ["/privacy", "Конфіденційність"],
      ["/terms", "Умови"],
      ["/rules", "Правила"],
      ["/support", "Підтримка"],
    ],
    copy: "© 2026 ManicBot. Всі права захищені.",
  },
  pl: {
    links: [
      ["/help", "Pomoc"],
      ["/privacy", "Prywatność"],
      ["/terms", "Regulamin"],
      ["/rules", "Zasady"],
      ["/support", "Wsparcie"],
    ],
    copy: "© 2026 ManicBot. Wszelkie prawa zastrzeżone.",
  },
};

const EXTRA_CSS = `
    .site-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid rgba(124,58,237,0.15); }
    .site-top .home { font-size: 0.875rem; }
    .site-top .home a.brand {
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      font-weight: 700;
      text-decoration: none;
    }
    .site-top .blog-tag { color: var(--muted); font-weight: 500; }
    .site-top a.back { font-size: 0.875rem; color: var(--accent); text-decoration: none; font-weight: 600; }
    .site-top a.back:hover { text-decoration: underline; }
    .site-footer { margin-top: 0; padding: 2rem 1.25rem 2.5rem; border-top: 1px solid rgba(148,163,184,0.25); max-width: 42rem; margin-left: auto; margin-right: auto; }
    .site-footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem 1.5rem; margin-bottom: 1rem; }
    .site-footer nav a { font-size: 0.875rem; color: var(--muted); text-decoration: none; }
    .site-footer nav a:hover { color: var(--accent); }
    .site-footer p { margin: 0; text-align: center; font-size: 0.75rem; color: var(--muted); opacity: 0.9; }
`;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html") && name !== "index.html") out.push(p);
  }
  return out;
}

function patchArticle(filePath) {
  const rel = filePath.split("blog").pop() ?? "";
  const langMatch = rel.match(/^[/\\](ru|en|ua|pl)[/\\]/);
  if (!langMatch) return;
  const lang = langMatch[1];
  let h = fs.readFileSync(filePath, "utf8");

  if (h.includes('class="site-top"')) {
    console.log("skip (already patched):", filePath);
    return;
  }

  h = h.replace(
    /\s*header \{ padding: 1\.25rem 1\.5rem; border-bottom: 1px solid rgba\(124,58,237,0\.15\); \}\n/,
    EXTRA_CSS,
  );

  h = h.replace(
    /\.home a \{\s*background: linear-gradient\(135deg, var\(--accent\), var\(--accent2\)\);\s*-webkit-background-clip: text;\s*background-clip: text;\s*color: transparent;\s*font-weight: 700;\s*text-decoration: none;\s*\}\n/,
    "",
  );
  h = h.replace(/\n    \.home \{ font-size: 0\.875rem; \}\n(?=\s*<\/style>)/, "\n");

  const back = BACK[lang] ?? BACK.en;
  const foot = FOOTER[lang] ?? FOOTER.en;
  const navLinks = foot.links
    .map(([href, label]) => `      <a href="${href}">${label}</a>`)
    .join("\n");

  h = h.replace(
    /<header>\s*<div class="home"><a href="https:\/\/manicbot\.com\/">ManicBot<\/a> — blog<\/div>\s*<\/header>/,
    `<header class="site-top">
    <div class="home"><a class="brand" href="https://manicbot.com/">ManicBot</a> <span class="blog-tag">— blog</span></div>
    <a class="back" href="https://manicbot.com/">${back}</a>
  </header>`,
  );

  h = h.replace(
    /(<\/article>)\s*(<\/body>)/,
    `$1
  <footer class="site-footer">
    <nav aria-label="Footer">
${navLinks}
    </nav>
    <p>${foot.copy}</p>
  </footer>
$2`,
  );

  fs.writeFileSync(filePath, h, "utf8");
  console.log("patched:", filePath);
}

for (const f of walk(blogRoot)) {
  patchArticle(f);
}

/* blog index */
const indexPath = path.join(blogRoot, "index.html");
let idx = fs.readFileSync(indexPath, "utf8");
if (!idx.includes("site-top")) {
  idx = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ManicBot Blog — материалы о записи, ИИ и автоматизации в beauty</title>
  <meta name="description" content="Статьи ManicBot: Telegram-запись для салонов, ИИ в beauty в Европе и Польше, автоматизация продаж. EN/RU/UA/PL." />
  <link rel="canonical" href="https://manicbot.com/blog/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="ManicBot Blog" />
  <meta property="og:url" content="https://manicbot.com/blog/" />
  <meta property="og:image" content="https://manicbot.com/og-image.png" />
  <style>
    :root { color-scheme: light dark; --fg: #0f172a; --muted: #64748b; --accent: #7c3aed; --accent2: #06b6d4; --bg: #f8fafc; }
    @media (prefers-color-scheme: dark) { :root { --fg: #f1f5f9; --muted: #94a3b8; --bg: #050812; } }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.65; }
    .site-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid rgba(124,58,237,0.15); }
    .site-top a.brand { font-weight: 700; text-decoration: none; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .site-top a.back { font-size: 0.875rem; color: var(--accent); text-decoration: none; font-weight: 600; }
    .site-top a.back:hover { text-decoration: underline; }
    .wrap { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem 1rem; }
    a { color: var(--accent); }
    ul { padding-left: 1.2rem; }
    .site-footer { padding: 2rem 1rem 2.5rem; border-top: 1px solid rgba(148,163,184,0.25); max-width: 40rem; margin: 0 auto; }
    .site-footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem 1.5rem; margin-bottom: 1rem; }
    .site-footer nav a { font-size: 0.875rem; color: var(--muted); text-decoration: none; }
    .site-footer nav a:hover { color: var(--accent); }
    .site-footer p { margin: 0; text-align: center; font-size: 0.75rem; color: var(--muted); }
  </style>
</head>
<body>
  <header class="site-top">
    <a class="brand" href="https://manicbot.com/">ManicBot</a>
    <a class="back" href="https://manicbot.com/">На сайт ManicBot</a>
  </header>
  <main class="wrap">
  <h1>Blog</h1>
  <p>Материалы для SEO и владельцев салонов (RU/EN/UA/PL).</p>
  <ul>
    <li><a href="https://manicbot.com/blog/ru/manicbot-telegram-booking.html">ManicBot и запись в Telegram (RU)</a> — <a href="https://manicbot.com/blog/en/manicbot-telegram-booking.html">EN</a>, <a href="https://manicbot.com/blog/ua/manicbot-telegram-booking.html">UA</a>, <a href="https://manicbot.com/blog/pl/manicbot-telegram-booking.html">PL</a></li>
    <li><a href="https://manicbot.com/blog/ru/ai-beauty-europe-poland.html">ИИ и beauty в Европе и Польше (RU)</a> — <a href="https://manicbot.com/blog/en/ai-beauty-europe-poland.html">EN</a>, <a href="https://manicbot.com/blog/ua/ai-beauty-europe-poland.html">UA</a>, <a href="https://manicbot.com/blog/pl/ai-beauty-europe-poland.html">PL</a></li>
    <li><a href="https://manicbot.com/blog/ru/automation-sales-europe.html">Автоматизация и продажи (RU)</a> — <a href="https://manicbot.com/blog/en/automation-sales-europe.html">EN</a>, <a href="https://manicbot.com/blog/ua/automation-sales-europe.html">UA</a>, <a href="https://manicbot.com/blog/pl/automation-sales-europe.html">PL</a></li>
  </ul>
  </main>
  <footer class="site-footer">
    <nav aria-label="Footer">
      <a href="/help">Помощь</a>
      <a href="/privacy">Конфиденциальность</a>
      <a href="/terms">Условия</a>
      <a href="/rules">Правила</a>
      <a href="/support">Поддержка</a>
    </nav>
    <p>© 2026 ManicBot. Все права защищены.</p>
  </footer>
</body>
</html>
`;
  fs.writeFileSync(indexPath, idx, "utf8");
  console.log("patched:", indexPath);
}
