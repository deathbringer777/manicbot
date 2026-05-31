/**
 * Attachment GC — orphaned messenger R2 object sweep (cron phaseAttachmentGc).
 * Dry-run by default; deletes only when ATTACHMENT_GC_DELETE='1' AND the key is
 * referenced by no live message AND the deletion is past the 7d grace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn() }));

import { createMockD1 } from './helpers/mock-db.js';
import { phaseAttachmentGc } from '../src/handlers/cron.js';
import { extractCdnKey, extractAttachmentKeys } from '../src/services/attachmentKeys.js';
import { logEvent } from '../src/utils/events.js'; // mocked above — asserted on for dry-run observability

const KEY = 't/t_a/chat_attachment-abc123def456.png';
const att = (key) =>
  JSON.stringify({ attachments: [{ url: `https://cdn.example/cdn/${key}`, kind: 'image' }] });

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const OLD = NOW_SEC - 8 * 24 * 60 * 60; // 8d ago — past the 7d grace
const RECENT = NOW_SEC - 60; // within grace

function ctxWith(rows, { del = false, assetsDelete } = {}) {
  const db = createMockD1();
  const table = db._getTable('thread_messages');
  for (const r of rows) table.push(r);
  const ctx = { db, tenantId: 't_a' };
  if (del) ctx.ATTACHMENT_GC_DELETE = '1';
  if (assetsDelete) ctx.ASSETS = { delete: assetsDelete };
  return ctx;
}

describe('extractCdnKey / extractAttachmentKeys', () => {
  it('extracts the key after /cdn/', () => {
    expect(extractCdnKey(`https://h/cdn/${KEY}`)).toBe(KEY);
  });
  it('strips query + fragment', () => {
    expect(extractCdnKey(`https://h/cdn/${KEY}?v=1#x`)).toBe(KEY);
  });
  it('returns null for non-cdn urls', () => {
    expect(extractCdnKey('https://h/other.png')).toBeNull();
    expect(extractCdnKey(null)).toBeNull();
  });
  it('parses attachments_json into keys', () => {
    expect(extractAttachmentKeys(att(KEY))).toEqual([KEY]);
    expect(extractAttachmentKeys('not json')).toEqual([]);
    expect(extractAttachmentKeys(null)).toEqual([]);
  });
});

describe('phaseAttachmentGc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dry-run by default — never deletes', async () => {
    const del = vi.fn();
    const ctx = ctxWith(
      [{ id: 'm1', tenant_id: 't_a', deleted_at: OLD, attachments_json: att(KEY) }],
      { assetsDelete: del },
    );
    await phaseAttachmentGc(ctx, 't_a', NOW_MS);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes an orphan key when ATTACHMENT_GC_DELETE=1', async () => {
    const del = vi.fn();
    const ctx = ctxWith(
      [{ id: 'm1', tenant_id: 't_a', deleted_at: OLD, attachments_json: att(KEY) }],
      { del: true, assetsDelete: del },
    );
    await phaseAttachmentGc(ctx, 't_a', NOW_MS);
    expect(del).toHaveBeenCalledWith(KEY);
  });

  it('keeps a key still referenced by a LIVE message', async () => {
    const del = vi.fn();
    const ctx = ctxWith(
      [
        { id: 'm1', tenant_id: 't_a', deleted_at: OLD, attachments_json: att(KEY) },
        { id: 'm2', tenant_id: 't_a', deleted_at: null, attachments_json: att(KEY) },
      ],
      { del: true, assetsDelete: del },
    );
    await phaseAttachmentGc(ctx, 't_a', NOW_MS);
    expect(del).not.toHaveBeenCalled();
  });

  it('skips soft-deleted messages within the grace period', async () => {
    const del = vi.fn();
    const ctx = ctxWith(
      [{ id: 'm1', tenant_id: 't_a', deleted_at: RECENT, attachments_json: att(KEY) }],
      { del: true, assetsDelete: del },
    );
    await phaseAttachmentGc(ctx, 't_a', NOW_MS);
    expect(del).not.toHaveBeenCalled();
  });

  it('tenant isolation: GC for tenant A never touches tenant B objects', async () => {
    const del = vi.fn();
    const KEY_A = 't/t_a/chat_attachment-aaa111.png';
    const KEY_B = 't/t_b/chat_attachment-bbb222.png';
    const db = createMockD1();
    const table = db._getTable('thread_messages');
    // t_a: old soft-deleted orphan referencing KEY_A.
    table.push({ id: 'a1', tenant_id: 't_a', deleted_at: OLD, attachments_json: att(KEY_A) });
    // t_b: an old orphan + a LIVE reference — both must be invisible to t_a's sweep.
    table.push({ id: 'b1', tenant_id: 't_b', deleted_at: OLD, attachments_json: att(KEY_B) });
    table.push({ id: 'b2', tenant_id: 't_b', deleted_at: null, attachments_json: att(KEY_B) });
    const ctx = { db, tenantId: 't_a', ATTACHMENT_GC_DELETE: '1', ASSETS: { delete: del } };

    await phaseAttachmentGc(ctx, 't_a', NOW_MS);

    expect(del).toHaveBeenCalledWith(KEY_A);
    expect(del).toHaveBeenCalledTimes(1); // only tenant A's orphan
    expect(del).not.toHaveBeenCalledWith(KEY_B); // never tenant B's object
  });

  it('dry-run log carries enriched observability fields (count, sample keys, per-candidate age)', async () => {
    // dry-run (ATTACHMENT_GC_DELETE unset)
    const ctx = ctxWith([{ id: 'm1', tenant_id: 't_a', deleted_at: OLD, attachments_json: att(KEY) }]);

    await phaseAttachmentGc(ctx, 't_a', NOW_MS);

    const call = logEvent.mock.calls.find((c) => c[1] === 'cron.attachment_gc.dryrun');
    expect(call, 'expected a cron.attachment_gc.dryrun event').toBeTruthy();
    const payload = call[2];
    expect(payload.totalCandidates).toBe(1);
    expect(payload.orphanCount).toBe(1);
    expect(payload.sampleKeys).toContain(KEY);
    expect(Array.isArray(payload.samples)).toBe(true);
    expect(payload.samples[0]).toMatchObject({ key: KEY });
    expect(typeof payload.samples[0].ageSec).toBe('number');
    expect(payload.samples[0].ageSec).toBeGreaterThan(0);
  });
});
