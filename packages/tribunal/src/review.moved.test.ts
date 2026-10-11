// A decision taken against a baseline that is no longer there. Two reviewers
// with the same subject open, or a newer build promoted while one of them was
// still reading: the page each of them is looking at describes a baseline the
// store has since replaced. It is treated the way a merge treats code: changes
// that do not touch pass, and only an overlap is refused.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest, RenderIdentity } from '@variance-authority/core/format';
import { BaselineMoved, ReviewError, type ReviewStore } from './review.js';
import { CANDIDATE, IDENTITY, POSTED, ingest, openReview } from './__fixtures__/review.js';
import type { RegionRecord } from '@variance-authority/report';
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

/**
 * The fixture's build under another id, painted from another document, and
 * changed where `regions` says when it is given, with more found than kept when
 * `truncated` says so.
 */
function later(
  build: string,
  documentDigest: string,
  identity?: RenderIdentity,
  regions?: readonly RegionRecord[],
  truncated?: { readonly regions: number; readonly pixels: number },
): BuildIngest {
  const base = ingest();
  const images = base.images?.[SUBJECT];
  const after = { ...images?.after, documentDigest: documentDigest as Digest };
  const report =
    regions === undefined
      ? base.report
      : {
          ...base.report,
          observations: base.report.observations.map((each) =>
            each.subject === SUBJECT ? { ...each, regions, ...(truncated === undefined ? {} : { truncated }) } : each,
          ),
        };
  return {
    ...base,
    build,
    report,
    images: { [SUBJECT]: { ...images, after: identity === undefined ? after : { ...after, identity } } },
  } as BuildIngest;
}

/** A change in the corner the fixture's regions never reach. */
const ELSEWHERE: readonly RegionRecord[] = [{ x: 100, y: 100, width: 10, height: 10, pixels: 40 }];
/** A change across the fixture's first region. */
const THERE: readonly RegionRecord[] = [{ x: 5, y: 5, width: 10, height: 10, pixels: 40 }];

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
    // The two versions travel as fields too, so a page can say them in its own
    // words instead of reprinting the sentence under a headline of its own.
    await expect(stale).rejects.toMatchObject({ read: null, current: 'feedface' });
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
    ).rejects.toMatchObject({ message: expect.stringMatching(/no baseline.*cafebabe/s), read: null, current: 'cafebabe' });
  });

  it('names a baseline that is gone as none standing', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface'));
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });
    await db.prepare("DELETE FROM baselines WHERE subject = ?").bind(SUBJECT).run();

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: SUBJECT,
        decision: 'approved',
        by: 'marina',
        baselineVersion: 'feedface',
      }),
    ).rejects.toMatchObject({ read: 'feedface', current: null });
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
        decision: 'approved',
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

describe('an approval whose baseline moved, read the way a merge reads code', () => {
  /** A baseline both builds start from, then another build approved over it. */
  async function movedBy(
    regions: readonly RegionRecord[],
    truncated?: { readonly regions: number; readonly pixels: number },
  ): Promise<string | null | undefined> {
    await accepted('0ddba11', IDENTITY);
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface', undefined, regions, truncated));
    const read = await versionOf('ci-1001');
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });
    return read;
  }

  it('goes through when the change that moved it is somewhere this one is not', async () => {
    const read = await movedBy(ELSEWHERE);

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: read ?? null,
    });
    expect(record.decision).toBe('approved');
    expect(await versionOf('ci-1001')).toBe('deadbeef');
  });

  it('is refused where the two changes overlap, naming the build that moved it', async () => {
    const read = await movedBy(THERE);

    const clash = review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: read ?? null,
    });
    await expect(clash).rejects.toBeInstanceOf(BaselineMoved);
    await expect(clash).rejects.toThrow(/ci-1002.*reload/s);
    await expect(clash).rejects.toMatchObject({ read: '0ddba11', current: 'feedface' });
  });

  it('is refused when any change since it read overlaps, not only the last', async () => {
    const read = await movedBy(THERE);
    await review.ingest(later('ci-1003', 'c0ffee', undefined, ELSEWHERE));
    await review.decide({ build: 'ci-1003', subject: SUBJECT, decision: 'approved', by: 'anton' });

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: SUBJECT,
        decision: 'approved',
        by: 'marina',
        baselineVersion: read ?? null,
      }),
    ).rejects.toBeInstanceOf(BaselineMoved);
  });

  it('is refused when a run wrote over an approval that did not overlap, since a run says no regions', async () => {
    const read = await movedBy(ELSEWHERE);
    await accepted('cafebabe', IDENTITY);

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: SUBJECT,
        decision: 'approved',
        by: 'marina',
        baselineVersion: read ?? null,
      }),
    ).rejects.toMatchObject({ read: '0ddba11', current: 'cafebabe' });
  });

  it('goes through when the change that moved it names no region at all', async () => {
    // A build whose image moved and whose regions are empty changed nowhere
    // anybody drew; there is nothing for this one to meet.
    const read = await movedBy([]);

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: read ?? null,
    });
    expect(record.decision).toBe('approved');
  });

  it('is refused when the change that moved it kept fewer regions than it found', async () => {
    // The regions it dropped may be exactly where this build changed it.
    const read = await movedBy(ELSEWHERE, { regions: 40, pixels: 9000 });

    await expect(
      review.decide({
        build: 'ci-1001',
        subject: SUBJECT,
        decision: 'approved',
        by: 'marina',
        baselineVersion: read ?? null,
      }),
    ).rejects.toThrow(/ci-1002.*more changed regions than it kept/s);
  });

  it('goes through when a later approval under another identity did not overlap either', async () => {
    // A Retina baseline is another file; approving it moves nothing this one
    // replaces, and it is not what wrote the baseline standing here.
    const read = await movedBy(ELSEWHERE);
    await review.ingest(later('ci-1003', 'c0ffee', RETINA, ELSEWHERE));
    await review.decide({ build: 'ci-1003', subject: SUBJECT, decision: 'approved', by: 'anton' });

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: read ?? null,
    });
    expect(record.decision).toBe('approved');
  });

  it('goes through when what stands now is already this build\'s image', async () => {
    await review.ingest(ingest());
    const read = await versionOf('ci-1001');
    await review.decide({ build: 'ci-1001', subject: SUBJECT, decision: 'approved', by: 'anton' });

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'approved',
      by: 'marina',
      baselineVersion: read ?? null,
    });
    expect(record.decision).toBe('approved');
  });
});

describe('a rejection whose baseline moved', () => {
  it('is recorded, since it promotes nothing a newer baseline could lose', async () => {
    await review.ingest(ingest());
    await review.ingest(later('ci-1002', 'feedface', undefined, THERE));
    await review.decide({ build: 'ci-1002', subject: SUBJECT, decision: 'approved', by: 'anton' });

    const record = await review.decide({
      build: 'ci-1001',
      subject: SUBJECT,
      decision: 'rejected',
      by: 'marina',
      baselineVersion: null,
    });
    expect(record.decision).toBe('rejected');
    expect(await versionOf('ci-1001')).toBe('feedface');
  });
});
