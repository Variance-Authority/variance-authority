import { variancePrecondition } from '@variance-authority/sense/precondition';
import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { RunReport } from '@variance-authority/report';
import { createTribunal, type Tribunal } from './worker.js';
import { createMemoryR2, createSqliteD1 } from './testing.js';

/**
 * What a machine holding the share token may read about review: what was
 * decided, by whom, and what it settled — and never the act of deciding.
 */

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';
const SHARE = 'share-token-0123456789';
const ORIGIN = 'https://variance.example.com';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const BYTES = (() => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return PNG.sync.write(png).toString('base64');
})();

function buildOf(build: string, subjects: readonly string[]): unknown {
  return {
    build,
    commit: 'abc',
    report: {
      runVersion: 1,
      at: '2026-06-01T10:00:00.000Z',
      identity: IDENTITY,
      retention: 'durable',
      observations: subjects.map((subject) => ({
        subject,
        verdict: 'changed',
        because: 'it moved',
        changedPixels: 4,
        regions: [],
      })),
    } as unknown as RunReport,
    images: Object.fromEntries(
      subjects.map((subject) => [
        subject,
        { after: { bytes: BYTES, documentDigest: `digest-${subject}`, width: 2, height: 2, missingFonts: [] } },
      ]),
    ),
  };
}

let worker: Tribunal;

beforeEach(async () => {
  variancePrecondition({ network: 'stubbed' });
  worker = createTribunal({
    db: await createSqliteD1(),
    bucket: createMemoryR2(),
    project: 'todomvc',
    ingestToken: INGEST,
    reviewToken: REVIEW,
    shareToken: SHARE,
  });
});

function call(path: string, token: string, body?: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function decided(): Promise<void> {
  expect((await call('/review/builds', INGEST, buildOf('ci-1', ['story:a', 'story:b']))).status).toBe(201);
  expect((await call('/review/builds', INGEST, buildOf('ci-2', ['story:a']))).status).toBe(201);
  const decide = async (build: string, subject: string, decision: string, note?: string) =>
    expect(
      (await call(`/review/builds/${build}/subjects/${subject}/decision`, REVIEW, {
        decision,
        by: 'marina',
        ...(note === undefined ? {} : { note }),
      })).status,
    ).toBe(200);
  await decide('ci-1', 'story:a', 'rejected', 'the border is wrong');
  await decide('ci-1', 'story:a', 'approved', 'the border was the point');
  await decide('ci-1', 'story:b', 'approved');
  await decide('ci-2', 'story:a', 'rejected');
}

describe('the share token reads what review settled', () => {
  it('reads the changelog of approvals', async () => {
    variancePrecondition({ token: 'share' });
    await decided();
    const response = await call('/review/changelog?subject=story:a', SHARE);
    expect(response.status).toBe(200);
    // An approval with no region has no change to be grouped under, so it is ungrouped.
    const changelog = (await response.json()) as {
      changes: unknown[];
      ungrouped: { build: string; subject: string; by: string; note?: string }[];
    };
    expect(changelog.changes).toEqual([]);
    expect(changelog.ungrouped.map(({ build, subject, by, note }) => ({ build, subject, by, note }))).toEqual([
      { build: 'ci-1', subject: 'story:a', by: 'marina', note: 'the border was the point' },
    ]);
  });

  it('reads the decision history of a subject, newest first, with every reversal', async () => {
    variancePrecondition({ token: 'share' });
    await decided();
    const response = await call('/review/decisions?subject=story:a', SHARE);
    expect(response.status).toBe(200);
    const { decisions } = (await response.json()) as {
      decisions: { build: string; subject: string; decision: string; by: string; at: string; note?: string }[];
    };
    expect(decisions.map(({ at: _at, ...rest }) => rest)).toEqual([
      { build: 'ci-2', subject: 'story:a', decision: 'rejected', by: 'marina' },
      { build: 'ci-1', subject: 'story:a', decision: 'approved', by: 'marina', note: 'the border was the point' },
      { build: 'ci-1', subject: 'story:a', decision: 'rejected', by: 'marina', note: 'the border is wrong' },
    ]);
    expect(decisions.every((entry) => !Number.isNaN(Date.parse(entry.at)))).toBe(true);
  });

  it('narrows the history to a build, and to a count', async () => {
    variancePrecondition({ token: 'share' });
    await decided();
    const read = async (query: string) =>
      ((await (await call(`/review/decisions?${query}`, SHARE)).json()) as { decisions: { build: string; subject: string }[] })
        .decisions.map((entry) => `${entry.build} ${entry.subject}`);
    expect(await read('build=ci-1')).toEqual(['ci-1 story:b', 'ci-1 story:a', 'ci-1 story:a']);
    expect(await read('build=ci-1&subject=story:b')).toEqual(['ci-1 story:b']);
    expect(await read('subject=story:a&limit=2')).toEqual(['ci-2 story:a', 'ci-1 story:a']);
    expect(await read('subject=story:none')).toEqual([]);
  });

  it('refuses a history that names neither a build nor a subject, and a count past the most it reads', async () => {
    variancePrecondition({ token: 'share' });
    await decided();
    const unnarrowed = await call('/review/decisions?limit=2', SHARE);
    expect(unnarrowed.status).toBe(400);
    expect(await unnarrowed.text()).toMatch(/names a `build`, a `subject` or both/);
    const unbounded = await call('/review/decisions?subject=story:a&limit=201', SHARE);
    expect(unbounded.status).toBe(400);
    expect(await unbounded.text()).toMatch(/reads at most 200 decisions/);
  });

  it('is served the same history the review token reads', async () => {
    variancePrecondition({ token: 'review' });
    await decided();
    const shared = await (await call('/review/decisions?subject=story:a', SHARE)).json();
    const reviewed = await call('/review/decisions?subject=story:a', REVIEW);
    expect(reviewed.status).toBe(200);
    expect(await reviewed.json()).toEqual(shared);
  });

  it('cannot decide', async () => {
    variancePrecondition({ token: 'share' });
    await decided();
    const response = await call('/review/builds/ci-2/subjects/story:a/decision', SHARE, {
      decision: 'approved',
      by: 'agent',
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/never decides/);
    const history = (await (await call('/review/decisions?build=ci-2', SHARE)).json()) as { decisions: unknown[] };
    expect(history.decisions).toHaveLength(1);
  });

  it('refuses a write on a read route', async () => {
    variancePrecondition({ token: 'share' });
    expect((await call('/review/decisions', SHARE, {})).status).toBe(405);
    expect((await call('/review/changelog', SHARE, {})).status).toBe(405);
  });

  it.todo('reads the concerns raised on a build, and cannot raise or move one — needs the concerns route');
});

describe('the ingest token reads none of it', () => {
  it('is refused the changelog and the decision history, and is told why', async () => {
    variancePrecondition({ token: 'ingest' });
    for (const path of ['/review/changelog', '/review/decisions']) {
      const response = await call(path, INGEST);
      expect([path, response.status]).toEqual([path, 403]);
      const text = await response.text();
      expect(text).toMatch(/CI holds the ingest token/);
      expect(text).toMatch(/the share token/);
    }
  });
});
