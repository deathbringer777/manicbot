import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const blogRoot = resolve(import.meta.dirname, '../../manicbot-analysis/public/blog');

const slugs = ['manicbot-telegram-booking', 'ai-beauty-europe-poland', 'automation-sales-europe'];
const langs = ['ru', 'en', 'ua', 'pl'];

describe('manicbot-analysis/public/blog (versioned SEO HTML)', () => {
  it('has hub index and sitemap', () => {
    expect(existsSync(resolve(blogRoot, 'index.html'))).toBe(true);
    expect(existsSync(resolve(blogRoot, 'sitemap.xml'))).toBe(true);
    expect(existsSync(resolve(blogRoot, 'robots.txt'))).toBe(true);
  });

  it.each(slugs.flatMap((slug) => langs.map((lang) => [lang, slug])))(
    'article %s/%s.html exists and references manicbot.com/blog',
    (lang, slug) => {
      const file = resolve(blogRoot, lang, `${slug}.html`);
      expect(existsSync(file), file).toBe(true);
      const html = readFileSync(file, 'utf8');
      expect(html).toContain('https://manicbot.com/blog/');
      expect(html).toContain(`canonical`);
    }
  );
});
