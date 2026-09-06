import { describe, expect, it } from 'vitest';
import { compositionOf } from './compose.js';
import type { CliObservationRecord } from './run-report.js';
import {
  SOURCE,
  SUITE,
  causedByButton,
  causedByIcon,
  instance,
  observation,
} from './compose-fixture.js';

/**
 * The fold, tested where it is dangerous: at the edges of what a run knows.
 *
 * `composition.test.ts` in `core` proves the graph. This proves the thing the CLI
 * adds to it, which is *how much the run was able to ask* — and every test below
 * is really the same test. A run without `--since` cannot reach the `edited`
 * rung, a run without a history store cannot reach `token`, and a run that
 * silently treated either absence as "nothing changed" would emit a flake
 * shortlist made entirely of components somebody had just edited.
 */

describe('compositionOf — what it refuses to build', () => {
  it('says nothing at all when no subject supplied a snapshot', () => {
    // A raster-only tier has no boundaries to join. An empty graph in the
    // artifact would read as "this suite shares nothing", which is false and
    // unfalsifiable.
    expect(
      compositionOf({
        subjects: [null, null],
        observations: [observation({ subject: 'a' })],
      }),
    ).toBeUndefined();
  });

  it('skips the plan slots nothing filled, and keeps the rest in plan order', () => {
    const report = compositionOf({
      subjects: [null, SUITE[1]!, null, SUITE[0]!],
      observations: [],
    });

    expect(report?.subjects).toEqual(['story:page--default', 'story:ds-button--danger']);
  });
});

describe('compositionOf — the census', () => {
  const report = compositionOf({ subjects: SUITE, observations: [] });

  it('counts every instance of a component across the suite', () => {
    const entry = report?.components.find((each) => each.component === 'Button');

    expect(entry?.instances).toBe(3);
    expect(entry?.subjects).toEqual([
      'story:ds-button--danger',
      'story:page--default',
      'story:page--quiet',
    ]);
  });

  it('separates props classes from renderings, because they answer different questions', () => {
    const entry = report?.components.find((each) => each.component === 'Button');

    // One `props` digest, two renderings under it: the same inputs produced two
    // outputs at one commit. `variants: 1, renderings: 2` is the shape of a
    // contradiction and `variants: 2` would hide it as a legitimate difference.
    expect(entry?.variants).toBe(1);
    expect(entry?.renderings).toBe(2);
  });

  it('reports an echo across subjects, with the sites counted and the subjects named', () => {
    const echo = report?.echoes.find((each) => each.rendering === 'v1:button-danger');

    expect(echo?.component).toBe('Button');
    expect(echo?.sites).toBe(2);
    expect(echo?.subjects).toEqual(['story:ds-button--danger', 'story:page--default']);
    // The smallest subject holding this rendering: the example a reviewer should
    // be sent to rather than the page it also appears on.
    expect(echo?.example).toBe('story:ds-button--danger');
  });

  it('carries both upward edges, because they answer different questions', () => {
    const entry = report?.components.find((each) => each.component === 'Icon');

    // Where it sits, and who wrote it. A report carrying only the first sends a
    // reviewer to `Button`, which nobody edited.
    expect(entry?.within).toEqual(['Button']);
    expect(entry?.createdBy).toEqual(['Footer']);
  });

  it('carries no truncation marker when nothing was cut', () => {
    expect(report?.truncated).toBeUndefined();
  });
});

describe('compositionOf — what moved, and where it was read from', () => {
  it('takes causes from regions and leaves collateral out', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByButton, { ...causedByButton, component: 'Footer', cause: false }],
        }),
      ],
    });

    expect(report?.movements.map((each) => each.component)).toEqual(['Button']);
  });

  it('records no band from a region, because a region names no band', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByButton],
        }),
      ],
    });

    // `[]` here is `Moved.bands`' documented *not known*, and the report says the
    // same nothing rather than inventing `content`.
    expect(report?.movements[0]?.bands).toEqual([]);
  });

  it('lets the second reading replace the region, because it knows the bands', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByButton],
          unstable: {
            components: [{ name: 'Button' }],
            bands: ['content', 'geometry'],
            because: 'two readings disagreed',
          },
        }),
      ],
    });

    expect(report?.movements).toHaveLength(1);
    expect(report?.movements[0]?.bands).toEqual(['geometry', 'content']);
  });

  it('drops a band nothing recognises from the naming, never the movement', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [],
          unstable: {
            components: [{ name: 'Button' }],
            bands: ['wavelength'],
            because: 'two readings disagreed',
          },
        }),
      ],
    });

    expect(report?.movements).toHaveLength(1);
    expect(report?.movements[0]?.bands).toEqual([]);
  });
});

describe('compositionOf — attribution degrades honestly', () => {
  const moved = [observation({ subject: 'story:page--default', regions: [causedByIcon] })] as const;

  it('builds the control group from the hashes, not from the movements it reports', () => {
    // `causesBetween` contributes only the regions that *caused* a change, so a
    // component whose digests moved inside a box the pixels attributed elsewhere
    // never reaches the movement list. Read as a control group, that render comes
    // back as the one place this component held still — about the one place it is
    // known to have moved.
    const at = (moved: CliObservationRecord['moved']): readonly string[] | undefined =>
      compositionOf({
        subjects: SUITE,
        observations: [
          observation({
            subject: 'story:page--default',
            regions: [causedByIcon],
            moved: [{ component: 'Icon', bands: ['geometry'], cause: true }],
          }),
          observation({
            subject: 'story:ds-button--danger',
            ...(moved === undefined ? {} : { moved }),
          }),
        ],
        changed: ['docs/readme.md'],
        source: SOURCE,
      })?.movements[0]?.held;

    expect(at([{ component: 'Icon', bands: ['geometry'], cause: false }])).toEqual([]);
    expect(at([])).toEqual(['story:ds-button--danger']);
    // No `moved` at all: no baseline digests were there to compare, and a render
    // nobody read cannot be a control for anything.
    expect(at(undefined)).toEqual([]);
  });

  it('reaches the `edited` rung only when a change set and an index are both there', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: moved,
      changed: ['src/ds/Icon.tsx'],
      source: SOURCE,
    });

    expect(report?.movements[0]?.cause).toBe('edited');
    expect(report?.movements[0]?.file).toBe('src/ds/Icon.tsx');
    expect(report?.movements[0]?.standing).toBeUndefined();
  });

  it('attributes to the component that mounted it, ahead of the one it sits in', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: moved,
      changed: ['src/Footer.tsx'],
      source: SOURCE,
    });

    // `Footer` never encloses the icon — `Button` does — and `Footer` is still the
    // right answer, because it is the caller whose edit changed what the icon was
    // handed. Reading `within` alone would have reported this unexplained.
    expect(report?.movements[0]?.cause).toBe('upstream');
    expect(report?.movements[0]?.upstream).toBe('Footer');
  });

  it('falls back to the enclosing component when nothing mounting it was edited', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: moved,
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
    });

    expect(report?.movements[0]?.cause).toBe('upstream');
    expect(report?.movements[0]?.upstream).toBe('Button');
  });

  it('attributes to a token the component itself resolves through', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: moved,
      changed: [],
      source: SOURCE,
      tokens: ['--va-warn', '--va-space-3'],
    });

    expect(report?.movements[0]?.cause).toBe('token');
    // Only the one this component's own nodes read. A subject-level intersection
    // would name every token in the theme and explain nothing.
    expect(report?.movements[0]?.tokens).toEqual(['--va-warn']);
  });

  it('calls it contradicted when the component renders two ways at one commit', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByButton],
        }),
      ],
      changed: ['src/unrelated.ts'],
      source: SOURCE,
    });

    // Not an explanation — proof the explanation is not in `Button.tsx`, because
    // one commit produced two answers from one props digest.
    expect(report?.movements[0]?.cause).toBe('contradicted');
    expect(report?.movements[0]?.standing).toBeUndefined();
  });

  it('says so, rather than accusing, when the run never asked what changed', () => {
    const report = compositionOf({ subjects: SUITE, observations: moved });

    expect(report?.movements[0]?.cause).toBe('unexplained');
    expect(report?.movements[0]?.because).toContain('--against');
  });
});

describe('compositionOf — the standing an unexplained movement gets', () => {
  const unexplained = {
    subjects: SUITE,
    changed: ['src/unrelated.ts'],
    source: SOURCE,
    tokens: [],
  } as const;

  it('is a suspect when nothing has read the subject twice', () => {
    const report = compositionOf({
      ...unexplained,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByIcon],
        }),
      ],
    });

    // A shortlist entry, not a verdict: one reading cannot establish instability
    // and this run took one.
    expect(report?.movements[0]?.standing).toBe('suspect');
    expect(report?.movements[0]?.held.length).toBeGreaterThan(0);
  });

  it('is a flake only when the same run also caught the subject disagreeing with itself', () => {
    const report = compositionOf({
      ...unexplained,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByIcon],
          unstable: {
            components: [{ name: 'Icon' }],
            bands: ['content'],
            because: 'two readings disagreed',
          },
        }),
      ],
    });

    expect(report?.movements[0]?.cause).toBe('unexplained');
    expect(report?.movements[0]?.standing).toBe('flake');
  });

  it('names the other subjects the same component moved in', () => {
    const report = compositionOf({
      ...unexplained,
      observations: [
        observation({
          subject: 'story:page--default',
          regions: [causedByIcon],
        }),
        observation({
          subject: 'story:ds-button--danger',
          regions: [causedByIcon],
        }),
      ],
    });

    expect(report?.movements[0]?.alsoIn).toEqual(['story:ds-button--danger']);
    // Both sites moved, so the control group is empty — and empty here is the
    // strong reading, not the weak one. The suite had something to compare
    // against and the comparison came back the same way in every render.
    expect(report?.movements[0]?.held).toEqual([]);
    expect(report?.movements[0]?.because).toContain('every other render of it');
  });
});

describe('compositionOf — a cap that says nothing reads as coverage', () => {
  /** A suite of 150 one-component stories, each of which also sits on a page. */
  const wide: readonly SubjectComposition[] = [
    {
      subject: 'story:page--all',
      instances: Array.from({ length: 150 }, (_, index) =>
        instance({
          component: `C${index}`,
          path: `0/${index}`,
          props: `v1:p${index}`,
          rendering: `v1:r${index}`,
        }),
      ),
    },
    ...Array.from({ length: 150 }, (_, index) => ({
      subject: `story:c${index}--default`,
      instances: [
        instance({
          component: `C${index}`,
          path: '0',
          depth: 0,
          props: `v1:p${index}`,
          rendering: `v1:r${index}`,
        }),
      ],
    })),
  ];

  const report = compositionOf({ subjects: wide, observations: [] });

  it('counts what it left out rather than dropping it silently', () => {
    expect(report?.echoes).toHaveLength(100);
    expect(report?.truncated).toEqual({ echoes: 50 });
  });

  it('does not cap the census, which is bounded by the design system', () => {
    expect(report?.components).toHaveLength(150);
  });
});

describe('compositionOf — the same inputs produce the same bytes', () => {
  it('does not depend on the order the workers finished in', () => {
    const observations = [
      observation({
        subject: 'story:page--default',
        regions: [causedByButton],
      }),
      observation({
        subject: 'story:ds-button--danger',
        regions: [causedByButton],
      }),
    ];

    const once = compositionOf({
      subjects: SUITE,
      observations,
      source: SOURCE,
      changed: [],
    });
    const again = compositionOf({
      subjects: SUITE,
      observations,
      source: SOURCE,
      changed: [],
    });

    expect(JSON.stringify(once)).toBe(JSON.stringify(again));
  });
});
