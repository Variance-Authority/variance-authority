import { describe, expect, it } from 'vitest';
import type { ComponentInstance, SourceIndex, SubjectComposition } from '@variance-authority/core';
import { compositionOf } from './compose.js';
import type { CliObservationRecord } from './run-report.js';

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

function instance(over: Partial<ComponentInstance> & { component: string }): ComponentInstance {
  return {
    path: '0',
    depth: 1,
    rendering: 'v1:r',
    structure: 'v1:s',
    semantics: 'v1:a',
    text: 'v1:t',
    style: 'v1:y',
    renders: [],
    nodes: 1,
    tokens: [],
    ...over,
  };
}

const button = (path: string, depth: number, over: Partial<ComponentInstance> = {}) =>
  instance({
    component: 'Button',
    path,
    depth,
    props: 'v1:danger',
    rendering: 'v1:button-danger',
    tokens: ['--va-danger'],
    renders: ['Icon'],
    ...over,
  });

const icon = (path: string, depth: number, over: Partial<ComponentInstance> = {}) =>
  instance({
    component: 'Icon',
    path,
    depth,
    within: 'Button',
    props: 'v1:icon',
    rendering: 'v1:icon-warn',
    tokens: ['--va-warn'],
    ...over,
  });

/**
 * One story that *is* a `Button`, and two pages that each mount another one.
 *
 * Two components on purpose. `Button` renders two ways from one props digest, so
 * it is a standing contradiction and can never reach `unexplained`; `Icon`
 * renders identically everywhere, which is what a control group looks like and
 * therefore the only kind of component a shortlist entry can be made of.
 *
 * The quiet button gets a page of its own rather than sitting beside the danger
 * one, and that is not tidiness. `divergencesOf` refuses to call two renderings a
 * contradiction when they were both observed in a single subject, because one
 * boundary interrupted by a nested component is walked as two — so a fixture with
 * both renderings on one page tests the refusal rather than the rung.
 */
const SUITE: readonly SubjectComposition[] = [
  {
    subject: 'story:ds-button--danger',
    instances: [button('0', 0), icon('0/0', 1)],
  },
  {
    subject: 'story:page--default',
    instances: [
      instance({ component: 'App', path: '0', depth: 0, renders: ['Footer'] }),
      instance({
        component: 'Footer',
        path: '0/1',
        within: 'App',
        props: 'v1:footer',
        renders: ['Button'],
      }),
      // `<Footer><Button><Icon/></Button></Footer>`: the icon *sits inside* the
      // button and was *written by* the footer, which is the ordinary shape and
      // the reason the two edges are recorded separately.
      button('0/1/0', 2, { within: 'Footer', createdBy: 'Footer' }),
      icon('0/1/0/0', 3, { createdBy: 'Footer' }),
    ],
  },
  {
    subject: 'story:page--quiet',
    instances: [
      instance({ component: 'App', path: '0', depth: 0, renders: ['Footer'] }),
      instance({
        component: 'Footer',
        path: '0/1',
        within: 'App',
        props: 'v1:footer',
        renders: ['Button'],
      }),
      button('0/1/0', 2, {
        within: 'Footer',
        createdBy: 'Footer',
        rendering: 'v1:button-quiet',
        style: 'v1:quiet',
      }),
    ],
  },
];

function observation(over: Partial<CliObservationRecord> & { subject: string }): CliObservationRecord {
  return {
    verdict: 'changed',
    because: 'pixels differ',
    changedPixels: 120,
    regions: [],
    ...over,
  };
}

/** A region that named `Button` as the root of the change. */
const causedByButton = {
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  pixels: 100,
  component: 'Button',
  cause: true,
};

/** A region that named `Icon` as the root of the change. */
const causedByIcon = { ...causedByButton, component: 'Icon' };

const SOURCE: SourceIndex = {
  Button: [{ file: 'src/ds/Button.tsx', line: 12, via: 'function' }],
  Icon: [{ file: 'src/ds/Icon.tsx', line: 4, via: 'function' }],
  Footer: [{ file: 'src/Footer.tsx', line: 3, via: 'function' }],
};

describe('compositionOf — what it refuses to build', () => {
  it('says nothing at all when no subject supplied a snapshot', () => {
    // A raster-only tier has no boundaries to join. An empty graph in the
    // artifact would read as "this suite shares nothing", which is false and
    // unfalsifiable.
    expect(
      compositionOf({ subjects: [null, null], observations: [observation({ subject: 'a' })] }),
    ).toBeUndefined();
  });

  it('skips the plan slots nothing filled, and keeps the rest in plan order', () => {
    const report = compositionOf({ subjects: [null, SUITE[1]!, null, SUITE[0]!], observations: [] });

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
      observations: [observation({ subject: 'story:page--default', regions: [causedByButton] })],
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
      observations: [observation({ subject: 'story:page--default', regions: [causedByButton] })],
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
    expect(report?.movements[0]?.because).toContain('--since');
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
      observations: [observation({ subject: 'story:page--default', regions: [causedByIcon] })],
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
        observation({ subject: 'story:page--default', regions: [causedByIcon] }),
        observation({ subject: 'story:ds-button--danger', regions: [causedByIcon] }),
      ],
    });

    expect(report?.movements[0]?.alsoIn).toEqual(['story:ds-button--danger']);
    // Both sites moved, so the control group is empty and the sentence says the
    // weaker thing rather than the confident one.
    expect(report?.movements[0]?.held).toEqual([]);
    expect(report?.movements[0]?.because).toContain('nowhere else');
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
      observation({ subject: 'story:page--default', regions: [causedByButton] }),
      observation({ subject: 'story:ds-button--danger', regions: [causedByButton] }),
    ];

    const once = compositionOf({ subjects: SUITE, observations, source: SOURCE, changed: [] });
    const again = compositionOf({ subjects: SUITE, observations, source: SOURCE, changed: [] });

    expect(JSON.stringify(once)).toBe(JSON.stringify(again));
  });
});
