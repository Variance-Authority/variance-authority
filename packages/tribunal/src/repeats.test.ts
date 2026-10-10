import { describe, expect, it } from 'vitest';
import type { ReviewStore } from './review.js';
import type { SubjectView } from './review-types.js';
import { createReviewStore } from './review.js';
import { CANDIDATE, PREVIOUS, image, ingest, openReview, report } from './__fixtures__/review.js';

/**
 * The earlier builds of this project that kept the image a subject renders now.
 *
 * A candidate is stored under the SHA-256 of its bytes, so two builds that kept
 * one key kept one picture. What a reviewer decided about that picture before is
 * the part of the record a before-and-after cannot show: a render rejected in
 * build 4 that is back in build 9 is the same defect, not a new one.
 */

const CHANGED = 'story:todos--populated';
const UNCHANGED = 'story:toolbar';

/** A build of the fixture report at `at`, whose changed subject kept `after`. */
async function push(
  review: ReviewStore,
  build: string,
  at: string,
  after: string = CANDIDATE,
): Promise<void> {
  const base = ingest();
  await review.ingest({
    ...base,
    build,
    report: report({ at }),
    images: {
      [CHANGED]: { ...base.images[CHANGED], after: { ...base.images[CHANGED]!.after!, bytes: after } },
    },
  });
}

async function subject(review: ReviewStore, build: string, name = CHANGED): Promise<SubjectView> {
  const detail = await review.build(build);
  const found = detail?.subjects.find((each) => each.subject === name);
  if (found === undefined) throw new Error(`build ${build} has no ${name}`);
  return found;
}

describe('the earlier builds that kept the same image', () => {
  it('names a build that rejected this image, with the decision as it was recorded', async () => {
    const { review } = await openReview();
    await push(review, 'ci-1000', '2026-06-01T09:00:00.000Z');
    await review.decide({
      build: 'ci-1000',
      subject: CHANGED,
      decision: 'rejected',
      by: 'marina',
      note: 'the toggle lost its focus ring',
    });
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');

    expect((await subject(review, 'ci-1001')).repeats).toEqual({
      count: 1,
      builds: [
        {
          build: 'ci-1000',
          at: '2026-06-01T09:00:00.000Z',
          decision: {
            decision: 'rejected',
            by: 'marina',
            at: '2026-06-01T12:00:00.000Z',
            note: 'the toggle lost its focus ring',
          },
        },
      ],
    });
  });

  it('names a build that approved this image', async () => {
    const { review } = await openReview();
    await push(review, 'ci-1000', '2026-06-01T09:00:00.000Z');
    await review.decide({ build: 'ci-1000', subject: CHANGED, decision: 'approved', by: 'marina' });
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');

    expect((await subject(review, 'ci-1001')).repeats?.builds[0]?.decision).toEqual({
      decision: 'approved',
      by: 'marina',
      at: '2026-06-01T12:00:00.000Z',
    });
  });

  it('names a build nobody decided with a null decision', async () => {
    const { review } = await openReview();
    await push(review, 'ci-1000', '2026-06-01T09:00:00.000Z');
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');

    expect((await subject(review, 'ci-1001')).repeats).toEqual({
      count: 1,
      builds: [{ build: 'ci-1000', at: '2026-06-01T09:00:00.000Z', decision: null }],
    });
  });

  it('reads the latest decision of a build that was decided twice', async () => {
    const { review } = await openReview();
    await push(review, 'ci-1000', '2026-06-01T09:00:00.000Z');
    await review.decide({ build: 'ci-1000', subject: CHANGED, decision: 'approved', by: 'marina' });
    await review.decide({ build: 'ci-1000', subject: CHANGED, decision: 'rejected', by: 'anton' });
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');

    expect((await subject(review, 'ci-1001')).repeats?.builds[0]?.decision).toMatchObject({
      decision: 'rejected',
      by: 'anton',
    });
  });

  it('is an empty answer for a candidate no earlier build kept', async () => {
    const { review } = await openReview();
    await push(review, 'ci-1000', '2026-06-01T09:00:00.000Z', PREVIOUS);
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');
    await push(review, 'ci-1002', '2026-06-01T11:00:00.000Z');

    expect((await subject(review, 'ci-1001')).repeats).toEqual({ count: 0, builds: [] });
  });

  it('is absent for a subject that kept no candidate', async () => {
    const { review } = await openReview();
    await push(review, 'ci-1000', '2026-06-01T09:00:00.000Z');
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');

    expect(await subject(review, 'ci-1001', UNCHANGED)).not.toHaveProperty('repeats');
  });

  it('counts neither another subject nor another project that kept the same bytes', async () => {
    const { db, bucket, review } = await openReview();
    const other = createReviewStore({
      db,
      bucket,
      project: 'other',
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    });
    await push(other, 'ci-1000', '2026-06-01T09:00:00.000Z');
    const base = ingest();
    await review.ingest({
      ...base,
      build: 'ci-0999',
      report: report({
        at: '2026-06-01T08:00:00.000Z',
        observations: report().observations.map((each) =>
          each.subject === UNCHANGED
            ? { ...each, verdict: 'changed', because: 'the rendered image differs from the baseline' }
            : each,
        ),
      }),
      images: { [UNCHANGED]: base.images[CHANGED]! },
    });
    await push(review, 'ci-1001', '2026-06-01T10:00:00.000Z');

    expect((await subject(review, 'ci-1001')).repeats).toEqual({ count: 0, builds: [] });
  });

  it('puts decided builds first, latest decision first, and names at most eight', async () => {
    const { review } = await openReview();
    for (let hour = 0; hour < 10; hour += 1) {
      await push(review, `ci-${1000 + hour}`, `2026-06-01T0${hour}:00:00.000Z`);
    }
    await review.decide({ build: 'ci-1001', subject: CHANGED, decision: 'approved', by: 'anton' });
    await review.decide({ build: 'ci-1000', subject: CHANGED, decision: 'rejected', by: 'marina' });
    await push(review, 'ci-1010', '2026-06-01T10:00:00.000Z', image([1, 2, 3]));
    await push(review, 'ci-1011', '2026-06-01T11:00:00.000Z');

    const repeats = (await subject(review, 'ci-1011')).repeats;
    expect(repeats?.count).toBe(10);
    expect(repeats?.builds.map((each) => each.build)).toEqual([
      'ci-1000',
      'ci-1001',
      'ci-1009',
      'ci-1008',
      'ci-1007',
      'ci-1006',
      'ci-1005',
      'ci-1004',
    ]);
  });
});
