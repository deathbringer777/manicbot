#!/usr/bin/env node
/**
 * CI guard: fail when two D1 migration files share the same number prefix.
 *
 * Run via `npm run check-migrations` (wired into the CI `test` job next to
 * check-schema). See scripts/migration-check-utils.mjs for the rationale and
 * the frozen-collision allowlist.
 */
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  findDuplicateMigrationNumbers,
  ALLOWED_DUPLICATE_MIGRATION_NUMBERS,
} from './migration-check-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
const dupes = findDuplicateMigrationNumbers(files, ALLOWED_DUPLICATE_MIGRATION_NUMBERS);

if (dupes.length) {
  console.error('Duplicate D1 migration number(s) detected:\n');
  for (const { number, files: collided } of dupes) {
    console.error(`  ${number}: ${collided.join(', ')}`);
  }
  console.error(
    '\nwrangler tracks migrations by exact filename and applies them in\n' +
      'lexicographic order. Reusing a number is a latent ordering hazard and can\n' +
      'collide with an already-applied file in prod. Renumber the NEW migration to\n' +
      'the next free number (run `ls manicbot/migrations/` first).\n' +
      'If a collision is genuinely frozen in prod and cannot be renamed, add its\n' +
      'number to ALLOWED_DUPLICATE_MIGRATION_NUMBERS with a documented reason.',
  );
  process.exit(1);
}

console.log(`OK: ${files.length} migrations, no unexpected number collisions.`);
