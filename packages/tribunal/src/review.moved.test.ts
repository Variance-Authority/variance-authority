// A decision taken against a baseline that is no longer there. Two reviewers
// with the same subject open, or a newer build promoted while one of them was
// still reading: the page each of them is looking at describes a baseline the
// store has since replaced.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest, RenderIdentity } from '@variance-authority/core/format';
import { BaselineMoved, ReviewError, type ReviewStore } from './review.js';
import { CANDIDATE, IDENTITY, POSTED, ingest, openReview } from './__fixtures__/review.js';
import type { BuildIngest } from './review-ingest-types.js';
import { createBucketStore } from './store.js';
import type { MemoryR2, SqliteD1 } from './testing.js';

const SUBJECT = 'story:todos--populated';

const RETINA: RenderIdentity = { ...IDENTITY, deviceScaleFactor: 2 };

let db: SqliteD1;
let bucket: MemoryR2;
let review: ReviewStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date(POSTED);
  ({ db, bucket, review } = await openReview(() => clock));
});

/** The fixture's build under another id, painted from another document. */
function later(build: string, documentDigest: string, identity?: RenderIdentity): BuildIngest {
  const base = ingest();
  const images = base.images?.[SUBJECT];
  const after = { ...images?.after, documentDigest: documentDigest as Digest };
  return {
    ...base,
    build,
    images: { [SUBJECT]: { ...images, after: identity === undefined ? after : { ...after, identity } } },
  } as BuildIngest;
}

/** What a run's `/baseline/put` writes: a baseline straight into the store. */
async function accepted(documentDigest: string, identity: RenderIdentity): Promise<void> {
  const baselines = createBucketStore({ db, bucket, project: 'todomvc' });
  await baselines.put(
    { subject: SUBJECT },
    {
      bytes: CANDIDATE,
      documentDigest: documentDigest as Digest,
      identity,
      width: 2,
      height: 2,
      missingFonts: [],
    },
  );
}

/** A build whose stored identity no longer reads back as one. */
async function unreadable(build: string): Promise<void> {
  await db.prepare("UPDATE builds SET identity = '{}' WHERE build = ?").bind(build).run();
}

async function versionOf(build: string): Promise<string | null | undefined> {
  const detail = await review.build(build);
  return detail?.subjects.find((subject) => subject.subject === SUBJECT)?.baselineVersion;
}

describe('the baseline version a subject carries', () => {
  it('is null while no baseline exists, and the promoted document once one does', async () => {
    await review.ingest(ingest());
    expect(await versionOf('ci-1001')).toBeNull();

    await review.decide({ build: 'ci-1001', subject: SUBJECT, decision: 'approved', by: 'marina' });
    expect(await versionOf('ci-1001')).toBe('deadbeef');
  });

  it('follows a promotion made from another build', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface'));
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });

    expect(await versionOf('ci-1001')).toBe('feedface');
  });

  it('follows a baseline a run wrote itself', async () => {
    await review.ingest(ingest());
    await accepted('cafebabe', IDENTITY);

    expect(await versionOf('ci-1001')).toBe('cafebabe');
  });

  it('is the baseline under the identity the document was painted at, not the run\'s', async () => {
    // A 2x subject in a run whose build identity says 1x: the approval files it
    // under 2x, so the 1x baseline beside it is not the one it replaces.
    await review.ingest(later('ci-1001', 'deadbeef', RETINA));
    await accepted('cafebabe', IDENTITY);
    expect(await versionOf('ci-1001')).toBeNull();

    await accepted('0ddba11', RETINA);
    expect(await versionOf('ci-1001')).toBe('0ddba11');
  });
});

describe('a decision that echoes the version it read', () => {
  it('is refused when another build promoted the subject in between', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface'));
    const read = await versionOf('ci-1001');

    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });

    const stale = review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: read ?? null,
    });
    await expect(stale).rejects.toBeInstanceOf(BaselineMoved);
    await expect(stale).rejects.toThrow(
      /story:todos--populated.*no baseline.*feedface.*reload/is,
    );
  });

  it('is refused when a run wrote the baseline in between', async () => {
    await review.ingest(ingest());
    const read = await versionOf('ci-1001');
    await accepted('cafebabe', IDENTITY);

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: SUBJECT,
        decision: 'approved',
        by: 'marina',
        baselineVersion: read ?? null,
      }),
    ).rejects.toThrow(/no baseline.*cafebabe/s);
  });

  it('is checked under the painted identity, so a baseline under the run\'s does not refuse it', async () => {
    await review.ingest(later('ci-1001', 'deadbeef', RETINA));
    await accepted('cafebabe', IDENTITY);

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: null,
    });
    expect(record.decision).toBe('approved');
  });

  it('records nothing when it is refused', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface'));
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: SUBJECT,
        decision: 'rejected',
        by: 'marina',
        baselineVersion: null,
      }),
    ).rejects.toBeInstanceOf(BaselineMoved);

    const subject = (await review.build('ci-1001'))?.subjects.find((s) => s.subject === SUBJECT);
    expect(subject?.decision).toBeNull();
    expect(await versionOf('ci-1001')).toBe('feedface');
  });

  it('goes through when the baseline is the one it read', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface'));
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: 'feedface',
    });
    expect(record.decision).toBe('approved');
    expect(await versionOf('ci-1001')).toBe('deadbeef');
  });

  it('is not checked when the decision carries no version', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface'));
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
    });
    expect(record.decision).toBe('approved');
  });

  it('is refused, not guessed at, when the build\'s identity cannot be read back', async () => {
    await review.ingest(ingest());
    await unreadable('ci-1001');

    const blind = review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: null,
    });
    await expect(blind).rejects.toBeInstanceOf(ReviewError);
    await expect(blind).rejects.not.toBeInstanceOf(BaselineMoved);
  });
});
