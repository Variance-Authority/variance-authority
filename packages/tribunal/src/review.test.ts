import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest, RenderIdentity } from '@variance-authority/core';
import { RasterStoreError } from '@variance-authority/raster';
import type { RunReport, VariationRecord } from '@variance-authority/report';
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

    expect(detail?.verdicts).toEqual({
      changed: 1,
      unchanged: 1,
      new: 0,
      incomparable: 0,
      ignored: 0,
    });
    expect(detail?.subjects[0]?.regions).toHaveLength(2);
    expect(detail?.subjects[0]?.findings).toEqual([]);
    expect(detail?.intent).toBe('tighten the toolbar');
  });

  it('carries the declaration ledgers across, because the audit outlives the run', async () => {
    // The run prints *this rule absorbed nothing* into a terminal and the terminal
    // is thrown away. A mask that has outlived its cause is only ever found by a
    // second reading — again, and again — and a service that dropped the ledger
    // could pose the question and never answer it.
    await review.ingest(
      ingest({
        report: report({
          ignores: {
            rules: [
              {
                rule: 'clock',
                reason: 'the header clock ticks',
                pixels: 0,
                subjects: 3,
                comparedIn: 3,
                inertIn: 3,
                unresolved: false,
                unwornTags: [],
                expired: false,
              },
            ],
            dead: ['clock'],
            fullyIgnored: [],
            totalPixels: 0,
            vocabulary: ['marketing'],
          },
        }),
      }),
    );

    const detail = await review.build('ci-1001');

    expect(detail?.declarations.ignores?.rules[0]?.rule).toBe('clock');
    expect(detail?.declarations.ignores?.vocabulary).toEqual(['marketing']);
    // The other half of the same record is absent, and absent is not empty: this
    // report named no sensitivities, and answering with a ledger of zero rules
    // would report an unaudited half as an audited one.
    expect(detail?.declarations.sensitivities).toBeNull();
  });

  it('answers with nothing rather than an empty ledger when the run carried none', async () => {
    await review.ingest(ingest());

    const detail = await review.build('ci-1001');

    expect(detail?.declarations).toEqual({ ignores: null, sensitivities: null });
  });

  it('keeps the baseline’s own size, and keeps its absence apart from the candidate’s', async () => {
    // Two claims a reviewer reads at once: the candidate is 2 × 2 because the run
    // said so, and the baseline was 3 × 5 because the push measured the file. The
    // second is what makes a resize visible at all — one pair of numbers for two
    // images means both get drawn to it, and a page that grew is a page that
    // looks the same.
    await review.ingest(
      ingest({
        images: {
          'story:todos--populated': {
            after: {
              bytes: CANDIDATE,
              documentDigest: 'deadbeef' as Digest,
              width: 2,
              height: 2,
              missingFonts: [],
            },
            before: { bytes: PREVIOUS, width: 3, height: 5 },
          },
        },
      }),
    );

    expect((await review.build('ci-1001'))?.subjects[0]).toMatchObject({
      size: { width: 2, height: 2 },
      baseline: { width: 3, height: 5 },
    });
  });

  it('says nothing about a baseline nothing measured, rather than the candidate’s size', async () => {
    // A push from an older CLI, or a baseline whose bytes were not a readable
    // PNG. `undefined` is the only honest answer, and the viewer has a different
    // behaviour for it: draw one layer to the frame, and claim nothing about the
    // other.
    await review.ingest(ingest());

    const subject = (await review.build('ci-1001'))?.subjects[0];

    expect(subject?.size).toEqual({ width: 2, height: 2 });
    expect(subject?.baseline).toBeUndefined();
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

    expect(stated?.coverage).toEqual({ stated: true, failed: 1, excluded: 1, unreached: 0 });
    expect(silent?.coverage).toEqual({ stated: false, failed: 0, excluded: 0, unreached: 0 });
  });

  it('reads a narrowing back as a narrowing rather than as a failure', async () => {
    // A run that skipped eighteen of twenty because the diff cannot reach them
    // is the strongest thing this tool says about work it did not do. A reader
    // that recognised `excluded` and answered `failed` to everything else would
    // turn that into eighteen red subjects, and the build would present as the
    // worst run of the week for having been the cheapest.
    await review.ingest({
      ...ingest(),
      report: {
        ...report(),
        notObserved: [
          { subject: 'route/home', kind: 'unreached', because: 'its baseline records none of it' },
          { subject: 'story:legacy', kind: 'excluded', because: 'excluded by config' },
        ],
      },
    });

    const detail = await review.build('ci-1001');

    expect(detail?.coverage).toEqual({ stated: true, failed: 0, excluded: 1, unreached: 1 });
    expect(detail?.notObserved.map((entry) => entry.kind).sort()).toEqual([
      'excluded',
      'unreached',
    ]);
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

  it('round-trips the complete presentation signal through the existing signals column', async () => {
    const presentation = {
      verdict: 'changed' as const,
      before: 'sha256:before' as never,
      after: 'sha256:after' as never,
      information: {
        contentPreserved: true,
        characters: { before: 80, after: 80, delta: 0 },
        elements: { before: 12, after: 12, delta: 0 },
        repeatedObjects: { before: 3, after: 3, delta: 0 },
      },
      effects: [{
        rule: 'SPACING_HIERARCHY_COLLISION',
        transition: 'introduced' as const,
        owner: 'r0:0/4/1',
        nodes: ['r0:0/4/1/0', 'r0:0/4/1/1'],
        contract: 'underwriter-demand-record',
        after: { finding: 'H1', measurements: { outerMedianPx: 4, innerMedianPx: 3.99 } },
      }],
    };
    const base = report();
    await review.ingest(ingest({
      report: {
        ...base,
        observations: base.observations.map((entry, index) =>
          index === 0 ? { ...entry, signals: { presentation } } : entry),
      },
    }));

    expect((await review.build('ci-1001'))?.subjects[0]?.signals?.presentation).toEqual(presentation);
  });

  it('keeps which declaration decided each green subject, not only that one did', async () => {
    // The run-level ledger says a rule absorbed 325 pixels somewhere. The
    // question a settled list asks is which rule absorbed *this* subject, and
    // for one schema version the store had no column for the answer — so the
    // service reported `the run did not record which rule` about a run that
    // recorded it, and the report and the page disagreed about the same build.
    const ignored = { pixels: 325, boxes: 1, inert: 0, byRule: { 'nav-cart-badge': 325 } };
    const relaxed = { rule: 'routes-assemble', level: 'layout', bands: ['token'] };
    const base = report();
    await review.ingest(ingest({
      report: {
        ...base,
        observations: base.observations.map((entry, index) =>
          index === 0
            ? { ...entry, verdict: 'ignored' as const, ignored }
            : index === 1
              ? { ...entry, verdict: 'ignored' as const, relaxed }
              : entry),
      },
    }));

    const detail = await review.build('ci-1001');
    expect(detail?.subjects[0]?.ignored).toEqual(ignored);
    expect(detail?.subjects[1]?.relaxed).toEqual(relaxed);
    // Absent stays absent. The two blocks are different claims — a mask over a
    // subtree, and a level this subject is not asserted on — and a store that
    // wrote an empty one in place of a missing one would report every relaxed
    // subject as having had a rule absorb nothing.
    expect(detail?.subjects[0]).not.toHaveProperty('relaxed');
    expect(detail?.subjects[1]).not.toHaveProperty('ignored');
  });

  it('keeps which components moved, and in which band, per render', async () => {
    // The half a region list cannot carry. A region is a box resolved back to a
    // name, so an edit that reflows its neighbours arrives as one blob under the
    // document root — and the store dropping this column is the difference
    // between a page that says *Button moved in its layout and its style
    // values* and one that says *487 px*.
    const moved = [
      { component: 'Toggle', bands: ['token', 'geometry'], cause: true },
      { component: 'Stack', bands: ['geometry'], cause: false },
    ];
    const base = report();
    await review.ingest(ingest({
      report: {
        ...base,
        observations: base.observations.map((entry, index) =>
          index === 0 ? { ...entry, moved } : entry),
      },
    }));

    const detail = await review.build('ci-1001');
    expect(detail?.subjects[0]?.moved).toEqual(moved);
    // Absent is not empty here either: no column means the baseline carried no
    // hashes, and `[]` would say both revisions were read and nothing moved.
    expect(detail?.subjects[1]).not.toHaveProperty('moved');
  });

  it('refuses a report from a writer this deployment does not understand', async () => {
    await expect(
      review.ingest({
        ...ingest(),
        report: { ...report(), runVersion: 2 as RunReport['runVersion'] },
      }),
    ).rejects.toThrow(ReviewError);
  });

  it('lists builds newest first, and breaks a tied clock by arrival', async () => {
    // Two runs pushed from one machine share `at` to the millisecond often
    // enough to see it in a day's work. Ordered on the clock alone the tie is
    // whatever the engine felt like, so a reader gets an older build above a
    // newer one and anything reading *the run before this one* off the list
    // crosses a build against its own successor.
    await review.ingest(ingest());
    await review.ingest({
      ...ingest(),
      build: 'ci-1002',
      report: { ...report(), at: '2026-06-02T10:00:00.000Z' },
    });
    await review.ingest({
      ...ingest(),
      build: 'ci-1003',
      report: { ...report(), at: '2026-06-02T10:00:00.000Z' },
    });

    expect((await review.builds()).map((build) => build.build)).toEqual([
      'ci-1003',
      'ci-1002',
      'ci-1001',
    ]);
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

/**
 * The three states a variation arrives in, in one report.
 *
 * Together they are the distinction the table keeps a nullable column for: an arm
 * that was measured and differs, one that was measured and reaches nothing, and
 * one nothing could measure because the parent it named is not in this run.
 */
const VARIATIONS: readonly VariationRecord[] = [
  {
    subject: 'story:todos--populated-dark',
    parent: 'story:todos--populated',
    identical: false,
    bands: ['token'],
    components: ['Toggle'],
    digest: 'v1:d2eebe6199661536',
    how: 'named',
    because: '`story:todos--populated-dark` differs from `story:todos--populated` in token',
  },
  {
    subject: 'story:todos--sale',
    parent: 'story:todos--populated',
    identical: true,
    bands: [],
    digest: 'v1:ce4228e7c7dcb46f',
    how: 'declared',
    because: '`story:todos--sale` renders identically to `story:todos--populated`',
  },
  {
    subject: 'story:todos--orphan',
    because: 'the parent this subject declares was not observed in this run',
  },
];

describe('a variation is carried, and is never a verdict', () => {
  const declared = (): BuildIngest => ingest({ report: { ...report(), variations: VARIATIONS } });

  it('round-trips every state, keeping unmeasured apart from unchanged', async () => {
    await review.ingest(declared());

    const detail = await review.build('ci-1001');
    const by = (subject: string): VariationRecord | undefined =>
      detail?.variations.find((entry) => entry.subject === subject);

    expect(by('story:todos--populated-dark')).toEqual(VARIATIONS[0]);
    expect(by('story:todos--sale')).toEqual(VARIATIONS[1]);
    // The one the column is nullable for. `identical: false` here would say the
    // pair was compared and differs, when what happened is that nothing compared
    // them — a broken declaration read as a measurement.
    expect(by('story:todos--orphan')).not.toHaveProperty('identical');
    expect(by('story:todos--orphan')?.because).toContain('was not observed');
  });

  it('leaves the counts a reviewer merges on alone', async () => {
    await review.ingest(declared());

    const detail = await review.build('ci-1001');

    // Three variations, and not one of them is a subject awaiting anybody. A
    // variation reported as pending would be a subject flagged for existing.
    expect(detail?.verdicts).toEqual({ changed: 1, unchanged: 1, new: 0, incomparable: 0, ignored: 0 });
    expect(detail?.pending).toBe(1);
    expect(detail?.causes).toHaveLength(1);
  });

  it('is empty rather than absent when the run declared none', async () => {
    await review.ingest(ingest());

    expect((await review.build('ci-1001'))?.variations).toEqual([]);
  });

  it('goes when the build goes', async () => {
    await review.ingest(declared());
    clock = new Date('2026-07-01T12:00:00.000Z');

    await review.sweep(7);

    // Rows keyed on a build that no longer exists are the same damage as an
    // object nothing points at, and the next build reusing the id would read
    // them as its own.
    const rows = await db
      .prepare('SELECT COUNT(*) AS n FROM build_variations')
      .bind()
      .first<{ readonly n: number }>();
    expect(rows?.n).toBe(0);
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
