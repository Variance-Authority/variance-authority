import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpLineCell } from './http-line.js';
import { findEntry, publishLine, readLine } from './publish.js';

const MAIN = { kind: 'mainline', name: 'release/2.0' } as const;
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** A bucket that honours `If-Match` and `If-None-Match: *`, as S3 and tribunal do. */
function bucket(): { held: Map<string, { bytes: Uint8Array; etag: string }>; requests: string[] } {
  const held = new Map<string, { bytes: Uint8Array; etag: string }>();
  const requests: string[] = [];
  let next = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array }) => {
      const method = init?.method ?? 'GET';
      requests.push(`${method} ${url}`);
      const headers = init?.headers ?? {};
      if (headers['authorization'] !== 'Bearer ok') return reply(403);
      const current = held.get(url);
      if (method === 'GET') return current === undefined ? reply(404) : reply(200, current.bytes, current.etag);
      if (headers['if-none-match'] === '*' && current !== undefined) return reply(412);
      if (headers['if-match'] !== undefined && headers['if-match'] !== current?.etag) return reply(412);
      next += 1;
      held.set(url, { bytes: init!.body!, etag: `"${String(next)}"` });
      return reply(200);
    }),
  );
  return { held, requests };
}

function reply(status: number, bytes = new Uint8Array(), etag?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'etag' ? etag ?? null : null) },
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

const options = { endpoint: 'https://objects.test/va/', headers: { authorization: 'Bearer ok' } };
const descends = async (): Promise<boolean> => false;
const image = async (): Promise<Uint8Array> => ascii('png');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpLineCell', () => {
  it('publishes and reads a line at its path, with images beside every line', async () => {
    variancePrecondition({ network: 'stubbed', remote: 'accepts' });
    const { requests } = bucket();
    const cell = httpLineCell(options);
    const digest = 'd'.repeat(64);
    await publishLine(cell, MAIN, [{ name: 'report-v1', commit: 'cccc', bytes: ascii('r'), images: [digest] }], { descends, image });
    expect(requests).toContain(`PUT https://objects.test/va/images/${digest}`);
    expect(requests.at(-1)).toBe('PUT https://objects.test/va/mainline/release/2.0/manifest.json');

    const read = await readLine(cell, MAIN);
    if ('kind' in read) throw new Error(read.kind);
    const entry = findEntry(read.manifest, 'report-v1');
    if ('kind' in entry) throw new Error(entry.kind);
    expect(await read.entry(entry)).toEqual(ascii('r'));
    expect(await read.image(digest)).toEqual(ascii('png'));
  });

  it('writes the manifest against the ETag it read, and re-reads when it moved', async () => {
    variancePrecondition({ network: 'stubbed', remote: 'accepts' });
    const { held } = bucket();
    const cell = httpLineCell(options);
    await publishLine(cell, MAIN, [{ name: 'suite-v1/web', commit: 'cccc', bytes: ascii('w') }], { descends, image });
    const moving = {
      ...cell,
      async store(...args: Parameters<typeof cell.store>) {
        const manifest = [...held.keys()].find((url) => url.endsWith('manifest.json'))!;
        held.set(manifest, { ...held.get(manifest)!, etag: '"moved"' });
        moving.store = cell.store;
        return cell.store(...args);
      },
    };
    const result = await publishLine(moving, MAIN, [{ name: 'suite-v1/app', commit: 'cccc', bytes: ascii('a') }], { descends, image });
    expect(result).toMatchObject({ written: ['suite-v1/app'], attempts: 2 });
  });

  it('tells nothing published from a refusal', async () => {
    variancePrecondition({ network: 'stubbed', remote: 'refuses' });
    bucket();
    expect(await readLine(httpLineCell(options), MAIN)).toEqual({ kind: 'absent' });
    expect(await readLine(httpLineCell({ endpoint: options.endpoint }), MAIN)).toMatchObject({ kind: 'refused' });
  });

  it("says the store's own reason with a refusal, and answers a store that failed as unreachable", async () => {
    variancePrecondition({ network: 'stubbed', remote: 'refuses' });
    const answers: Record<string, { status: number; type?: string; body?: string }> = {
      json: { status: 422, type: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'the key names "Feature"\nand not "feature"' }) },
      text: { status: 405, type: 'text/plain', body: 'share is not routed here' },
      page: { status: 400, type: 'text/html', body: '<h1>Bad Request</h1>' },
      busy: { status: 429 },
      failed: { status: 500, type: 'application/json', body: JSON.stringify({ error: 'the disk is full' }) },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const answer = answers[url.split('/')[3]!]!;
      const bytes = ascii(answer.body ?? '');
      return {
        ok: false,
        status: answer.status,
        headers: { get: (name: string) => (name === 'content-type' ? answer.type ?? null : null) },
        arrayBuffer: async () => bytes.slice().buffer,
        text: async () => answer.body ?? '',
      };
    }));
    const read = (name: string) => readLine(httpLineCell({ endpoint: `https://objects.test/${name}` }), MAIN);

    expect(await read('json')).toEqual({
      kind: 'refused',
      detail: 'https://objects.test/json/mainline/release/2.0/manifest.json: HTTP 422: the key names "Feature" and not "feature"',
    });
    expect(await read('text')).toEqual({
      kind: 'refused',
      detail: 'https://objects.test/text/mainline/release/2.0/manifest.json: HTTP 405: share is not routed here',
    });
    expect(await read('page')).toEqual({ kind: 'refused', detail: 'https://objects.test/page/mainline/release/2.0/manifest.json: HTTP 400' });
    expect(await read('busy')).toEqual({ kind: 'unreachable', detail: 'https://objects.test/busy/mainline/release/2.0/manifest.json: HTTP 429' });
    expect(await read('failed')).toEqual({
      kind: 'unreachable',
      detail: 'https://objects.test/failed/mainline/release/2.0/manifest.json: HTTP 500: the disk is full',
    });
  });

  it('answers a store that cannot be reached as unreachable', async () => {
    variancePrecondition({ network: 'stubbed', remote: 'unreachable' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }));
    expect(await readLine(httpLineCell(options), MAIN)).toMatchObject({ kind: 'unreachable' });
  });

  it('answers a store that takes a request and never replies as unreachable, saying it timed out', async () => {
    variancePrecondition({ network: 'loopback', remote: 'hangs' });
    const waiting: ServerResponse[] = [];
    const server = createServer((_request, response) => void waiting.push(response));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/va`;
    try {
      const cell = httpLineCell({ endpoint, timeoutMs: 200 });
      expect(await readLine(cell, MAIN)).toEqual({
        kind: 'unreachable',
        detail: `${endpoint}/mainline/release/2.0/manifest.json: timed out after 0.2 s`,
      });
      expect(waiting).toHaveLength(1);
    } finally {
      for (const response of waiting) response.destroy();
      await new Promise((done) => server.close(done));
    }
  });
});
