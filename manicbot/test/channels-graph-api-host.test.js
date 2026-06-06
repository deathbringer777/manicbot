import { describe, it, expect, vi, afterEach } from 'vitest';
import { graphPost, graphGet } from '../src/channels/graph-api.js';

afterEach(() => vi.unstubAllGlobals());

function captureFetch() {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
  return calls;
}

describe('graph-api — host routing by token type', () => {
  it('routes IGAA tokens to graph.instagram.com (graphPost)', async () => {
    const calls = captureFetch();
    await graphPost('/123/media', 'IGAAabc', {}, { label: 't' });
    expect(calls[0]).toContain('graph.instagram.com');
  });

  it('routes EAA tokens to graph.facebook.com (graphPost)', async () => {
    const calls = captureFetch();
    await graphPost('/123/media', 'EAAabc', {}, { label: 't' });
    expect(calls[0]).toContain('graph.facebook.com');
  });

  it('routes IGAA tokens to graph.instagram.com (graphGet)', async () => {
    const calls = captureFetch();
    await graphGet('/123?fields=status_code', 'IGAAabc', { label: 't' });
    expect(calls[0]).toContain('graph.instagram.com');
  });

  it('routes EAA tokens to graph.facebook.com (graphGet)', async () => {
    const calls = captureFetch();
    await graphGet('/123?fields=status_code', 'EAAabc', { label: 't' });
    expect(calls[0]).toContain('graph.facebook.com');
  });

  it('honors an explicit host override over token detection', async () => {
    const calls = captureFetch();
    await graphPost('/123/media', 'IGAAabc', {}, { label: 't', host: 'facebook' });
    expect(calls[0]).toContain('graph.facebook.com');
  });
});
