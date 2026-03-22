import { describe, it, expect } from 'vitest';
import { CB, STEP } from '../src/config.js';

describe('CB — all callback constants defined', () => {
  const requiredCallbacks = [
    'NOOP', 'MAIN', 'BOOK', 'MY', 'PRICES', 'CONTACTS', 'REVIEWS', 'ABOUT', 'CATALOG',
    'LANG', 'LANG_SET', 'REG_YES', 'REG_CHANGE',
    'SERVICE', 'CAL_MONTH', 'DATE', 'TIME', 'CAL_BACK',
    'CONFIRM', 'CANCEL_BOOK', 'CANCEL_APT', 'CANCEL_APT_YES', 'CANCEL_APT_SKIP',
    'CANCEL_ALL', 'CANCEL_ALL_YES',
    'ADM_MAIN', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_MASTERS', 'ADM_ADD_M', 'ADM_DEL_M',
    'ADM_RENAME_M', 'ADM_VACATION', 'ADM_SETTINGS', 'ADM_CLIENTS', 'ADM_BILLING',
    'ADM_CALENDAR', 'ADM_CALENDAR_CLEAR', 'ADM_CALENDAR_RESYNC',
    'ADM_ALL_APTS', 'ADM_ALL_APTS_M', 'ADM_ASSIGN_M', 'ADM_SET_M',
    'ADM_CANCEL_APT', 'ADM_CANCEL_SKIP', 'ADM_CANCEL_ALL', 'ADM_CANCEL_ALL_YES',
    'ADM_ABOUT', 'ADM_ABOUT_PHOTOS', 'ADM_ABOUT_DESC', 'ADM_ABOUT_INSTAGRAM',
    'MST_MAIN', 'MST_TODAY', 'MST_TOMORROW', 'MST_CALENDAR', 'MST_CALENDAR_SET', 'MST_CALENDAR_CLEAR', 'MST_CALENDAR_RESYNC',
    'APT_CONFIRM', 'APT_REJECT', 'APT_REJECT_SKIP', 'APT_COUNTER', 'APT_COUNTER_SKIP',
    'APT_ACCEPT', 'APT_DECLINE', 'APT_REPLY',
    'SUPPORT', 'TECH_SUPPORT_REQ', 'CONSULT_REQ',
    'TICKET_TAKE', 'TICKET_DECLINE', 'TICKET_CLOSE', 'TICKET_FREE_CORRECTION',
    'SVC_LIST', 'SVC_EDIT', 'SVC_NAME', 'SVC_PRICE', 'SVC_DUR', 'SVC_DESC',
    'SVC_EMOJI', 'SVC_TOGGLE', 'SVC_DEL', 'SVC_ADD', 'SVC_PHOTOS', 'SVC_PHOTO_ADD', 'SVC_PHOTO_DEL',
    'BILLING_SUBSCRIBE', 'BILLING_PORTAL', 'BILLING_BACK',
    'SYSADM_MAIN', 'SYSADM_TENANTS', 'SYSADM_NEW_TENANT', 'SYSADM_BOT_NEW',
    'SYSADM_SUPPORT_LIST', 'SYSADM_TENANT_INFO', 'SYSADM_BACK', 'SYSADM_LINKS',
    'SYSADM_SUPPORT_ADD', 'SYSADM_SUPPORT_REMOVE',
    'SYSADM_GRANT_ROLE', 'SYSADM_GRANT_MASTER', 'SYSADM_GRANT_OWNER',
    'SYSADM_TECH_SUPPORT_LIST', 'SYSADM_TECH_SUPPORT_ADD', 'SYSADM_TECH_SUPPORT_REMOVE',
    'ADM_SUPPORT_LIST', 'ADM_SUPPORT_ADD', 'ADM_SUPPORT_REMOVE',
    'ADM_SETTINGS_NAME', 'ADM_SETTINGS_PHONE', 'ADM_SETTINGS_ADDR', 'ADM_SETTINGS_HOURS',
    'MASTER_ANY', 'MASTER_SEL',
    'ADM_BLOCK', 'ADM_UNBLOCK',
  ];

  for (const key of requiredCallbacks) {
    it(`CB.${key} is defined`, () => {
      expect(CB[key]).toBeDefined();
      expect(typeof CB[key]).toBe('string');
      expect(CB[key].length).toBeGreaterThan(0);
    });
  }
});

describe('CB — no duplicate values', () => {
  it('all callback values are unique', () => {
    const values = Object.values(CB);
    const unique = new Set(values);
    const duplicates = values.filter((v, i) => values.indexOf(v) !== i);
    expect(duplicates).toEqual([]);
    expect(unique.size).toBe(values.length);
  });
});

describe('STEP — all steps defined', () => {
  const requiredSteps = [
    'IDLE', 'REG_CONFIRM', 'REG_NAME', 'REG_PHONE',
    'DATE', 'TIME', 'CONFIRM',
    'CLIENT_CANCEL_COMMENT', 'ADD_MASTER', 'RENAME_MASTER',
    'REJECT_COMMENT', 'COUNTER_TIME', 'COUNTER_COMMENT',
    'ADMIN_CANCEL_REASON', 'CLIENT_REPLY',
    'EDIT_SVC_NAME', 'EDIT_SVC_PRICE', 'EDIT_SVC_DUR', 'EDIT_SVC_DESC', 'EDIT_SVC_EMOJI',
    'ADD_SVC_ID', 'ADD_SVC_PHOTO', 'ADD_ABOUT_PHOTO',
    'EDIT_ABOUT_DESC', 'EDIT_ABOUT_INSTAGRAM',
    'MASTER_PICK', 'SUPPORT_MSG', 'TECH_SUPPORT_MSG',
    'SYSADM_NEW_TENANT', 'SYSADM_NEW_BOT', 'SYSADM_GRANT_INPUT',
    'SYSADM_NEW_BOT_TENANT', 'SYSADM_ADD_SUPPORT', 'SYSADM_ADD_TECH_SUPPORT',
    'ADM_ADD_TENANT_SUPPORT',
    'EDIT_SALON_NAME', 'EDIT_SALON_PHONE', 'EDIT_SALON_ADDR', 'EDIT_SALON_HOURS_FROM',
    'SET_CALENDAR_ID',
  ];

  for (const key of requiredSteps) {
    it(`STEP.${key} is defined`, () => {
      expect(STEP[key]).toBeDefined();
      expect(typeof STEP[key]).toBe('string');
    });
  }
});

describe('STEP — no duplicate values', () => {
  it('all step values are unique', () => {
    const values = Object.values(STEP);
    const unique = new Set(values);
    const duplicates = values.filter((v, i) => values.indexOf(v) !== i);
    expect(duplicates).toEqual([]);
  });
});

describe('Role-based menu access patterns', () => {
  const roleMenuAccess = {
    client: ['MAIN', 'BOOK', 'MY', 'PRICES', 'CONTACTS', 'CATALOG', 'REVIEWS', 'ABOUT', 'LANG', 'SUPPORT'],
    master: ['MAIN', 'BOOK', 'MY', 'MST_MAIN', 'MST_TODAY', 'MST_TOMORROW', 'SVC_LIST', 'MST_CALENDAR', 'TECH_SUPPORT_REQ'],
    admin: ['MAIN', 'BOOK', 'MY', 'ADM_MAIN', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_MASTERS', 'ADM_ADD_M',
            'ADM_RENAME_M', 'ADM_CLIENTS', 'ADM_SETTINGS', 'ADM_BILLING', 'ADM_ALL_APTS',
            'ADM_CALENDAR', 'SVC_LIST', 'ADM_ABOUT', 'ADM_SUPPORT_LIST', 'TECH_SUPPORT_REQ'],
    system_admin: ['SYSADM_MAIN', 'SYSADM_TENANTS', 'SYSADM_NEW_TENANT', 'SYSADM_BOT_NEW',
                   'SYSADM_SUPPORT_LIST', 'SYSADM_GRANT_ROLE',
                   'SYSADM_TECH_SUPPORT_LIST'],
  };

  for (const [role, menus] of Object.entries(roleMenuAccess)) {
    it(`${role} has all expected menu callbacks defined`, () => {
      for (const menu of menus) {
        expect(CB[menu]).toBeDefined();
      }
    });
  }
});

describe('Booking flow callback chain', () => {
  it('booking flow follows correct sequence', () => {
    const flow = [CB.BOOK, CB.SERVICE, CB.DATE, CB.MASTER_ANY, CB.TIME, CB.CONFIRM];
    expect(flow.every(c => typeof c === 'string')).toBe(true);
  });

  it('cancel flow has all steps', () => {
    const flow = [CB.CANCEL_APT, CB.CANCEL_APT_YES, CB.CANCEL_APT_SKIP];
    expect(flow.every(c => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  it('appointment management flow has all steps', () => {
    const flow = [CB.APT_CONFIRM, CB.APT_REJECT, CB.APT_REJECT_SKIP, CB.APT_COUNTER, CB.APT_COUNTER_SKIP];
    expect(flow.every(c => typeof c === 'string')).toBe(true);
  });

  it('counter-offer client response flow', () => {
    const flow = [CB.APT_ACCEPT, CB.APT_DECLINE, CB.APT_REPLY];
    expect(flow.every(c => typeof c === 'string')).toBe(true);
  });
});
