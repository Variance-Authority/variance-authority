import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core';
import type { JourneysReport, RunReport, VariationRecord } from '@variance-authority/report';
import type { BuildIngest, ReviewStore } from './review.js';
import { ReviewError } from './review.js';
import { CANDIDATE, POSTED, PREVIOUS, VARIATIONS, ingest, openReview, report } from './__fixtures__/review.js';
import type { SqliteD1 } from './testing.js';

let db: SqliteD1;
let review: ReviewStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date(POSTED);
  ({ db, review } = await openReview(() => clock));
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

describe("where the run's subjects parted is carried with the build", () => {
  const JOURNEYS: JourneysReport = {
    commit: '4f2a1c9d0b73',
    whole: ['story:cart-card--item', 'story:cart-card--removing'],
    truncated: ['story:cart-card--verbose'],
    unrecorded: ['route/home'],
    found: [
      {
        file: 'app/src/components/CartCard.tsx',
        observers: ['story:cart-card--item', 'story:cart-card--removing'],
        parted: [
          {
            kind: 'function',
            name: 'CartCard/onClick',
            startLine: 51,
            endLine: 58,
            entered: ['story:cart-card--removing'],
            missed: ['story:cart-card--item'],
          },
        ],
        unentered: [
          {
            kind: 'branch',
            name: 'CartCard/empty',
            startLine: 62,
            endLine: 64,
            entered: [],
            missed: ['story:cart-card--item', 'story:cart-card--removing'],
          },
        ],
      },
    ],
  };
  const carrying = (journeys: JourneysReport, build = 'ci-1001'): BuildIngest =>
    ingest({ build, report: { ...report(), journeys } });

  it('reads the section back as the run wrote it, pool and all', async () => {
    await review.ingest(carrying(JOURNEYS));

    expect((await review.build('ci-1001'))?.journeys).toEqual(JOURNEYS);
  });

  it('keeps a run with no journal apart from a pool that agreed everywhere', async () => {
    await review.ingest(ingest());
    expect((await review.build('ci-1001'))?.journeys).toBeNull();

    const agreed: JourneysReport = { whole: JOURNEYS.whole, truncated: [], unrecorded: [], found: [] };
    await review.ingest(carrying(agreed, 'ci-1002'));
    expect((await review.build('ci-1002'))?.journeys).toEqual(agreed);
  });

  it('goes when the build goes', async () => {
    await review.ingest(carrying(JOURNEYS));
    clock = new Date('2026-07-01T12:00:00.000Z');

    await review.sweep(7);

    const rows = await db
      .prepare('SELECT COUNT(*) AS n FROM build_journeys')
      .bind()
      .first<{ readonly n: number }>();
    expect(rows?.n).toBe(0);
  });
});
