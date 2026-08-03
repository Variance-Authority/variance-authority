import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest, RenderIdentity } from '@variance-authority/core';
import { RasterStoreError } from '@variance-authority/raster';
import type { RunReport } from '@variance-authority/report';
import { createBucketStore } from './store.js';
import { ReviewError, createReviewStore, type BuildIngest, type ReviewStore } from './review.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const CANDIDATE = image([0, 0, 0]);
const PREVIOUS = image([255, 255, 255]);

function image(colour: readonly [number, number, number]): string {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = colour[0];
    png.data[index + 1] = colour[1];
    png.data[index + 2] = colour[2];
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

/**
 * A report as `variance run` writes one: two subjects changed by one edit, where
 * the reflowed container carries six times the pixels of the component that was
 * actually edited.
 */
function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runVersion: 1,
    at: '2026-06-01T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    intent: 'tighten the toolbar',
    observations: [
      {
        subject: 'story:todos--populated',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 1530,
        regions: [
          {
            x: 0, y: 0, width: 10, height: 10, pixels: 86,
            component: 'Toggle', file: 'src/ds/components.tsx', cause: true,
          },
          {
            x: 0, y: 20, width: 40, height: 20, pixels: 511,
            component: 'Stack', file: 'src/ds/components.tsx', cause: false,
          },
        ],
        findings: [],
      },
      {
        subject: 'story:toolbar',
        verdict: 'unchanged',
        because: 'the document digests to what the baseline was painted from',
        changedPixels: 0,
        regions: [],
      },
    ],
    notObserved: [
      { subject: 'story:modal', kind: 'failed', because: 'the renderer crashed on navigation' },
      { subject: 'story:legacy', kind: 'excluded', because: 'excluded by config' },
    ],
    ...overrides,
  };
}

function ingest(overrides: Partial<BuildIngest> = {}): BuildIngest {
  return {
    build: 'ci-1001',
    commit: 'abc123',
    branch: 'feat/toolbar',
    report: report(),
    images: {
      'story:todos--populated': {
        after: {
          bytes: CANDIDATE,
          documentDigest: 'deadbeef' as Digest,
          width: 2,
          height: 2,
          missingFonts: [],
        },
        before: { bytes: PREVIOUS },
        diff: { bytes: PREVIOUS },
      },
    },
    ...overrides,
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
});

describe('a build is the report a run already wrote', () => {
  it('reproduces the verdicts, regions and findings the report carried', async () => {
    await review.ingest(ingest());

    const detail = await review.build('ci-1001');

    expect(detail?.verdicts).toEqual({ changed: 1, unchanged: 1, new: 0, incomparable: 0 });
    expect(detail?.subjects[0]?.regions).toHaveLength(2);
    expect(detail?.subjects[0]?.findings).toEqual([]);
    expect(detail?.intent).toBe('tighten the toolbar');
  });

  it('keeps a coverage list that was never stated apart from an empty one', async () => {
    // The failure this exists to refuse: a build that planned four subjects,
    // failed on one and found the rest clean must not present as clean. And a
    // report that never said what it skipped must not present as one that skipped
    // nothing — that is a claim its writer never made.
    await review.ingest(ingest());
    await review.ingest({
      ...ingest(),
      build: 'ci-1002',
      report: { ...report(), notObserved: undefined },
    });

    const stated = await review.build('ci-1001');
    const silent = await review.build('ci-1002');

    expect(stated?.coverage).toEqual({ stated: true, failed: 1, excluded: 1 });
    expect(silent?.coverage).toEqual({ stated: false, failed: 0, excluded: 0 });
  });

  it('keeps findings that were never collected apart from a clean render', async () => {
    await review.ingest(ingest());

    const detail = await review.build('ci-1001');

    // `[]` — inspected and clean. `undefined` — nothing looked. Printing the
    // second as the first tells a reader the component is fine on the authority
    // of something that never inspected it.
    expect(detail?.subjects.find((s) => s.subject === 'story:todos--populated')?.findings).toEqual([]);
    expect(detail?.subjects.find((s) => s.subject === 'story:toolbar')).not.toHaveProperty(
      'findings',
    );
  });

  it('refuses a report from a writer this deployment does not understand', async () => {
    await expect(
      review.ingest({
        ...ingest(),
        report: { ...report(), runVersion: 2 as RunReport['runVersion'] },
      }),
    ).rejects.toThrow(ReviewError);
  });

  it('lists builds newest first', async () => {
    await review.ingest(ingest());
    await review.ingest({
      ...ingest(),
      build: 'ci-1002',
      report: { ...report(), at: '2026-06-02T10:00:00.000Z' },
    });

    expect((await review.builds()).map((build) => build.build)).toEqual(['ci-1002', 'ci-1001']);
  });
});

describe('the docket leads with causes and counts collateral', () => {
  it('ranks by cause pixels rather than by area', async () => {
    // Ranked by area this report is backwards: `Stack` was never edited, only
    // reflowed, and it carries 511px against `Toggle`'s 86. The ordering comes
    // from the tier that has provenance, so `Stack` is not a cause at all.
    await review.ingest(ingest());

    const detail = await review.build('ci-1001');

    expect(detail?.causes).toEqual([
      {
        component: 'Toggle',
        file: 'src/ds/components.tsx',
        subjects: ['story:todos--populated'],
        pixels: 86,
        collateralPixels: 511,
      },
    ]);
  });
});

describe('approval promotes an image that already exists', () => {
  it('makes the candidate the baseline the next run compares against', async () => {
    await review.ingest(ingest());
    const baselines = createBucketStore({ db, bucket, project: 'todomvc' });

    expect(await baselines.find({ subject: 'story:todos--populated' }, IDENTITY)).toBeNull();

    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'approved',
      by: 'marina',
    });

    const found = await baselines.find({ subject: 'story:todos--populated' }, IDENTITY);
    expect(found?.raster.bytes).toBe(CANDIDATE);
    expect(found?.comparable).toBe(true);
    // The cheap path has to work too, or the next run pays for an image to
    // discover what the sidecar already knew.
    expect(await baselines.describe({ subject: 'story:todos--populated' }, IDENTITY)).toMatchObject({
      documentDigest: 'deadbeef',
      comparable: true,
    });
  });

  it('writes no image that did not already exist', async () => {
    await review.ingest(ingest());
    const before = bucket.keys();

    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'approved',
      by: 'marina',
    });

    // One new key — the baseline — and its bytes are the candidate's, unchanged.
    const added = bucket.keys().filter((key) => !before.includes(key));
    expect(added).toHaveLength(1);
    expect(bucket.read(added[0] ?? '')).toBe(CANDIDATE);
  });

  it('refuses to approve a subject the run kept no candidate for', async () => {
    // The alternative would be rendering one now, and a review surface that can
    // render can record something nobody looked at.
    await review.ingest(ingest());

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: 'story:toolbar',
        decision: 'approved',
        by: 'marina',
      }),
    ).rejects.toThrow(/did not upload a candidate/);
  });

  it('refuses to approve when the candidate bytes are gone', async () => {
    await review.ingest(ingest());
    await bucket.delete(bucket.keys());

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: 'story:todos--populated',
        decision: 'approved',
        by: 'marina',
      }),
    ).rejects.toThrow(RasterStoreError);
  });

  it('rejects without touching a baseline', async () => {
    await review.ingest(ingest());
    const baselines = createBucketStore({ db, bucket, project: 'todomvc' });

    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'rejected',
      by: 'marina',
      note: 'the toggle lost its label',
    });

    expect(await baselines.find({ subject: 'story:todos--populated' }, IDENTITY)).toBeNull();
    const detail = await review.build('ci-1001');
    expect(detail?.subjects[0]?.decision).toMatchObject({
      decision: 'rejected',
      by: 'marina',
      note: 'the toggle lost its label',
    });
  });

  it('shows the latest decision and keeps the one it replaced', async () => {
    await review.ingest(ingest());
    const subject = { build: 'ci-1001', subject: 'story:todos--populated', by: 'marina' } as const;

    await review.decide({ ...subject, decision: 'rejected' });
    await review.decide({ ...subject, decision: 'approved' });

    expect((await review.build('ci-1001'))?.subjects[0]?.decision?.decision).toBe('approved');

    // Two rows, not an edit. The earlier decision is what makes the later one
    // reviewable.
    const rows = await db
      .prepare('SELECT COUNT(*) AS n FROM decisions')
      .bind()
      .first<{ readonly n: number }>();
    expect(rows?.n).toBe(2);
  });

  it('refuses a decision about a subject the build never reported', async () => {
    await review.ingest(ingest());

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: 'story:never-ran',
        decision: 'approved',
        by: 'marina',
      }),
    ).rejects.toThrow(ReviewError);
  });

  it('counts what is still waiting for somebody', async () => {
    await review.ingest(ingest());

    // `unchanged` needs nobody; the changed subject does.
    expect((await review.builds())[0]).toMatchObject({ pending: 1, decided: 0 });

    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'approved',
      by: 'marina',
    });

    expect((await review.builds())[0]).toMatchObject({ pending: 0, decided: 1 });
  });
});

describe('serving what a build kept', () => {
  it('hands back the image the run uploaded', async () => {
    await review.ingest(ingest());

    const bytes = await review.image('ci-1001', 'story:todos--populated', 'after');

    expect(bytes).not.toBeNull();
    expect(new Uint8Array(bytes ?? new ArrayBuffer(0)).byteLength).toBeGreaterThan(0);
  });

  it('answers null for an image the run did not keep', async () => {
    await review.ingest(ingest());

    expect(await review.image('ci-1001', 'story:toolbar', 'after')).toBeNull();
  });

  it('refuses to report a missing object as a run that kept nothing', async () => {
    await review.ingest(ingest());
    await bucket.delete(bucket.keys());

    await expect(review.image('ci-1001', 'story:todos--populated', 'after')).rejects.toThrow(
      /damage rather than a run that saved nothing/,
    );
  });
});

describe('retention holds nothing more than is needed', () => {
  it('removes expired builds and everything that hangs off them', async () => {
    await review.ingest(ingest());
    clock = new Date('2026-07-01T12:00:00.000Z');

    const swept = await review.sweep(7);

    expect(swept).toEqual({ builds: 1, subjects: 2, objects: 3, decisions: 0 });
    expect(await review.build('ci-1001')).toBeNull();
    expect(bucket.keys()).toEqual([]);
  });

  it('leaves a promoted baseline alone', async () => {
    // The build expires; the baseline it promoted does not. A sweep that took the
    // baseline with it would make the next run report `new` and re-record
    // whatever it painted.
    await review.ingest(ingest());
    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'approved',
      by: 'marina',
    });
    clock = new Date('2026-07-01T12:00:00.000Z');

    await review.sweep(7);

    const baselines = createBucketStore({ db, bucket, project: 'todomvc' });
    expect((await baselines.find({ subject: 'story:todos--populated' }, IDENTITY))?.raster.bytes).toBe(
      CANDIDATE,
    );
  });

  it('keeps a build inside the window', async () => {
    await review.ingest(ingest());
    clock = new Date('2026-06-03T12:00:00.000Z');

    expect(await review.sweep(7)).toEqual({ builds: 0, subjects: 0, objects: 0, decisions: 0 });
    expect(await review.build('ci-1001')).not.toBeNull();
  });

  it('reports what it removed rather than removing quietly', async () => {
    await review.ingest(ingest());
    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'approved',
      by: 'marina',
    });
    clock = new Date('2026-07-01T12:00:00.000Z');

    // Counts, not a boolean. A sweep that says only "done" leaves an operator
    // unable to tell a working retention policy from one deleting a build a day.
    expect(await review.sweep(0)).toMatchObject({ builds: 1, objects: 3, decisions: 1 });
  });

  it('refuses a retention window that is not one', async () => {
    await expect(review.sweep(-1)).rejects.toThrow(ReviewError);
  });
});
