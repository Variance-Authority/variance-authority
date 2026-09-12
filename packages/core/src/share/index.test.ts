import { describe, expect, it, vi } from 'vitest';
import {
  firstShared,
  httpShare,
  memoryShare,
  neverFails,
  shareKey,
  type SharedCache,
} from './index.js';

const BYTES = new Uint8Array([1, 2, 3]);

describe('shareKey', () => {
  it('names a project, an artifact and a commit', () => {
    expect(shareKey({ project: 'shop', artifact: 'suite-index-v1', commit: '9f1c0b3a' }))
      .toBe('shop/suite-index-v1/9f1c0b3a.bin');
  });

  it('folds characters a path and a URL disagree about', () => {
    expect(shareKey({ project: 'apps/web', artifact: 'suite-index-v1', commit: 'a b' }))
      .toBe('apps-web/suite-index-v1/a-b.bin');
  });

  it('refuses to produce an empty segment', () => {
    expect(shareKey({ project: '///', artifact: 'x', commit: 'y' })).toBe('unnamed/x/y.bin');
  });

  it('cannot leave its own namespace', () => {
    expect(shareKey({ project: '../../etc', artifact: 'x', commit: 'y' })).toBe('etc/x/y.bin');
  });
});

describe('memoryShare', () => {
  it('round-trips bytes', async () => {
    const cache = memoryShare();
    await cache.put('a/b.bin', BYTES);
    expect(await cache.get('a/b.bin')).toEqual(BYTES);
  });

  it('answers null for a key nobody wrote', async () => {
    expect(await memoryShare().get('a/b.bin')).toBeNull();
  });

  it('copies what it is handed, so a reused buffer cannot rewrite an entry', async () => {
    const cache = memoryShare();
    const mutable = new Uint8Array([1, 2, 3]);
    await cache.put('k', mutable);
    mutable[0] = 9;
    expect(await cache.get('k')).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('neverFails', () => {
  const broken: SharedCache = {
    get: () => Promise.reject(new Error('bucket is on fire')),
    put: () => Promise.reject(new Error('bucket is still on fire')),
  };

  it('turns a failed read into a miss', async () => {
    await expect(neverFails(broken).get('k')).resolves.toBeNull();
  });

  it('turns a failed write into nothing at all', async () => {
    await expect(neverFails(broken).put('k', BYTES)).resolves.toBeUndefined();
  });

  it('passes a working backend through', async () => {
    const cache = neverFails(memoryShare());
    await cache.put('k', BYTES);
    expect(await cache.get('k')).toEqual(BYTES);
  });
});

describe('firstShared', () => {
  const of = (commit: string): string => `p/a/${commit}.bin`;

  it('takes the newest ancestor anybody published', async () => {
    const cache = memoryShare();
    await cache.put(of('older'), BYTES);
    await cache.put(of('nearer'), new Uint8Array([7]));

    const hit = await firstShared(cache, ['head', 'nearer', 'older'], of);

    expect(hit).toEqual({ commit: 'nearer', behind: 1, bytes: new Uint8Array([7]) });
  });

  it('counts how far back it had to go, because that is the health of the share', async () => {
    const cache = memoryShare();
    await cache.put(of('ancient'), BYTES);

    const hit = await firstShared(cache, ['a', 'b', 'c', 'ancient'], of);

    expect(hit?.behind).toBe(3);
  });

  it('stops at the first hit rather than asking for the rest', async () => {
    const cache = memoryShare();
    await cache.put(of('first'), BYTES);
    const get = vi.spyOn(cache, 'get');

    await firstShared(cache, ['first', 'second', 'third'], of);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('answers null when the lineage holds nothing', async () => {
    expect(await firstShared(memoryShare(), ['a', 'b'], of)).toBeNull();
  });

  it('answers null for an empty lineage without asking anything', async () => {
    const cache = memoryShare();
    const get = vi.spyOn(cache, 'get');

    expect(await firstShared(cache, [], of)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('httpShare', () => {
  const responding = (
    handler: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array }) => unknown,
  ): void => {
    vi.stubGlobal('fetch', vi.fn(handler));
  };

  it('reads a key as a path under the endpoint', async () => {
    const seen: string[] = [];
    responding((url) => {
      seen.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => BYTES.buffer.slice(0) };
    });

    const bytes = await httpShare({ endpoint: 'https://bucket.example/va/' }).get('p/a/c.bin');

    expect(seen).toEqual(['https://bucket.example/va/p/a/c.bin']);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reads every refusal as a miss', async () => {
    for (const status of [401, 403, 404, 500, 503]) {
      responding(() => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) }));
      expect(await httpShare({ endpoint: 'https://x' }).get('k')).toBeNull();
    }
  });

  it('writes with PUT and the bytes as the body', async () => {
    let seen: { method?: string; headers?: Record<string, string>; body?: Uint8Array } | undefined;
    responding((_url, init) => {
      seen = init;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    });

    await httpShare({ endpoint: 'https://x', headers: { authorization: 'Bearer t' } })
      .put('k', BYTES);

    expect(seen?.method).toBe('PUT');
    expect(seen?.body).toEqual(BYTES);
    expect(seen?.headers).toEqual({
      'content-type': 'application/octet-stream',
      authorization: 'Bearer t',
    });
  });

  it('writes with the verb a deployment routes on when one is named', async () => {
    let method: string | undefined;
    responding((_url, init) => {
      method = init?.method;
      return { ok: true, status: 201, arrayBuffer: async () => new ArrayBuffer(0) };
    });

    await httpShare({ endpoint: 'https://x', method: 'POST' }).put('k', BYTES);

    expect(method).toBe('POST');
  });

  it('sends headers on a read as well as a write', async () => {
    let headers: Record<string, string> | undefined;
    responding((_url, init) => {
      headers = init?.headers;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    });

    await httpShare({ endpoint: 'https://x', headers: { authorization: 'Bearer t' } }).get('k');

    expect(headers).toEqual({ authorization: 'Bearer t' });
  });

  it('throws on a broken socket, which is what `neverFails` is wrapped around it for', async () => {
    responding(() => {
      throw new Error('ECONNRESET');
    });

    await expect(httpShare({ endpoint: 'https://x' }).get('k')).rejects.toThrow('ECONNRESET');
    await expect(neverFails(httpShare({ endpoint: 'https://x' })).get('k')).resolves.toBeNull();
  });
});
