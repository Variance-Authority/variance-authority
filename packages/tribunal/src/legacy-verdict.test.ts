// A row written before ADR-0090, when a cross-identity pair was stored as
// `incomparable` and never diffed. Nothing migrates it, so it pends until
// somebody decides it, exactly as a `changed` row does.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ReviewStore } from './review.js';
import { POSTED, ingest, openReview } from './__fixtures__/review.js';
import type { SqliteD1 } from './testing.js';

let db: SqliteD1;
let review: ReviewStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date(POSTED);
  ({ db, review } = await openReview(() => clock));
  await review.ingest(ingest());
  await db.prepare(`UPDATE build_subjects SET verdict = 'incomparable' WHERE verdict = 'changed'`).bind().run();
});

describe('an undecided legacy incomparable row', () => {
  it('counts as pending in the review queue', async () => {
    expect((await review.builds()).find((build) => build.build === 'ci-1001')?.pending).toBeGreaterThan(0);
  });

  it('holds its build through the sweep', async () => {
    clock = new Date('2027-06-01T12:00:00.000Z');

    expect((await review.sweep(30)).builds).toBe(0);
  });
});
