/**
 * Worker notification writers — PR3 source-level coverage.
 *
 * Pins the new + restored bell writers shipped with the i18n + push
 * preferences rollout:
 *
 *   - dispatchAppointmentInApp is exported (was private)
 *   - notifyStaffAptCancelled mirrors into the bell (was Telegram-only)
 *   - notifyStaffAptRescheduled was added
 *   - dispatchAppointmentAutomation drops a bell row per lifecycle event
 *   - the reschedule path in adminKeyHttp wires notifyStaffAptRescheduled
 *
 * Behavioral coverage of notifyWebUser itself lives in
 * notify-web-user.test.ts (admin-app) and user-notify.test.js (Worker).
 * These are pin tests — they assert the wiring, not the runtime fanout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NOTIFS = resolve(__dirname, '../src/notifications.js');
const AUTOM = resolve(__dirname, '../src/services/appointmentAutomations.js');
const ADMIN = resolve(__dirname, '../src/http/adminKeyHttp.js');
const USER_NOTIFY = resolve(__dirname, '../src/services/userNotify.js');

describe('Worker notification writers — PR3 wiring', () => {
  it('dispatchAppointmentInApp is exported from notifications.js', () => {
    const src = readFileSync(NOTIFS, 'utf8');
    expect(src).toMatch(/export async function dispatchAppointmentInApp/);
  });

  it('notifyStaffAptCancelled drops a bell row via dispatchAppointmentInApp', () => {
    const src = readFileSync(NOTIFS, 'utf8');
    const idx = src.indexOf('export async function notifyStaffAptCancelled');
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx);
    // The bell mirror call must live inside the same function — we
    // look for it before the next `export ` token to be safe.
    const nextExport = after.indexOf('\nexport ', 10);
    const block = nextExport === -1 ? after : after.slice(0, nextExport);
    expect(block).toMatch(/dispatchAppointmentInApp\([^,]+, [^,]+, [^,]+, ['"]appointment\.cancelled['"]/);
  });

  it('notifyStaffAptRescheduled exists + uses appointment.rescheduled kind', () => {
    const src = readFileSync(NOTIFS, 'utf8');
    expect(src).toMatch(/export async function notifyStaffAptRescheduled/);
    const block = src.slice(src.indexOf('notifyStaffAptRescheduled'));
    expect(block).toMatch(/kind: 'appointment\.rescheduled'/);
    expect(block).toMatch(/sourceSlug: 'appointment'/);
  });

  it('dispatchAppointmentAutomation drops a bell row per lifecycle event', () => {
    const src = readFileSync(AUTOM, 'utf8');
    expect(src).toMatch(/dropAppointmentInAppForStaff/);
    expect(src).toMatch(/EVENT_INAPP_TITLE/);
    expect(src).toMatch(/'appointment\.done':/);
    expect(src).toMatch(/'appointment\.no_show_master':/);
    expect(src).toMatch(/'appointment\.confirmed':/);
    expect(src).toMatch(/'appointment\.rejected':/);
    expect(src).toMatch(/'appointment\.cancelled':/);
    expect(src).toMatch(/'appointment\.rescheduled':/);
  });

  it('adminKeyHttp reschedule path wires notifyStaffAptRescheduled', () => {
    const src = readFileSync(ADMIN, 'utf8');
    expect(src).toMatch(/notifyStaffAptRescheduled/);
  });

  it('userNotify.js consults notification_prefs before fanning out', () => {
    const src = readFileSync(USER_NOTIFY, 'utf8');
    expect(src).toMatch(/from '\.\/notificationPrefs\.js'/);
    expect(src).toMatch(/loadPrefsForWebUser/);
    expect(src).toMatch(/shouldDeliver\(kind, prefs, 'inapp'\)/);
    expect(src).toMatch(/shouldDeliver\(kind, prefs, 'push'\)/);
    // Self-test bypass: support.test always delivers even if user opted out.
    expect(src).toMatch(/kind !== 'support\.test'/);
  });
});
