// What a push records on a baseline nobody approves again: the snapshot of an
// unchanged subject whose baseline kept none. Beside
// [`review.approve.test.ts`](./review.approve.test.ts), which records it by
// approval.

import { beforeEach, describe, expect, it } from 'vitest';
import { PACKED_SNAPSHOT_HEADER, type Digest } from '@variance-authority/core/format';
import { createBucketStore } from './store.js';
import type { ReviewStore } from './review.js';
import { IDENTITY, POSTED, ingest, openReview, report } from './__fixtures__/review.js';
import type { MemoryR2, SqliteD1 } from './testing.js';

let db: SqliteD1;
let bucket: MemoryR2;
let review: ReviewStore;

const SUBJECT = 'story:todos--populated';
const KEPT = `${PACKED_SNAPSHOT_HEADER}kept`;
const PUSHED = `${PACKED_SNAPSHOT_HEADER}pushed`;
const LATER = `${PACKED_SNAPSHOT_HEADER}later`;

beforeEach(async () => {
  ({ db, bucket, review } = await openReview(() => new Date(POSTED)));
});

/** Build `ci-1001` approved, so a baseline painted from `deadbeef` stands. */
async function approved(snapshot?: string): Promise<void> {
  await review.ingest(withAfter('ci-1001', snapshot === undefined ? {} : { snapshot }));
  await review.decide({ build: 'ci-1001', subject: SUBJECT, decision: 'approved', by: 'marina' });
}

/**
 * A build whose candidate for the subject carries these sidecar fields. Past the
 * approved one, the subject is reported unchanged, as a run that drew the
 * baseline's document reports it.
 */
function withAfter(build: string, overrides: Record<string, unknown>): Parameters<ReviewStore['ingest']>[0] {
  const base = ingest({
    build,
    ...(build === 'ci-1001'
      ? {}
      : {
          report: report({
            observations: [
              {
                subject: SUBJECT,
                verdict: 'unchanged',
                because: 'the document digests to what the baseline was painted from',
                changedPixels: 0,
                regions: [],
              },
            ],
          }),
        }),
  });
  const subject = base.images?.[SUBJECT];
  return {
    ...base,
    images: { [SUBJECT]: { ...subject, after: { ...subject?.after, ...overrides } } },
  } as Parameters<ReviewStore['ingest']>[0];
}

async function standing() {
  const baselines = createBucketStore({ db, bucket, project: 'todomvc' });
  return {
    described: await baselines.describe({ subject: SUBJECT }, IDENTITY),
    found: await baselines.find({ subject: SUBJECT }, IDENTITY),
  };
}

describe('a push of an unchanged subject whose baseline kept no snapshot', () => {
  it('records the snapshot of the run that drew the same document, so the next run settles it', async () => {
    // Approval is asked of a changed subject, so no approval would ever record
    // this one, and `settle` renders a baseline that kept no snapshot on every
    // run until one is recorded. The document is the one the image was painted
    // from, under the identity it was painted under: the tree this run read off
    // it is that image's.
    await approved();
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED }));

    const { described, found } = await standing();
    expect(described?.keepsSnapshot).toBe(true);
    expect(found?.raster.snapshot).toBe(PUSHED);
    expect(found?.raster.documentDigest).toBe('deadbeef');
  });

  it('reads the identity the candidate was painted under, as an approval does', async () => {
    await approved();
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED, identity: IDENTITY }));

    expect((await standing()).found?.raster.snapshot).toBe(PUSHED);
  });

  it('keeps the snapshot it recorded when a later push draws the same document', async () => {
    // Recorded once: the runtime fields are the recording push's, whatever ran
    // the same document after it.
    await approved();
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED }));
    await review.ingest(withAfter('ci-1003', { snapshot: LATER }));

    expect((await standing()).found?.raster.snapshot).toBe(PUSHED);
  });

  it('records nothing onto a baseline with no image, which settles without one', async () => {
    const baselines = createBucketStore({ db, bucket, project: 'todomvc' });
    await baselines.put({ subject: SUBJECT }, { identity: IDENTITY, documentDigest: 'deadbeef' as Digest, missingFonts: [] });
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED }));

    expect((await standing()).found?.raster).not.toHaveProperty('snapshot');
  });

  it('records nothing onto a labelled shot of the subject, which no approval writes', async () => {
    await approved();
    const baselines = createBucketStore({ db, bucket, project: 'todomvc' });
    const shot = (await baselines.find({ subject: SUBJECT }, IDENTITY))!.raster;
    await baselines.put({ subject: SUBJECT, label: 'open' }, shot);
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED }));

    expect((await baselines.find({ subject: SUBJECT, label: 'open' }, IDENTITY))?.raster).not.toHaveProperty(
      'snapshot',
    );
    expect((await standing()).found?.raster.snapshot).toBe(PUSHED);
  });

  it('records nothing from a document the baseline was not painted from', async () => {
    await approved();
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED, documentDigest: 'cafef00d' as Digest }));

    const { described, found } = await standing();
    expect(described?.keepsSnapshot).toBe(false);
    expect(found?.raster).not.toHaveProperty('snapshot');
  });

  it('records nothing from a document painted under another identity', async () => {
    await approved();
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED, identity: { ...IDENTITY, deviceScaleFactor: 2 } }));

    const { described } = await standing();
    expect(described?.keepsSnapshot).toBe(false);
  });

  it('never replaces a snapshot the baseline already kept', async () => {
    await approved(KEPT);
    await review.ingest(withAfter('ci-1002', { snapshot: PUSHED }));

    expect((await standing()).found?.raster.snapshot).toBe(KEPT);
  });

  it('records nothing this code cannot read', async () => {
    // A baseline that kept text with no header keeps none, and replacing it with
    // more of the same would mark nothing recorded.
    await approved();
    await review.ingest(withAfter('ci-1002', { snapshot: 'v0:older' }));

    expect((await standing()).found?.raster).not.toHaveProperty('snapshot');
  });
});
