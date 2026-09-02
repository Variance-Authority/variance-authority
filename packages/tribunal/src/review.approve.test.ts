// What happens to an image after a build has been read: promotion into the
// baseline store, serving it back, and what is dropped when retention runs.
// Beside [`review.test.ts`](./review.test.ts), which stops at the build.

import { beforeEach, describe, expect, it } from 'vitest';
import { RasterStoreError } from '@variance-authority/raster';
import { createBucketStore } from './store.js';
import type { ReviewStore } from './review.js';
import { ReviewError } from './review.js';
import { CANDIDATE, IDENTITY, POSTED, ingest, openReview } from './__fixtures__/review.js';
import type { MemoryR2, SqliteD1 } from './testing.js';

let db: SqliteD1;
let bucket: MemoryR2;
let review: ReviewStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date(POSTED);
  ({ db, bucket, review } = await openReview(() => clock));
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

    expect(swept).toEqual({ builds: 1, subjects: 2, objects: 3, decisionsKept: 0 });
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

    expect(await review.sweep(7)).toEqual({ builds: 0, subjects: 0, objects: 0, decisionsKept: 0 });
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
    //
    // And the decision count is named for the opposite outcome from the three
    // beside it. Every other number here is a removal; this one is what outlived
    // the build, because an approval that went with its build is a promoted
    // baseline nobody can attribute to anyone. An operator reading `decisions: 1`
    // in a list of removals concludes the store did exactly that.
    expect(await review.sweep(0)).toMatchObject({ builds: 1, objects: 3, decisionsKept: 1 });

    const rows = await db
      .prepare('SELECT COUNT(*) AS n FROM decisions')
      .bind()
      .first<{ readonly n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('refuses a retention window that is not one', async () => {
    await expect(review.sweep(-1)).rejects.toThrow(ReviewError);
  });
});
