/**
 * 0074 — Worker side of the favorite-master flow.
 *
 *   1. `getFavoriteMasterId(ctx, cid)` walks the manual pin → derived
 *      history fallback exactly like the admin-app's
 *      computeFavoriteMasterSuggestion. Archived candidates are skipped.
 *   2. `getFavoriteSuggest(ctx, channel)` reads the per-channel toggle
 *      from `tenant_config` and respects the documented defaults.
 *
 * The Telegram-side reorder in `showMasterPick` is exercised by the
 * existing master-selection.test.js suite via the keyboard-shape
 * assertions; the unit test here pins the SERVICE-layer contract that
 * the UI builds on.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getFavoriteMasterId } from '../src/services/users.js';
import { getFavoriteSuggest, setFavoriteSuggest } from '../src/services/services.js';
import { createMockD1 } from './helpers/mock-db.js';

const TENANT_ID = 't_fav';

function makeCtx(db) {
  return {
    db,
    tenantId: TENANT_ID,
    prefix: `t:${TENANT_ID}:`,
    kv: {
      _store: new Map(),
      async get(key) { return this._store.get(key) ?? null; },
      async put(key, val) { this._store.set(key, val); },
      async delete(key) { this._store.delete(key); },
      async list() { return { keys: [] }; },
    },
  };
}

function insertMaster(db, m) {
  db.prepare(
    `INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at, archived_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    TENANT_ID, m.chatId, m.name || 'Master',
    m.onVacation ? 1 : 0,
    Date.now(),
    m.archivedAt ?? null,
  ).run();
}

function insertUser(db, u) {
  db.prepare(
    `INSERT OR REPLACE INTO users (tenant_id, chat_id, name, favorite_master_id)
     VALUES (?, ?, ?, ?)`
  ).bind(TENANT_ID, u.chatId, u.name || 'Client', u.favoriteMasterId ?? null).run();
}

function insertApt(db, apt) {
  db.prepare(
    `INSERT INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, cancelled, rem_h24, rem_h2, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).bind(
    apt.id, TENANT_ID, apt.chatId, apt.svcId || 'classic', apt.date, apt.time,
    apt.ts || Date.now(), apt.status || 'done',
    apt.masterId ?? null, apt.cancelled || 0, Date.now(),
  ).run();
}

describe('getFavoriteMasterId — favorite-master resolution', () => {
  let db, ctx;
  beforeEach(() => {
    db = createMockD1();
    ctx = makeCtx(db);
  });

  it('returns the manual pin when the master is active', async () => {
    insertMaster(db, { chatId: 100, name: 'Anna' });
    insertUser(db, { chatId: 42, favoriteMasterId: 100 });
    const r = await getFavoriteMasterId(ctx, 42);
    expect(r).toBe(100);
  });

  it('falls back to derived favorite when manual pin is null', async () => {
    insertMaster(db, { chatId: 200, name: 'Olga' });
    insertMaster(db, { chatId: 300, name: 'Karina' });
    insertUser(db, { chatId: 42, favoriteMasterId: null });
    // 3 visits to 200, 1 visit to 300 — 200 wins.
    insertApt(db, { id: 'a1', chatId: 42, masterId: 200, date: '2026-01-01', time: '10:00' });
    insertApt(db, { id: 'a2', chatId: 42, masterId: 200, date: '2026-02-01', time: '10:00' });
    insertApt(db, { id: 'a3', chatId: 42, masterId: 200, date: '2026-03-01', time: '10:00' });
    insertApt(db, { id: 'a4', chatId: 42, masterId: 300, date: '2026-04-01', time: '10:00' });
    const r = await getFavoriteMasterId(ctx, 42);
    expect(r).toBe(200);
  });

  it('skips an archived manual pin and falls through to history', async () => {
    insertMaster(db, { chatId: 100, name: 'GhostAnna', archivedAt: 1700000000 });
    insertMaster(db, { chatId: 200, name: 'Olga' });
    insertUser(db, { chatId: 42, favoriteMasterId: 100 });
    insertApt(db, { id: 'a1', chatId: 42, masterId: 200, date: '2026-01-01', time: '10:00' });
    const r = await getFavoriteMasterId(ctx, 42);
    expect(r).toBe(200);
  });

  it('skips an archived top-1 in the histogram and adopts the runner-up', async () => {
    insertMaster(db, { chatId: 100, name: 'Anna', archivedAt: 1700000000 });
    insertMaster(db, { chatId: 200, name: 'Olga' });
    insertUser(db, { chatId: 42, favoriteMasterId: null });
    // Anna (archived) has 3 visits, Olga (active) has 1. Olga wins.
    insertApt(db, { id: 'a1', chatId: 42, masterId: 100, date: '2026-01-01', time: '10:00' });
    insertApt(db, { id: 'a2', chatId: 42, masterId: 100, date: '2026-02-01', time: '10:00' });
    insertApt(db, { id: 'a3', chatId: 42, masterId: 100, date: '2026-03-01', time: '10:00' });
    insertApt(db, { id: 'a4', chatId: 42, masterId: 200, date: '2026-04-01', time: '10:00' });
    const r = await getFavoriteMasterId(ctx, 42);
    expect(r).toBe(200);
  });

  it('excludes cancelled appointments from the histogram', async () => {
    insertMaster(db, { chatId: 200, name: 'Olga' });
    insertUser(db, { chatId: 42 });
    insertApt(db, { id: 'a1', chatId: 42, masterId: 200, date: '2026-01-01', time: '10:00', cancelled: 1 });
    insertApt(db, { id: 'a2', chatId: 42, masterId: 200, date: '2026-02-01', time: '10:00', cancelled: 1 });
    const r = await getFavoriteMasterId(ctx, 42);
    expect(r).toBeNull();
  });

  it('returns null when there is no user row at all', async () => {
    const r = await getFavoriteMasterId(ctx, 999);
    expect(r).toBeNull();
  });

  it('returns null when D1 is not bound (legacy KV-only ctx)', async () => {
    const r = await getFavoriteMasterId({ tenantId: TENANT_ID, kv: ctx.kv }, 42);
    expect(r).toBeNull();
  });
});

describe('getFavoriteSuggest / setFavoriteSuggest — per-channel toggle', () => {
  let db, ctx;
  beforeEach(() => {
    db = createMockD1();
    ctx = makeCtx(db);
  });

  it('defaults to ON for both channels when nothing is stored', async () => {
    expect(await getFavoriteSuggest(ctx, 'web')).toBe(true);
    expect(await getFavoriteSuggest(ctx, 'telegram')).toBe(true);
  });

  it('persists a flipped value and reads it back', async () => {
    await setFavoriteSuggest(ctx, 'telegram', false);
    expect(await getFavoriteSuggest(ctx, 'telegram')).toBe(false);
    // The other channel is untouched.
    expect(await getFavoriteSuggest(ctx, 'web')).toBe(true);
  });

  it('parses string "true"/"false" the same as boolean (legacy storage)', async () => {
    db.prepare(
      `INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)`
    ).bind(TENANT_ID, 'fav_suggest_web', 'false').run();
    expect(await getFavoriteSuggest(ctx, 'web')).toBe(false);
  });
});
