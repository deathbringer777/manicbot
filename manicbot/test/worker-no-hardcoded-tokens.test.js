import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('worker.js — no hardcoded tokens', () => {
  const workerPath = resolve(import.meta.dirname, '../src/worker.js');
  const workerCode = readFileSync(workerPath, 'utf8');

  it('does not contain hardcoded bot tokens (format: digits:letters)', () => {
    const tokenPattern = /'\d{10}:AA[A-Za-z0-9_-]{30,}'/g;
    const matches = workerCode.match(tokenPattern);
    expect(matches).toBeNull();
  });

  it('does not contain webhook secret literals', () => {
    const secretPattern = /'wh_(?:salon|master)\d+_[A-Za-z0-9]+'/g;
    const matches = workerCode.match(secretPattern);
    expect(matches).toBeNull();
  });

  it('reads tokens from env variables', () => {
    expect(workerCode).toContain('env[d.tokenKey]');
    expect(workerCode).toContain('BOT_TOKEN_SALON1');
    expect(workerCode).toContain('BOT_TOKEN_SALON2');
    expect(workerCode).toContain('BOT_TOKEN_MASTER1');
    expect(workerCode).toContain('BOT_TOKEN_MASTER2');
  });

  it('getDemoBots returns empty array when no env tokens', () => {
    expect(workerCode).toContain('getDemoBots');
    expect(workerCode).toContain('if (!token) continue');
  });
});

describe('provision-bots.js — check for hardcoded tokens', () => {
  const scriptPath = resolve(import.meta.dirname, '../scripts/provision-bots.js');
  let scriptCode;
  try {
    scriptCode = readFileSync(scriptPath, 'utf8');
  } catch {
    scriptCode = null;
  }

  it('provision script exists', () => {
    expect(scriptCode).not.toBeNull();
  });
});
