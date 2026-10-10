import { createHash } from 'node:crypto';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findEntry, httpLineCell, publishLine, readLine, type ShareLine } from '@variance-authority/core/share';
import { CHURN_PATH } from '@variance-authority/history';
import { FoldedKey } from './worker-http.js';
import { createTribunal, type Tribunal } from './worker.js';
import { createMemoryR2, createSqliteD1, type MemoryR2 } from './testing.js';

/**
 * The share, driven by the client that will use it.
 *
 * Every test here publishes and reads through the real `httpLineCell` and the
 * real `publishLine`, with `fetch` answered by the tribunal's own handler. A
 * route that answered its own idea of the protocol would pass a test written
 * against that idea; these pass only while the tribunal answers what the client
 * sends.
 */

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';
const SHARE = 'share-token-0123456789';
const ORIGIN = 'https://variance.example.com';

const MAIN: ShareLine = { kind: 'mainline', name: 'release/2.0' };
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const PNG = bytesOf('a picture');
const descends = async (): Promise<boolean> => false;
const image = async (): Promise<Uint8Array> => PNG;

let bucket: MemoryR2;
let worker: Tribunal;
/** Every request the client made, as `METHOD /path`, in order. */
let requests: string[];
/** Called with each request before the tribunal answers it; a test may hold one back. */
let before: (method: string, path: string) => Promise<void>;

beforeEach(async () => {
  bucket = createMemoryR2();
  variancePrecondition({ network: 'stubbed' });
  worker = createTribunal({
    db: await createSqliteD1(),
    bucket,
    project: 'todomvc',
    ingestToken: INGEST,
    reviewToken: REVIEW,
    shareToken: SHARE,
  });
  requests = [];
  before = async () => undefined;
  vi.stubGlobal(
    'fetch',
    async (url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname;
      requests.push(`${method} ${path}`);
      await before(method, path);
      return worker.fetch(
        new Request(url, {
          method,
          headers: init.headers ?? {},
          ...(init.body === undefined ? {} : { body: init.body }),
        }),
      );
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const cell = (token?: string, method?: 'PUT' | 'POST') =>
  httpLineCell({
    endpoint: `${ORIGIN}/share/`,
    ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    ...(method === undefined ? {} : { method }),
  });

const entry = (name: string, text = name) => ({
  name,
  commit: 'cccc',
  bytes: bytesOf(text),
  images: [sha256(PNG)],
});

describe('a tribunal as the store of an http share', () => {
  beforeEach(() => variancePrecondition({ token: 'ingest', remote: 'accepts' }));
  it('holds a line a writer published and a reader reads, at the path the client spells', async () => {
    const published = await publishLine(cell(INGEST), MAIN, [entry('report-v1', 'the report')], {
      descends,
      image,
    });
    expect(published).toMatchObject({ written: ['report-v1'], attempts: 1 });
    expect(requests.at(-1)).toBe('PUT /share/mainline/release/2.0/manifest.json');

    // Read with the share token: the one a machine that only reads is given.
    const read = await readLine(cell(SHARE), MAIN);
    if ('kind' in read) throw new Error(`${read.kind}: ${read.detail ?? ''}`);
    const held = findEntry(read.manifest, 'report-v1');
    if (!('digest' in held)) throw new Error(held.kind);
    expect(new TextDecoder().decode((await read.entry(held)) as Uint8Array)).toBe('the report');
    expect(await read.image(sha256(PNG))).toEqual(PNG);

    // Under the project and under `share/`, where the sweep does not look.
    expect(bucket.keys()).toEqual([
      `todomvc/share/images/${sha256(PNG)}`,
      `todomvc/share/mainline/release/2.0/entries/${sha256(bytesOf('the report'))}`,
      'todomvc/share/mainline/release/2.0/manifest.json',
    ]);
  });

  it('keeps both of two writers that race, by answering the loser with a conflict it retries', async () => {
    // Both writers read the line before either writes it, so both write the
    // first manifest with `If-None-Match: *` and exactly one can win.
    let loads = 0;
    let release = (): void => undefined;
    const bothLoaded = new Promise<void>((resolve) => (release = resolve));
    before = async (method, path) => {
      if (method !== 'GET' || !path.endsWith('/manifest.json') || loads >= 2) return;
      loads += 1;
      if (loads === 2) release();
      await bothLoaded;
    };

    const [web, api] = await Promise.all([
      publishLine(cell(INGEST), MAIN, [entry('suite-v1/web')], { descends, image }),
      publishLine(cell(INGEST), MAIN, [entry('suite-v1/api')], { descends, image }),
    ]);

    const attempts = [web, api].map((result) => ('attempts' in result ? result.attempts : result.kind));
    expect(attempts.sort()).toEqual([1, 2]);

    const read = await readLine(cell(INGEST), MAIN);
    if ('kind' in read) throw new Error(read.kind);
    expect(read.manifest.entries.map((held) => held.name)).toEqual(['suite-v1/api', 'suite-v1/web']);
  });

  it('refuses a manifest write on a version that is not the stored one', async () => {
    variancePrecondition({ remote: 'refuses' });
    await publishLine(cell(INGEST), MAIN, [entry('report-v1')], { descends, image });
    const path = `${ORIGIN}/share/mainline/release/2.0/manifest.json`;
    const put = (headers: Record<string, string>) =>
      worker.fetch(new Request(path, { method: 'PUT', headers: { authorization: `Bearer ${INGEST}`, ...headers }, body: '{}' }));

    // A writer that found no manifest, and one that read an older version.
    expect((await put({ 'if-none-match': '*' })).status).toBe(412);
    expect((await put({ 'if-match': '"0123"' })).status).toBe(412);

    const current = (await worker.fetch(new Request(path, { headers: { authorization: `Bearer ${INGEST}` } }))).headers.get('etag');
    const replaced = await put({ 'if-match': current ?? '' });
    expect(replaced.status).toBe(204);
    expect(replaced.headers.get('etag')).not.toBe(current);
  });

  it('refuses a manifest write that names no version, and stores nothing', async () => {
    variancePrecondition({ remote: 'refuses' });
    await publishLine(cell(INGEST), MAIN, [entry('report-v1')], { descends, image });
    const path = `${ORIGIN}/share/mainline/release/2.0/manifest.json`;
    const version = async () =>
      (await worker.fetch(new Request(path, { headers: { authorization: `Bearer ${INGEST}` } }))).headers.get('etag');
    const stored = await version();

    const response = await worker.fetch(
      new Request(path, { method: 'PUT', headers: { authorization: `Bearer ${INGEST}` }, body: '{}' }),
    );
    expect(response.status).toBe(428);
    expect(await response.text()).toMatch(/If-Match.*If-None-Match: \*/);
    expect(await version()).toBe(stored);

    // The client never sends one: the first publish above wrote with
    // `If-None-Match: *`, and a second writes on the version it read.
    expect(await publishLine(cell(INGEST), MAIN, [entry('report-v2')], { descends, image })).toMatchObject({
      written: ['report-v2'],
      attempts: 1,
    });
  });

  it('writes with POST the same as with PUT, for a host that routes on it', async () => {
    const published = await publishLine(cell(INGEST, 'POST'), MAIN, [entry('report-v1')], { descends, image });
    expect(published).toMatchObject({ written: ['report-v1'] });
    expect(requests.at(-1)).toBe('POST /share/mainline/release/2.0/manifest.json');
  });

  it('refuses a blob whose bytes are not the digest it is stored under', async () => {
    variancePrecondition({ remote: 'refuses' });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/share/images/${'d'.repeat(64)}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${INGEST}` },
        body: PNG,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(sha256(PNG));
    expect(bucket.keys()).toEqual([]);
  });

  it('refuses a line spelled differently from how the client spells it', async () => {
    variancePrecondition({ remote: 'refuses' });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/share/branch/feature%2Fx/manifest.json`, {
        headers: { authorization: `Bearer ${INGEST}` },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses a key its store will not hold, and the publisher is told why rather than that the store failed', async () => {
    variancePrecondition({ remote: 'refuses' });
    const put = bucket.put.bind(bucket);
    vi.spyOn(bucket, 'put').mockImplementation(async (key, ...rest) => {
      if (key.endsWith('/manifest.json')) throw new FoldedKey('the object key names "feature" where this store holds "Feature"');
      return put(key, ...rest);
    });

    expect(await publishLine(cell(INGEST), MAIN, [entry('report-v1')], { descends, image })).toEqual({
      kind: 'refused',
      detail:
        `${ORIGIN}/share/mainline/release/2.0/manifest.json: HTTP 422: ` +
        'the object key names "feature" where this store holds "Feature"',
    });
  });

  it('answers only the verbs the client uses', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/share/mainline/main/manifest.json`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${INGEST}` },
      }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, PUT, POST');
  });
});

describe('who opens the share', () => {
  beforeEach(() => variancePrecondition({ store: 'seeded', remote: 'refuses' }));
  beforeEach(async () => {
    await publishLine(cell(INGEST), MAIN, [entry('report-v1')], { descends, image });
    requests = [];
  });

  it('lets the share token read and refuses it the write, before any byte is stored', async () => {
    variancePrecondition({ token: 'share' });
    expect('manifest' in (await readLine(cell(SHARE), MAIN))).toBe(true);

    const keys = bucket.keys();
    const refused = await publishLine(cell(SHARE), MAIN, [entry('report-v1', 'another report')], {
      descends,
      image,
    });
    expect(refused).toMatchObject({ kind: 'refused' });
    expect(bucket.keys()).toEqual(keys);
  });

  it('refuses the review token, which decides on builds and does not open the share', async () => {
    variancePrecondition({ token: 'review' });
    expect(await readLine(cell(REVIEW), MAIN)).toMatchObject({ kind: 'refused' });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/share/mainline/release/2.0/manifest.json`, {
        headers: { authorization: `Bearer ${REVIEW}` },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('the review token');
  });

  it('refuses a caller with no token, as it refuses one everywhere else', async () => {
    variancePrecondition({ token: 'none' });
    expect(await readLine(cell(), MAIN)).toMatchObject({ kind: 'refused' });
    expect(await publishLine(cell(), MAIN, [entry('report-v1')], { descends, image })).toMatchObject({
      kind: 'refused',
    });
  });

  it('keeps the share token out of every route it does not read', async () => {
    variancePrecondition({ token: 'share' });
    for (const path of ['/review/builds', CHURN_PATH, '/baseline/find']) {
      const response = await worker.fetch(
        new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { authorization: `Bearer ${SHARE}` }, body: '{}' }),
      );
      expect([path, response.status]).toEqual([path, 403]);
    }
    const get = (path: string) =>
      worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { authorization: `Bearer ${SHARE}` } }));
    expect((await get('/review/builds')).status).toBe(403);
    // The two answers it shares with every token: the version, and a path nothing serves.
    expect((await get('/version')).status).toBe(200);
    expect((await get('/nothing/here')).status).toBe(404);
  });

  it('refuses to start with a share token that is short, or is another token', async () => {
    const db = await createSqliteD1();
    const base = { db, bucket, project: 'p', ingestToken: INGEST, reviewToken: REVIEW };
    expect(() => createTribunal({ ...base, shareToken: 'short' })).toThrow(/shorter than 16/);
    expect(() => createTribunal({ ...base, shareToken: INGEST })).toThrow(/same value as the ingest token/);
    expect(() => createTribunal({ ...base, shareToken: REVIEW })).toThrow(/same value as the review token/);
  });

  it('leaves the share alone when builds are swept', async () => {
    variancePrecondition({ token: 'review', remote: 'accepts' });
    const keys = bucket.keys();
    expect((await worker.fetch(new Request(`${ORIGIN}/review/sweep?days=0`, { method: 'POST', headers: { authorization: `Bearer ${REVIEW}` }, body: '{}' }))).status).toBe(200);
    expect(bucket.keys()).toEqual(keys);
  });
});

it.todo(
  "R2 refuses `put` with `onlyIf: { etagDoesNotMatch: '*' }` when the key exists, so two writers starting one line cannot both win — needs a workerd harness that runs this suite against a real R2 binding",
);

it.todo(
  'a line a tribunal holds reads back through `variance share` as the same entries a git share holds — needs a CLI end-to-end case with a tribunal started beside it',
);
