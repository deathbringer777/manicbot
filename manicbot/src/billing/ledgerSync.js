/**
 * Stripe balance-transactions → D1 ledger sync.
 *
 * Mirrors Stripe `balance_transactions` into the `stripe_ledger` table so the
 * admin Billing dashboard renders multi-month real revenue / net / fees from D1
 * (fast, historical) instead of paging Stripe live on every load. Runs from the
 * 15-min cron (`scheduled` in worker.js).
 *
 * Why balance_transactions: it is the authoritative money object — it carries
 * `fee` and `net` natively (invoices do not) and includes every movement
 * (charge, refund, dispute, payout, adjustment, stripe_fee).
 *
 * Cursor model:
 *   - A high-water cursor (max `created` seen) lives in `platform_config`
 *     under `stripe_ledger_cursor`. Each run pulls `created[gte] = cursor` so
 *     only new rows are fetched; upsert-by-id makes the inclusive boundary
 *     idempotent.
 *   - First run (no cursor) is a full backfill — no `created[gte]` filter — so
 *     historical revenue seeds the chart on the first tick.
 *   - On any Stripe error the cursor is left untouched: the next cron tick
 *     retries the same window. We never advance past data we failed to store.
 */
import { listBalanceTransactions } from './stripe.js';
import { envCtx } from '../http/envCtx.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const CURSOR_KEY = 'stripe_ledger_cursor';
// Safety bound on a single run so a first-time backfill on a high-volume
// account cannot blow the cron CPU budget. At launch volume one page suffices;
// if ever exceeded we still advance the cursor and log so a manual deep
// backfill can fill the tail.
const PAGE_CAP = 50;
const PAGE_SIZE = 100;

/** balance_transaction.source may be a string id or an expanded object. */
function sourceId(source) {
  if (!source) return null;
  if (typeof source === 'string') return source;
  if (typeof source === 'object' && source.id) return String(source.id);
  return null;
}

async function readCursor(db) {
  try {
    const row = await db.prepare(`SELECT value FROM platform_config WHERE key = ?`).bind(CURSOR_KEY).first();
    if (row?.value == null) return null;
    const n = parseInt(row.value, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    // platform_config missing (migration not yet applied) → treat as first run.
    return null;
  }
}

async function writeCursor(db, value) {
  await db
    .prepare(
      `INSERT INTO platform_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(CURSOR_KEY, String(value), nowSec(), 'cron:ledger-sync')
    .run();
}

async function upsertRow(db, tx) {
  await db
    .prepare(
      `INSERT INTO stripe_ledger (id, type, reporting_category, amount, fee, net, currency, source, created, available_on, description, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, reporting_category = excluded.reporting_category, amount = excluded.amount, fee = excluded.fee, net = excluded.net, currency = excluded.currency, source = excluded.source, created = excluded.created, available_on = excluded.available_on, description = excluded.description, synced_at = excluded.synced_at`,
    )
    .bind(
      String(tx.id),
      tx.type ?? null,
      tx.reporting_category ?? null,
      Number.isFinite(tx.amount) ? tx.amount : 0,
      Number.isFinite(tx.fee) ? tx.fee : 0,
      Number.isFinite(tx.net) ? tx.net : 0,
      tx.currency ?? null,
      sourceId(tx.source),
      Number.isFinite(tx.created) ? tx.created : 0,
      Number.isFinite(tx.available_on) ? tx.available_on : null,
      tx.description ?? null,
      nowSec(),
    )
    .run();
}

/**
 * Incrementally sync Stripe balance transactions into `stripe_ledger`.
 *
 * @param {object} env Worker env (needs `DB` binding + `STRIPE_SECRET_KEY`).
 * @returns {Promise<{ synced: number, pages: number, cursor?: number, skipped?: boolean, reason?: string, error?: string, cappedOut?: boolean }>}
 */
export async function syncStripeLedger(env) {
  const secretKey = env?.STRIPE_SECRET_KEY || null;
  const db = envCtx(env).db;
  if (!secretKey) return { skipped: true, reason: 'no_key', synced: 0, pages: 0 };
  if (!db?.prepare) return { skipped: true, reason: 'no_db', synced: 0, pages: 0 };

  const cursor = await readCursor(db);
  const createdGte = cursor != null ? cursor : undefined;

  let startingAfter;
  let pages = 0;
  let synced = 0;
  let maxCreated = cursor != null ? cursor : 0;
  let cappedOut = false;

  try {
    for (;;) {
      const { data, has_more } = await listBalanceTransactions(secretKey, {
        limit: PAGE_SIZE,
        createdGte,
        startingAfter,
      });
      for (const tx of data) {
        if (!tx?.id) continue;
        await upsertRow(db, tx);
        synced++;
        if (Number.isFinite(tx.created) && tx.created > maxCreated) maxCreated = tx.created;
      }
      pages++;
      if (!has_more) break;
      if (pages >= PAGE_CAP) {
        cappedOut = true;
        break;
      }
      startingAfter = data.length ? data[data.length - 1].id : undefined;
      if (!startingAfter) break;
    }
  } catch (e) {
    log.error('billing.ledgerSync', e instanceof Error ? e : new Error(String(e?.message || e)));
    return { error: e?.message || 'sync_failed', synced, pages };
  }

  // Advance the cursor only when we actually moved forward — avoids churning
  // `updated_at` on every idle tick.
  if (maxCreated > 0 && maxCreated !== cursor) {
    await writeCursor(db, maxCreated);
  }
  if (cappedOut) {
    log.warn('billing.ledgerSync.capped', { pages, synced, cursor: maxCreated });
  }

  return { synced, pages, cursor: maxCreated, cappedOut };
}
