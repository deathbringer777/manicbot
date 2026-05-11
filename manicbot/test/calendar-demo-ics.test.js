/**
 * Calendar .ics — demo (preview-mode) appointments.
 *
 * Bug repro: a signed URL like `/calendar/demo_4d6y868.ics?sig=...&ts=...`
 * was rejected with "Invalid appointment ID" because the regex in
 * calendarHttp.js only accepted `a<digits>_<word>` (real appointment ids),
 * not `demo_<rnd>` ids minted by saveApt() in preview mode.
 *
 * Fix scope:
 *   1. saveApt(previewMode=true) caches the synthetic apt + its service spec
 *      in the (un-prefixed) KV namespace under `mb_demo_apt:<id>` with 24h TTL.
 *   2. tryCalendar() accepts demo_* ids and serves an ICS file straight from
 *      the cached snapshot (no DB lookup, no tenant resolution).
 */
import { describe, it, expect } from 'vitest';
import { saveApt } from '../src/services/appointments.js';
import { tryCalendar } from '../src/http/calendarHttp.js';
import { makeCalendarUrl } from '../src/utils/ics.js';
import { makeMockKv } from './helpers/mock-db.js';

const SECRET = 'a'.repeat(64);
const APP_BASE_URL = 'https://manicbot.com';

const PREVIEW_SVC = {
  id: 'classic',
  e: '💅',
  dur: 60,
  price: 45,
};

function makePreviewCtx(kv) {
  return {
    kv,
    globalKv: kv,
    db: null,
    tenantId: 't_preview',
    previewMode: true,
    svc: [PREVIEW_SVC],
    APP_BASE_URL,
    BOT_ENCRYPTION_KEY: SECRET,
  };
}

function makeCalendarCtx(kv) {
  return {
    kv,
    globalKv: kv,
    db: null,
    APP_BASE_URL,
    BOT_ENCRYPTION_KEY: SECRET,
  };
}

describe('calendar .ics — demo (preview) appointments', () => {
  it('saveApt(previewMode) caches synthetic apt + service in globalKv under mb_demo_apt:<id>', async () => {
    const kv = makeMockKv();
    const ctx = makePreviewCtx(kv);
    const saved = await saveApt(ctx, {
      chatId: 42,
      svcId: 'classic',
      date: '2026-05-10',
      time: '14:00',
    });
    expect(saved.previewOnly).toBe(true);
    expect(saved.id).toMatch(/^demo_/);

    const cached = await kv.get(`mb_demo_apt:${saved.id}`, 'json');
    expect(cached).toBeTruthy();
    expect(cached.apt.id).toBe(saved.id);
    expect(cached.apt.svcId).toBe('classic');
    expect(cached.svc.id).toBe('classic');
    expect(cached.svc.dur).toBe(60);
  });

  it('tryCalendar serves ICS for a valid demo_* id with matching signature', async () => {
    const kv = makeMockKv();
    const previewCtx = makePreviewCtx(kv);
    const saved = await saveApt(previewCtx, {
      chatId: 42,
      svcId: 'classic',
      date: '2026-05-10',
      time: '14:00',
    });

    const url = await makeCalendarUrl(previewCtx, saved.id);
    expect(url).toBeTruthy();

    const calendarCtx = makeCalendarCtx(kv);
    const res = await tryCalendar(new Request(url), calendarCtx, new URL(url));
    expect(res).toBeTruthy();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/calendar/);
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain(`UID:${saved.id}@manicbot`);
    expect(body).toContain('SUMMARY:');
  });

  it('tryCalendar rejects demo_* id when signature missing/invalid', async () => {
    const kv = makeMockKv();
    const previewCtx = makePreviewCtx(kv);
    const saved = await saveApt(previewCtx, {
      chatId: 42,
      svcId: 'classic',
      date: '2026-05-10',
      time: '14:00',
    });

    const calendarCtx = makeCalendarCtx(kv);
    const url = `${APP_BASE_URL}/calendar/${saved.id}.ics?sig=deadbeef&ts=${Math.floor(Date.now() / 1000)}`;
    const res = await tryCalendar(new Request(url), calendarCtx, new URL(url));
    expect(res.status).toBe(403);
  });

  it('tryCalendar 404s when demo apt cache has expired (no row)', async () => {
    const kv = makeMockKv();
    const calendarCtx = makeCalendarCtx(kv);
    const url = await makeCalendarUrl(calendarCtx, 'demo_ghost123');
    const res = await tryCalendar(new Request(url), calendarCtx, new URL(url));
    expect(res.status).toBe(404);
  });

  it('regex still rejects garbage ids (XSS-style probes)', async () => {
    const kv = makeMockKv();
    const calendarCtx = makeCalendarCtx(kv);
    const bad = `${APP_BASE_URL}/calendar/<script>.ics?sig=x&ts=1`;
    const res = await tryCalendar(new Request(bad), calendarCtx, new URL(bad));
    expect(res.status).toBe(400);
  });

  it('regex still accepts legitimate a<digits>_<word> ids', async () => {
    const kv = makeMockKv();
    const calendarCtx = makeCalendarCtx(kv);
    const url = await makeCalendarUrl(calendarCtx, 'a1745000000_xyz');
    const res = await tryCalendar(new Request(url), calendarCtx, new URL(url));
    // No DB → 503 Service unavailable (this is the expected production path,
    // not 400 Invalid appointment ID — meaning the regex passed).
    expect([503, 404]).toContain(res.status);
  });
});
