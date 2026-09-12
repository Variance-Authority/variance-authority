import { beforeEach, describe, expect, it } from 'vitest';
import { claim, digestOf, have, keep, unreferenced } from './objects.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';
import type { Digest } from '@variance-authority/core/format';
import { createBucketStore } from './store.js';
import { CANDIDATE, IDENTITY, PREVIOUS, POSTED, ingest, openReview, report } from './__fixtures__/review.js';
import type { ReviewStore } from './review.js';

/**
 * One object per picture, and a ledger that can name the ones nothing wants.
 *
 * The two properties here are the ones content addressing exists for and the one
 * it costs. Storing bytes the bucket already holds must write nothing; and
 * because a baseline, the candidate it was promoted from and the `before` of
 * every run since are now *one object*, deleting per build would delete a live
 * baseline — so nothing may be deleted except what no row refers to.
 */

const BYTES = new TextEncoder().encode('the same picture, twice').buffer;
const OTHER = new TextEncoder().encode('a different picture').buffer;

let db: SqliteD1;
let bucket: MemoryR2;

beforeEach(async () => {
  db = await createSqliteD1();
  bucket = createMemoryR2();
});

describe('keep', () => {
  it('puts the same bytes at one key, however many times it is asked', async () => {
    const first = await keep(db, bucket, 'shop', BYTES, 1_000);
    const again = await keep(db, bucket, 'shop', BYTES, 2_000);

    expect(again).toBe(first);
    expect(bucket.keys()).toEqual([first]);
  });

  it('scopes the key to the project, so two repositories never share an object', async () => {
    const mine = await keep(db, bucket, 'shop', BYTES, 1_000);
    const theirs = await keep(db, bucket, 'docs', BYTES, 1_000);

    expect(mine).not.toBe(theirs);
  });

  it('measures idleness from the last time anything wanted the bytes', async () => {
    // `at_ms` is not the object's birthday. A picture re-stored by every run of a
    // green suite is never idle, and a window over its birth would collect the
    // baseline of the most-run subject in the project.
    await keep(db, bucket, 'shop', BYTES, 1_000);
    await keep(db, bucket, 'shop', BYTES, 9_000);

    expect(await unreferenced(db, 'shop', 5_000)).toEqual([]);
    expect(await unreferenced(db, 'shop', 10_000)).toHaveLength(1);
  });

  it('rewrites an object whose ledger row outlived it', async () => {
    // The crash window: the row is claimed before the bytes are written, so an
    // interruption between them leaves a key nothing can fetch. Believing the row
    // would hand the next baseline a pointer to an object that never landed.
    const key = await keep(db, bucket, 'shop', BYTES, 1_000);
    await bucket.delete(key);

    expect(await keep(db, bucket, 'shop', BYTES, 2_000)).toBe(key);
    expect(bucket.keys()).toEqual([key]);
  });
});

describe('unreferenced', () => {
  it('names an object no row points at, and never one a row does', async () => {
    const orphan = await keep(db, bucket, 'shop', BYTES, 1_000);
    const spoken = await keep(db, bucket, 'shop', OTHER, 1_000);
    await db
      .prepare(
        `INSERT INTO baselines
           (project, identity_digest, subject, label, identity, document_digest,
            width, height, missing_fonts, object_key, at, at_ms)
         VALUES ('shop', 'id', 'story:card', '', '{}', 'd', 1, 1, '[]', ?, 'now', 1)`,
      )
      .bind(spoken)
      .run();

    expect(await unreferenced(db, 'shop', 2_000)).toEqual([orphan]);
  });

  it('collects the orphan a crash left, which nothing could previously even name', async () => {
    // `store.ts` has always said an object written before its row "is removed by
    // the next sweep". It never was: every key the sweep knew came from a row,
    // and `R2Like` has no `list` — deliberately — so an object whose row was
    // never written was unreachable forever. The ledger is what makes it
    // ordinary.
    await keep(db, bucket, 'shop', BYTES, 1_000);

    expect(await unreferenced(db, 'shop', 2_000)).toHaveLength(1);
  });
});

describe('a build and the baseline it is promoted to', () => {
  let review: ReviewStore;
  let store: { db: SqliteD1; bucket: MemoryR2 };
  let clock: Date;

  beforeEach(async () => {
    clock = new Date(POSTED);
    const opened = await openReview(() => clock);
    store = { db: opened.db, bucket: opened.bucket };
    review = opened.review;
  });

  it('stores one object for two images that are the same picture', async () => {
    // The fixture's `before` and `diff` are the same bytes. Three images, two
    // objects — and under the old keys it was three, because the key carried the
    // kind.
    await review.ingest(ingest());

    expect(store.bucket.keys()).toHaveLength(2);
    expect(store.bucket.read(store.bucket.keys()[0] ?? '')).toBeDefined();
  });

  it('stores nothing new when the next build uploads the picture again', async () => {
    await review.ingest(ingest());
    const after = store.bucket.keys();

    await review.ingest({ ...ingest(), build: 'ci-1002', report: { ...report(), at: '2026-06-02T10:00:00.000Z' } });

    // An unchanged suite used to cost a full set of objects per build: S subjects
    // over B builds was S x B objects holding S pictures.
    expect(store.bucket.keys()).toEqual(after);
  });

  it('will not delete a picture one build is done with and another still shows', async () => {
    // The cost of the dedupe, and the whole reason for the ledger query. The two
    // builds share the candidate; sweeping the first must not blind the second.
    await review.ingest(ingest());
    await review.ingest({
      ...ingest(),
      build: 'ci-1002',
      report: { ...report(), at: '2026-06-20T10:00:00.000Z' },
    });
    for (const build of ['ci-1001', 'ci-1002']) {
      await review.decide({ build, subject: 'story:todos--populated', decision: 'rejected', by: 'marina' });
    }

    clock = new Date('2026-06-21T12:00:00.000Z');
    await review.sweep(7);

    expect(await review.build('ci-1001')).toBeNull();
    expect(await review.build('ci-1002')).not.toBeNull();
    expect(
      await review.image('ci-1002', 'story:todos--populated', 'after'),
    ).not.toBeNull();
    expect(store.bucket.keys()).toHaveLength(2);
  });

  it('drops a render cache entry nothing has wanted for the window, and its bytes', async () => {
    // The one table here that nothing ever removed a row from. An entry is pure
    // optimisation, so the loss of one costs a re-render of a document nothing
    // asked for in the whole retention period.
    const baselines = createBucketStore({ db: store.db, bucket: store.bucket, project: 'todomvc', now: () => clock });
    await baselines.renderCache?.put({
      documentDigest: 'cafebabe' as Digest,
      identity: IDENTITY,
      width: 2,
      height: 2,
      missingFonts: [],
      bytes: CANDIDATE,
    });
    expect(store.bucket.keys()).toHaveLength(1);

    clock = new Date('2026-07-01T12:00:00.000Z');
    expect(await review.sweep(7)).toMatchObject({ cached: 1, objects: 1 });
    expect(store.bucket.keys()).toEqual([]);
  });

  it('keeps the object a promoted baseline shares with the build that proposed it', async () => {
    await review.ingest(ingest());
    await review.decide({
      build: 'ci-1001',
      subject: 'story:todos--populated',
      decision: 'approved',
      by: 'marina',
    });
    clock = new Date('2026-07-01T12:00:00.000Z');

    await review.sweep(7);

    // The candidate and the baseline are one object, so the sweep that removes
    // the build has to leave it. `before` and `diff` go.
    expect(store.bucket.keys()).toHaveLength(1);
    expect(store.bucket.read(store.bucket.keys()[0] ?? '')).toBe(CANDIDATE);
    expect(store.bucket.read(store.bucket.keys()[0] ?? '')).not.toBe(PREVIOUS);
  });
});

/**
 * The question a run asks before it uploads anything.
 *
 * `have` is what makes content addressing pay: a run holding an image this
 * deployment already stores names it instead of sending it, and on an unchanged
 * suite that is nearly every image — including the `before` of every subject,
 * which *is* the baseline this deployment handed the run in the first place.
 *
 * Answering must not keep bytes alive, or a client could pin the whole history
 * of a project by asking about it. What it must *not* do is verify the bytes:
 * the ledger is the answer, for the price argued in `objects.ts` — one query per
 * 99 digests instead of two round trips per digest, which is the difference
 * between a request a free Worker can serve and one it cannot.
 */
describe('have', () => {
  it('says yes only about bytes this project actually holds', async () => {
    await keep(db, bucket, 'shop', BYTES, 1_000);
    const held = await digestOf(BYTES);
    const absent = await digestOf(OTHER);

    expect(await have(db, 'shop', [held, absent])).toEqual([held]);
  });

  it('answers about one project at a time', async () => {
    await keep(db, bucket, 'shop', BYTES, 1_000);

    // The key is project-scoped, so another project's object is not an object
    // this one may point a build at.
    expect(await have(db, 'docs', [await digestOf(BYTES)])).toEqual([]);
  });

  it('answers from the ledger, and does not go to the bucket to confirm it', async () => {
    const key = await keep(db, bucket, 'shop', BYTES, 1_000);
    await bucket.delete(key);

    // A row whose object is gone is a window that opens only when a process dies
    // between two adjacent writes, and closing it cost a `head` per digest — two
    // round trips per image on a question whose whole purpose is to save work.
    // The cost of being wrong here is a broken image on a review page; the
    // remedy is the same one the refusal offered, which is to push again.
    expect(await have(db, 'shop', [await digestOf(BYTES)])).toEqual([
      await digestOf(BYTES),
    ]);
  });

  it('asks in groups, so a build with more digests than D1 takes parameters is one query each', async () => {
    // D1 binds 100 values per statement and `project` is one of them. A suite
    // naming 600 images used to spend 1,200 subrequests here; the ceiling on a
    // free Worker is 50.
    const digests = [...Array.from({ length: 250 }).keys()].map((n) =>
      n.toString(16).padStart(64, '0'),
    );
    const kept = await digestOf(BYTES);
    await keep(db, bucket, 'shop', BYTES, 1_000);

    expect(await have(db, 'shop', [...digests, kept])).toEqual([kept]);
  });

  it('ignores anything that is not a key this deployment could have written', async () => {
    expect(await have(db, 'shop', ['', 'not-a-digest', 'A'.repeat(64)])).toEqual([]);
  });

  it('does not keep the bytes alive by being asked about them', async () => {
    // A question is not a reference. If asking touched `at_ms`, a client polling
    // a digest would hold an object no build points at for as long as it kept
    // asking, and retention would quietly stop meaning anything.
    await keep(db, bucket, 'shop', BYTES, 1_000);

    await have(db, 'shop', [await digestOf(BYTES)]);

    expect(await unreferenced(db, 'shop', 2_000)).toHaveLength(1);
  });
});

describe('claim', () => {
  it('returns the key and marks the bytes as wanted again', async () => {
    const key = await keep(db, bucket, 'shop', BYTES, 1_000);

    expect(await claim(db, 'shop', await digestOf(BYTES), 9_000)).toBe(key);
    // The sweep's window runs from the last time something wanted the object,
    // and a build naming it wants it — otherwise a suite that stopped uploading
    // its unchanged pictures would watch them age out from under it.
    expect(await unreferenced(db, 'shop', 5_000)).toEqual([]);
  });

  it('refuses bytes this deployment does not hold', async () => {
    expect(await claim(db, 'shop', await digestOf(BYTES), 1_000)).toBeNull();
  });
});
