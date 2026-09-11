import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest, RenderIdentity } from '@variance-authority/core/format';
import type { RunReport } from '@variance-authority/report';
import { createReviewStore, type BuildIngest, type ReviewStore } from './review.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';

/**
 * What this database can say about its own baselines, after the builds are gone.
 *
 * The property that matters is not that a row is written — it is that the row
 * still answers once `sweep` has taken the build it came from. A changelog
 * implemented as a view over `builds` would pass every other test here and then
 * report "nothing was ever approved" the day the retention window first closed,
 * which is the failure the whole subsystem exists to refuse.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const BRAND = 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SPACING = 'v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function pixels(): string {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return PNG.sync.write(png).toString('base64');
}

const CANDIDATE = pixels();

function report(): RunReport {
  return {
    runVersion: 1,
    at: '2026-06-01T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    intent: 'tighten the card',
    observations: [
      {
        subject: 'story:card--small',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 120,
        regions: [
          {
            x: 0, y: 0, width: 10, height: 10, pixels: 120,
            component: 'Card', file: 'src/Card.tsx', cause: true, fingerprint: BRAND,
          },
        ],
      },
      {
        subject: 'story:card--large',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 80,
        regions: [
          {
            x: 0, y: 0, width: 10, height: 8, pixels: 80,
            component: 'Card', file: 'src/Card.tsx', cause: true, fingerprint: BRAND,
          },
        ],
      },
      {
        subject: 'story:stack',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 40,
        regions: [{ x: 0, y: 0, width: 4, height: 10, pixels: 40, cause: false, fingerprint: SPACING }],
      },
    ],
  };
}

function candidate(): BuildIngest['images'] {
  const image = {
    after: {
      bytes: CANDIDATE,
      documentDigest: 'deadbeef' as Digest,
      width: 2,
      height: 2,
      missingFonts: [],
    },
  };
  return {
    'story:card--small': image,
    'story:card--large': image,
    'story:stack': image,
  };
}

let db: SqliteD1;
let bucket: MemoryR2;
let review: ReviewStore;
let clock: Date;

beforeEach(async () => {
  db = await createSqliteD1();
  bucket = createMemoryR2();
  clock = new Date('2026-06-01T12:00:00.000Z');
  review = createReviewStore({ db, bucket, project: 'todomvc', now: () => clock });
  await review.ingest({
    build: 'ci-1001',
    commit: 'abc123',
    branch: 'feat/card',
    report: report(),
    images: candidate(),
  });
});

async function approve(subject: string, by = 'marina'): Promise<void> {
  await review.decide({ build: 'ci-1001', subject, decision: 'approved', by });
}

describe('the changelog is written where the baseline is written', () => {
  it('groups approvals by what changed rather than by which screenshot changed', async () => {
    await approve('story:card--small');
    await approve('story:card--large', 'anton');

    const { changes } = await review.changelog();

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      fingerprint: BRAND,
      component: 'Card',
      file: 'src/Card.tsx',
      intent: 'tighten the card',
    });
    // Deliberately absent. A changed-pixel count is bound to the machine that
    // rendered it, and this row outlives the build it was measured on — the
    // regions are kept instead, because a region is where the change was.
    expect(changes[0]).not.toHaveProperty('pixels');
    // Two people approved halves of one change, and both are named. A single
    // `by` would attribute the whole shape to whoever clicked last — which is
    // also why the list is in approval order, newest first, rather than sorted.
    expect(changes[0]?.by).toEqual(['anton', 'marina']);
    expect(changes[0]?.subjects).toEqual(['story:card--large', 'story:card--small']);
  });

  it('records nothing for a rejection, because no baseline changed', async () => {
    await review.decide({
      build: 'ci-1001',
      subject: 'story:card--small',
      decision: 'rejected',
      by: 'marina',
    });

    const { changes, ungrouped } = await review.changelog();
    expect(changes).toEqual([]);
    expect(ungrouped).toEqual([]);
  });

  it('still explains the baseline after the build it came from was swept', async () => {
    await approve('story:card--small');

    // A year on. Everything a reviewer looked at is gone; the approval is not.
    clock = new Date('2027-06-01T12:00:00.000Z');
    const swept = await review.sweep(30);
    expect(swept.builds).toBe(1);
    expect(await review.build('ci-1001')).toBeNull();

    const { changes } = await review.changelog();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.component).toBe('Card');
    expect(changes[0]?.builds).toEqual(['ci-1001']);
  });

  it('refuses to rewrite or delete an entry, in the database rather than in code', async () => {
    await approve('story:card--small');

    await expect(
      db.prepare("UPDATE changelog SET decided_by = 'somebody'").bind().run(),
    ).rejects.toThrow(/append-only/);
    await expect(db.prepare('DELETE FROM changelog').bind().run()).rejects.toThrow(/append-only/);
  });

  it('narrows by component without shrinking the change it reports', async () => {
    await approve('story:card--small');
    await approve('story:card--large');
    await approve('story:stack');

    const { changes, ungrouped } = await review.changelog({ component: 'card' });

    expect(changes).toHaveLength(1);
    expect(changes[0]?.subjects).toHaveLength(2);
    // The unattributed approval is real and is not this filter's business. Listing
    // it here would answer a question about `Card` with a row that names nothing.
    expect(ungrouped).toEqual([]);
  });

  it('reports a shape whole when asked about one of the subjects it reached', async () => {
    await approve('story:card--small');
    await approve('story:card--large');

    const { changes } = await review.changelog({ subject: 'story:card--small' });

    expect(changes).toHaveLength(1);
    // One row was read; the shape it carries is reported as what it is. A group of
    // one would say the change was smaller than it was.
    expect(changes[0]?.subjects).toEqual(['story:card--small']);
    expect(changes[0]?.fingerprint).toBe(BRAND);
  });

  it('counts an approval no shape could group rather than dropping it', async () => {
    await review.ingest({
      build: 'ci-1002',
      commit: 'def456',
      report: {
        ...report(),
        observations: [
          {
            subject: 'story:plain',
            verdict: 'changed',
            because: 'the rendered image differs from the baseline',
            changedPixels: 10,
            regions: [{ x: 0, y: 0, width: 1, height: 10, pixels: 10, cause: false }],
          },
        ],
      },
      images: {
        'story:plain': {
          after: {
            bytes: CANDIDATE,
            documentDigest: 'deadbeef' as Digest,
            width: 2,
            height: 2,
            missingFonts: [],
          },
        },
      },
    });
    await review.decide({
      build: 'ci-1002',
      subject: 'story:plain',
      decision: 'approved',
      by: 'marina',
    });

    const { changes, ungrouped } = await review.changelog();
    expect(changes).toEqual([]);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0]?.subject).toBe('story:plain');
  });
});
