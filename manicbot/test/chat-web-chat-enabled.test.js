/**
 * Worker chat surface gates on `tenants.chat_enabled = 1` (migration 0090).
 *
 * Before 0090 both `loadSalonBranding` (in `src/http/chatWebHttp.js`) and
 * `resolveTenantFromSlug` (in `src/channels/resolver.js`) filtered on
 * `public_active = 1`. That coupled the chat URL — something the salon
 * owner shares manually via a printed QR or Instagram bio — to the
 * salon being listed in the public catalog. The two decisions are now
 * independent: see migration 0090 + `publicSalon.getProfileForChat`.
 *
 * This file is a static source-code pin. The mock-DB in the existing
 * resolver tests does not evaluate WHERE clauses (it returns whatever
 * rows are queued), so a behavioural test of the gate column would be
 * misleading. Pinning the SQL string directly is the simplest way to
 * stop the gate from silently regressing to `public_active`.
 *
 * If you change the gate column, update CLAUDE.md too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadWorkerSource(relPath) {
  return readFileSync(path.resolve(here, '..', relPath), 'utf8');
}

describe('chatWebHttp.loadSalonBranding — chat_enabled gate', () => {
  const src = loadWorkerSource('src/http/chatWebHttp.js');

  it('filters tenants by chat_enabled = 1 (not public_active)', () => {
    // The loadSalonBranding SELECT lives close to "FROM tenants WHERE slug = ?".
    // Slice that local context to avoid catching unrelated SQL elsewhere in
    // the file.
    const idx = src.indexOf('FROM tenants WHERE slug = ?');
    expect(idx, 'loadSalonBranding SQL must exist').toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 200);
    expect(window).toMatch(/chat_enabled\s*=\s*1/);
    expect(window).not.toMatch(/public_active\s*=\s*1/);
  });
});

describe('channels/resolver.resolveTenantFromSlug — chat_enabled gate', () => {
  const src = loadWorkerSource('src/channels/resolver.js');

  it('filters tenants by chat_enabled = 1 inside resolveTenantFromSlug', () => {
    const fnStart = src.indexOf('export async function resolveTenantFromSlug');
    expect(fnStart, 'resolveTenantFromSlug must exist').toBeGreaterThan(-1);
    // Crop to the function body — generous window covers the SQL string.
    const body = src.slice(fnStart, fnStart + 1500);
    expect(body).toMatch(/chat_enabled\s*=\s*1/);
    // Strip comments before checking the negative — the file's doc block
    // legitimately mentions `public_active` as historical context.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/public_active\s*=\s*1/);
  });
});
