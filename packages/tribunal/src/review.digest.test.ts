import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { BuildIngest, ReviewStore } from './review.js';
import { ReviewError } from './review.js';
import { POSTED, decideEverything, ingest, openReview, report } from './__fixtures__/review.js';
import type { SqliteD1 } from './testing.js';

/**
 * A build that names bytes instead of carrying them.
 *
 * The upload half of `/review/have`: having been told this deployment can
 * already produce an image, a run sends its digest. What matters here is that
 * the claim is re-checked. A client can say anything, and even an honest one
 * raced the sweep between asking and posting — so the two failures are the same
 * refusal, and both of them name the subject, because the operator's next move
 * is to push the same artifact again with the bytes in it.
 */

let db: SqliteD1;
let review: ReviewStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date(POSTED);
  ({ db, review } = await openReview(() => clock));
});

describe('an image sent as a digest', () => {
  async function digestOfCandidate(): Promise<string> {
    await review.ingest(ingest());
    const row = await db
      .prepare("SELECT after_key FROM build_subjects WHERE build = 'ci-1001'")
      .first<{ after_key: string }>();
    return /([0-9a-f]{64})\.png$/.exec(String(row?.['after_key']))?.[1] ?? '';
  }

  function naming(digest: string, at = '2026-06-02T10:00:00.000Z'): BuildIngest {
    return {
      ...ingest(),
      build: 'ci-1002',
      report: { ...report(), at },
      images: {
        'story:todos--populated': {
          after: {
            digest,
            documentDigest: 'deadbeef' as Digest,
            width: 2,
            height: 2,
            missingFonts: [],
          },
        },
      },
    };
  }

  it('serves the picture the digest names, having stored nothing new', async () => {
    const digest = await digestOfCandidate();

    await review.ingest(naming(digest));

    // The second build is the whole payoff: the run uploaded a report and no
    // pixels, and the reviewer still gets an image.
    expect(await review.image('ci-1002', 'story:todos--populated', 'after')).not.toBeNull();
    expect(await review.have([digest])).toEqual([digest]);
  });

  it('keeps the bytes alive for the build that now points at them', async () => {
    const digest = await digestOfCandidate();
    clock = new Date('2026-06-18T12:00:00.000Z');
    await review.ingest(naming(digest, '2026-06-18T10:00:00.000Z'));
    await decideEverything(review, 'ci-1001');
    await decideEverything(review, 'ci-1002');

    // The first build ages out; its object does not, because a later build named
    // it. Sweeping on the build alone would blind the run that reused it.
    clock = new Date('2026-06-20T12:00:00.000Z');
    await review.sweep(14);

    expect(await review.build('ci-1001')).toBeNull();
    expect(await review.image('ci-1002', 'story:todos--populated', 'after')).not.toBeNull();
  });

  it('refuses bytes this deployment does not hold, and says what to do about it', async () => {
    const invented = 'a'.repeat(64);

    await expect(review.ingest(naming(invented))).rejects.toThrow(/story:todos--populated/);
    // No half-written build: an image that cannot be resolved is not a subject
    // whose picture 404s next week.
    await expect(review.ingest(naming(invented))).rejects.toThrow(/push it again/);
  });

  it('refuses a digest that is not one of this deployment’s keys', async () => {
    await expect(review.ingest(naming('not-a-digest'))).rejects.toThrow(ReviewError);
  });

  it('refuses an image that is neither bytes nor a digest', async () => {
    const nothing = {
      ...ingest(),
      images: { 'story:todos--populated': { after: { width: 2, height: 2, missingFonts: [] } } },
    } as unknown as BuildIngest;

    await expect(review.ingest(nothing)).rejects.toThrow(/neither/);
  });
});
