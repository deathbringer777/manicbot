import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(
  __dirname,
  '..',
  '..',
  '.claude',
  'skills',
  'manicbot-coding-standards',
  'SKILL.md',
);

function readSkill() {
  return readFileSync(SKILL_PATH, 'utf8');
}

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const block = content.slice(4, end);
  const fields = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return { fields, body: content.slice(end + 5) };
}

describe('manicbot-coding-standards skill', () => {
  it('SKILL.md exists at .claude/skills/manicbot-coding-standards/', () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it('has valid YAML frontmatter with name and description', () => {
    const fm = parseFrontmatter(readSkill());
    expect(fm).not.toBeNull();
    expect(fm.fields.name).toBe('manicbot-coding-standards');
    expect(fm.fields.description).toBeTruthy();
    expect(fm.fields.description.length).toBeGreaterThan(80);
  });

  it('description names ManicBot and key trigger verbs', () => {
    const fm = parseFrontmatter(readSkill());
    expect(fm.fields.description).toMatch(/ManicBot/);
    expect(fm.fields.description).toMatch(/code change|refactor|debugging/i);
  });

  it('keeps the EN/RU communication rule', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/written in English/i);
    expect(body).toMatch(/in Russian/i);
  });

  it('keeps the horizontal+vertical scanning protocol', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/HORIZONTAL scan/);
    expect(body).toMatch(/VERTICAL scan/);
  });

  it('keeps the backend TDD section', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/Test-Driven Development/i);
    expect(body).toMatch(/backend/i);
  });

  it('keeps the parallel documentation awareness section', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/Parallel Documentation Awareness/);
    expect(body).toMatch(/CLAUDE\.md/);
  });

  it('keeps the documentation update protocol with three pre-deploy stages', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/Documentation Update Protocol/);
    expect(body).toMatch(/Stage A — Tests/);
    expect(body).toMatch(/Stage B — Documentation Update/);
    expect(body).toMatch(/Stage C — Code Quality/);
  });

  it('keeps the pre-deploy checklist with required commands', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/Pre-Deploy Checklist/);
    expect(body).toMatch(/npm test/);
    expect(body).toMatch(/npm run check-schema/);
    expect(body).toMatch(/npm run typecheck/);
  });

  it('keeps tenant isolation and AI sanitization rules', () => {
    const body = parseFrontmatter(readSkill()).body;
    expect(body).toMatch(/sanitizeUserInput/);
    expect(body).toMatch(/tenant_id/);
  });
});
