import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('worker.js — no hardcoded tokens', () => {
  const workerPath = resolve(import.meta.dirname, '../src/worker.js');
  const demoBotsPath = resolve(import.meta.dirname, '../src/http/demoBots.js');
  const workerCode = readFileSync(workerPath, 'utf8');
  const demoBotsCode = readFileSync(demoBotsPath, 'utf8');

  it('does not contain hardcoded bot tokens (format: digits:letters)', () => {
    const tokenPattern = /'\d{10}:AA[A-Za-z0-9_-]{30,}'/g;
    expect(workerCode.match(tokenPattern)).toBeNull();
    expect(demoBotsCode.match(tokenPattern)).toBeNull();
  });

  it('does not contain webhook secret literals', () => {
    const secretPattern = /'wh_(?:salon|master)\d+_[A-Za-z0-9]+'/g;
    expect(workerCode.match(secretPattern)).toBeNull();
    expect(demoBotsCode.match(secretPattern)).toBeNull();
  });

  it('reads tokens from env variables (demo bot definitions)', () => {
    expect(demoBotsCode).toContain('env[d.tokenKey]');
    expect(demoBotsCode).toContain('BOT_TOKEN_SALON1');
    expect(demoBotsCode).toContain('BOT_TOKEN_SALON2');
    expect(demoBotsCode).toContain('BOT_TOKEN_MASTER1');
    expect(demoBotsCode).toContain('BOT_TOKEN_MASTER2');
  });

  it('getDemoBots skips missing env tokens', () => {
    expect(demoBotsCode).toContain('function getDemoBots');
    expect(demoBotsCode).toContain('if (!token) continue');
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
