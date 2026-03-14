import { describe, it, expect, beforeEach } from 'vitest';
import { kvGet, kvPut, kvListAll, kvDel } from '../src/utils/kv.js';

function makeMockKv() {
  const store = new Map();
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    list: async ({ prefix, cursor }) => {
      const keys = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix));
      return {
        keys: keys.map((name) => ({ name })),
        list_complete: true,
        cursor: undefined,
      };
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
}

describe('kv utils', () => {
  let ctx;

  beforeEach(() => {
    const kv = makeMockKv();
    ctx = { kv, prefix: 't:default:' };
  });

  it('kvPut and kvGet roundtrip', async () => {
    await kvPut(ctx, 'key1', { a: 1 });
    const v = await kvGet(ctx, 'key1');
    expect(v).toEqual({ a: 1 });
  });

  it('kvGet uses ctx.prefix', async () => {
    await ctx.kv.put('t:default:prefixed', JSON.stringify({ x: 1 }));
    expect(await kvGet(ctx, 'prefixed')).toEqual({ x: 1 });
  });

  it('kvListAll always scopes by ctx.prefix', async () => {
    await ctx.kv.put('t:default:u:1', '{}');
    await ctx.kv.put('t:default:u:2', '{}');
    await ctx.kv.put('b:other:u:3', '{}');
    const keys = await kvListAll(ctx, { prefix: 'u:' });
    expect(keys.map((k) => k.name)).toContain('u:1');
    expect(keys.map((k) => k.name)).toContain('u:2');
    expect(keys.map((k) => k.name)).not.toContain('u:3');
  });

  it('kvListAll with no opts prefix still lists under ctx.prefix only', async () => {
    await ctx.kv.put('t:default:st:123', '{}');
    await ctx.kv.put('t:default:st:456', '{}');
    await ctx.kv.put('t:other:st:789', '{}');
    const keys = await kvListAll(ctx, {});
    expect(keys.length).toBe(2);
    expect(keys.every((k) => k.name.startsWith('st:'))).toBe(true);
  });

  it('kvDel removes key under prefix', async () => {
    await kvPut(ctx, 'delme', { v: 1 });
    expect(await kvGet(ctx, 'delme')).not.toBeNull();
    await kvDel(ctx, 'delme');
    expect(await kvGet(ctx, 'delme')).toBeNull();
  });
});
