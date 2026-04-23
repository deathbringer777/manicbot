import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('notifications.js — error resilience', () => {
  const notifPath = resolve(import.meta.dirname, '../src/notifications.js');
  const code = readFileSync(notifPath, 'utf8');

  it('notifyAptStaff uses Promise.allSettled (not Promise.all)', () => {
    const matches = code.match(/Promise\.allSettled/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('notifyAptStaff has catch handler for send failures', () => {
    expect(code).toContain("notifyAptStaff_send");
  });

  it('notifyStaffAptCancelled has catch handler for send failures', () => {
    expect(code).toContain("notifyStaffAptCancelled_send");
  });

  it('notifyStaffConsultantRequest has try/catch for send', () => {
    expect(code).toContain("notifyStaffConsultantRequest_send");
  });

  it('does not use bare Promise.all for notification sends', () => {
    const lines = code.split('\n');
    const promiseAllLines = lines.filter(l => l.includes('Promise.all(') && !l.includes('allSettled'));
    expect(promiseAllLines.length).toBe(0);
  });
});
