import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import type { CompositionReport, RunReport } from '@variance-authority/report';
import { composition } from './composition.js';

/**
 * The scenario this tool exists for: a run where something moved and nobody
 * touched it.
 *
 * Not a unit test on the composing — that is asserted in `core` and, on real
 * code, in `examples/todomvc`. What is asserted here is the *answer*, because
 * the answer is the product. An agent is helped by being told which movement
 * has no author, which subjects held against it, and which single caller
 * explains the other four; it is not helped by four lines carrying one sentence
 * between them.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

/**
 * Four subjects, two of which are design-system examples and two of which are
 * pages that contain the same components.
 *
 * `Chip` is the shape the whole feature is about: twenty-one boundaries, no
 * example of its own, sitting inside a `Stack` that knows nothing about it, and
 * mounted by a `TodoFooter` that owns no DOM node and therefore has no census
 * entry at all.
 */
const COMPOSED: CompositionReport = {
  subjects: ['ds/button--primary', 'ds/chip--group', 'page/all', 'page/active'],
  components: [
    {
      component: 'Button',
      subjects: ['ds/button--primary', 'page/all'],
      instances: 3,
      examples: ['ds/button--primary'],
      within: ['Stack'],
      createdBy: ['TodoHeader'],
      renders: ['Text'],
      tokens: ['--brand'],
      variants: 2,
      renderings: 2,
    },
    {
      component: 'Card',
      subjects: ['page/active'],
      instances: 1,
      examples: ['page/active'],
      within: [],
      createdBy: [],
      renders: ['Stack', 'Text'],
      tokens: [],
      variants: 1,
      renderings: 1,
    },
    {
      component: 'Chip',
      subjects: ['ds/chip--group', 'page/all', 'page/active'],
      instances: 21,
      examples: [],
      within: ['Stack'],
      createdBy: ['TodoFooter'],
      renders: [],
      tokens: ['--chip-bg'],
      variants: 1,
      renderings: 3,
    },
    {
      component: 'Stack',
      subjects: ['ds/chip--group', 'page/all', 'page/active'],
      instances: 9,
      examples: [],
      within: ['Card'],
      createdBy: ['TodoApp'],
      renders: ['Button', 'Chip', 'Text'],
      tokens: [],
      variants: 3,
      renderings: 3,
    },
  ],
  echoes: [
    {
      component: 'Chip',
      rendering: 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      subjects: ['ds/chip--group', 'page/all', 'page/active'],
      sites: 7,
      example: 'ds/chip--group',
    },
    {
      component: 'Stack',
      rendering: 'v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      subjects: ['page/all', 'page/active'],
      sites: 2,
    },
  ],
  divergences: [
    {
      component: 'Chip',
      bands: ['style'],
      // Two pages agreeing and the narrow subject disagreeing with both, which
      // is the shape a reader has to be able to see: the short group is the one
      // to open.
      renderings: [['page/all', 'page/active'], ['ds/chip--group']],
      partings: [
        {
          rendering: 1,
          lines: [
            'variation — an input moved and the page followed',
            'Chip inherited a different `color` — an ancestor declared it',
            '  2 deltas here (token) — color',
          ],
        },
      ],
    },
  ],
  movements: [
    {
      subject: 'page/all',
      component: 'Button',
      bands: [],
      cause: 'edited',
      because: '`src/ds/Button.tsx` is in the change set',
      file: 'src/ds/Button.tsx',
      alsoIn: ['ds/button--primary'],
      held: [],
    },
    {
      subject: 'ds/button--primary',
      component: 'Button',
      bands: [],
      cause: 'edited',
      because: '`src/ds/Button.tsx` is in the change set',
      file: 'src/ds/Button.tsx',
      alsoIn: ['page/all'],
      held: [],
    },
    {
      subject: 'page/all',
      component: 'Chip',
      bands: ['text'],
      cause: 'unexplained',
      because:
        'no file, token or ancestor explains it, and the same component with the same props ' +
        'held in 2 other place(s) in this run',
      alsoIn: [],
      held: ['ds/chip--group', 'page/active'],
      standing: 'flake',
    },
    {
      subject: 'page/active',
      component: 'Card',
      bands: [],
      cause: 'unexplained',
      because:
        'no file, token or ancestor explains it, and it renders nowhere else in this run to ' +
        'compare against',
      alsoIn: [],
      held: [],
      standing: 'suspect',
    },
  ],
};

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-12T10:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  observations: [],
  composition: COMPOSED,
};

describe('the suite compared to itself', () => {
  it('sizes the graph and names what can be asked about next', () => {
    const answer = composition.run(REPORT, {});
    const [first, second] = answer.split('\n');

    expect(first).toBe(
      '4 component(s) across 4 subject(s) — 2 shared rendering(s), 1 divergence(s), ' +
        '4 movement(s), 2 of them unexplained',
    );
    // Without the names, the `component` argument is unusable: an agent would
    // have to guess what the run composed in order to ask about it.
    expect(second).toBe('  components: Button, Card, Chip, Stack');
  });

  it('leads with the movements nothing explains', () => {
    const answer = composition.run(REPORT, {});

    expect(answer.indexOf('unexplained (2)')).toBeLessThan(answer.indexOf('explained (1'));
    expect(answer.indexOf('unexplained (2)')).toBeLessThan(answer.indexOf('shared renderings'));
  });

  it('names a flake only where both halves of the sentence are present', () => {
    const answer = composition.run(REPORT, {});

    expect(answer).toContain('page/all · Chip (text)');
    expect(answer).toContain('[flake]');
    expect(answer).toContain('failed to read the same way twice');
    // The control group is what makes the finding worth reporting rather than
    // shrugging at, so it is printed beside it and not left implied.
    expect(answer).toContain('held in 2 other place(s): ds/chip--group, page/active');
  });

  it('keeps a shortlist entry a shortlist entry', () => {
    const answer = composition.run(REPORT, {});

    expect(answer).toContain('[suspect]');
    expect(answer).toContain('not a verdict');
    expect(answer).toContain('`variance run --flakes` is what settles it');
    // No control, and saying so weakens this entry rather than strengthening
    // it. An agent told only "unexplained" would rank it above the flake.
    expect(answer).toContain('no control: it renders nowhere else in this run');
  });

  it('folds one cause into one line instead of one line per subject', () => {
    const answer = composition.run(REPORT, {});
    const head = 'Button [edited] — `src/ds/Button.tsx` is in the change set';

    expect(answer).toContain(head);
    expect(answer).toContain('2 subject(s): page/all, ds/button--primary');
    expect(answer.split(head).length - 1).toBe(1);
  });

  it('says a divergence is not a regression, because nothing about it is one', () => {
    const answer = composition.run(REPORT, {});

    expect(answer).toContain('Chip (style) — 2 rendering(s) from one props digest');
    expect(answer).toContain('there is no baseline anywhere in this');
    // The split, not just the total. Which subjects agreed with each other is
    // the only part of a divergence a reader can act on.
    expect(answer).toContain('2 subject(s): page/all, page/active');
    expect(answer).toContain('1 subject(s): ds/chip--group');
  });

  it('says which input moved, under the rendering that moved it', () => {
    // The half that makes the split actionable. Without it an agent knows which
    // subject to open and has to diff two pages by eye to learn why — which is
    // the work the component graph exists to remove.
    const answer = composition.run(REPORT, {});

    expect(answer).toContain(
      '  1 subject(s): ds/chip--group\n' +
        '    variation — an input moved and the page followed\n' +
        '    Chip inherited a different `color` — an ancestor declared it\n' +
        '      2 deltas here (token) — color',
    );
  });

  it('leaves the rendering everything else is measured against unexplained', () => {
    // Rendering 0 is the reference, not a party to the parting. A line under it
    // would be comparing it to itself.
    const answer = composition.run(REPORT, {});
    const [reference] = answer.split('  1 subject(s): ds/chip--group');

    expect(reference).toContain('2 subject(s): page/all, page/active\n');
    expect(reference).not.toContain('an ancestor declared it');
  });

  it('connects the dots, and says which subject is the narrow one', () => {
    const answer = composition.run(REPORT, {});

    expect(answer).toContain('shared renderings (2)');
    expect(answer).toContain('Chip · 3 subject(s), 7 site(s)');
    expect(answer).toContain('example: ds/chip--group');
    // A rendering shared only between pages has no narrow subject to review it
    // in, which is a different situation and is said rather than left blank.
    expect(answer).toContain('no example among them');
  });

  it('names the components the suite watches only through something else', () => {
    const answer = composition.run(REPORT, {});

    expect(answer).toContain('no example of their own (2): Chip, Stack');
  });

  it('counts what a cap left out rather than presenting the rest as all of it', () => {
    const capped: RunReport = {
      ...REPORT,
      composition: { ...COMPOSED, truncated: { echoes: 40 } },
    };

    const answer = composition.run(capped, {});

    expect(answer.split('\n')[0]).toContain('42 shared rendering(s)');
    expect(answer).toContain('40 more were never written to the report');
  });
});

describe('one component', () => {
  it('carries both upward edges, because they answer different questions', () => {
    const answer = composition.run(REPORT, { component: 'Chip' });

    expect(answer).toContain('Chip — 21 boundary(ies) in 3 subject(s)');
    expect(answer).toContain('no example of its own');
    expect(answer).toContain('within: Stack');
    // The one a reviewer opens. `Stack` is a layout wrapper that knows nothing
    // about a chip; `TodoFooter` is where the props are written.
    expect(answer).toContain('created by: TodoFooter');
    expect(answer).toContain('tokens: --chip-bg');
  });

  it('reads the variant and rendering counts out as the sentence they are', () => {
    expect(composition.run(REPORT, { component: 'Chip' })).toContain(
      '1 input(s) produced 3 rendering(s): its output is not a function of its props alone',
    );
    expect(composition.run(REPORT, { component: 'Button' })).toContain(
      '2 input(s), 2 rendering(s): here, its output is a function of its props',
    );
    // The caveat is printed only where the numbers disagree, because that is
    // the only place a reader would otherwise over-read them: a props digest
    // excludes `children`, so "one input" is not "one set of arguments".
    expect(composition.run(REPORT, { component: 'Chip' })).toContain('excludes `children`');
    expect(composition.run(REPORT, { component: 'Button' })).not.toContain('excludes `children`');
  });

  it('narrows the movements, divergences and echoes to that component', () => {
    const answer = composition.run(REPORT, { component: 'Chip' });

    expect(answer).toContain('[flake]');
    expect(answer).toContain('2 rendering(s) from one props digest');
    expect(answer).not.toContain('Button');
    expect(answer).not.toContain('page/active · Card');
  });

  it('answers about a component that is a boundary nowhere', () => {
    // The failure this replaces: `TodoFooter` renders nothing but other
    // components, so it owns no DOM node and has no census entry — and it is
    // the file a reviewer has to open. "No such component" would send an agent
    // hunting for a typo in the one name that explains the run.
    const answer = composition.run(REPORT, { component: 'TodoFooter' });

    expect(answer).toContain('is a boundary nowhere in this suite');
    expect(answer).toContain('mounted 1: Chip');
    expect(answer).toContain('where their props are written');
  });

  it('separates a name it does not know from one it knows differently', () => {
    const answer = composition.run(REPORT, { component: 'Avatar' });

    expect(answer).toContain('composed no component named `Avatar`');
    expect(answer).toContain('nothing it did compose names it as a creator');
    expect(answer).toContain('Button, Card, Chip, Stack');
  });
});

describe('a run that composed nothing', () => {
  it('reports the absence as an absence and not as an empty graph', () => {
    const raster: RunReport = { ...REPORT, composition: undefined };
    const answer = composition.run(raster, {});

    // "0 components across 0 subjects" is the claim *this suite shares
    // nothing*, which is different and false. Absent is not empty.
    expect(answer).toContain('not the same as it finding nothing');
    expect(answer).toContain('never sees a component boundary');
    expect(answer).toContain('it says this run cannot tell');
    expect(answer).not.toContain('0 component(s)');
  });

  it('names the missing attribution when a composed run found no component', () => {
    const bare: RunReport = {
      ...REPORT,
      composition: { ...COMPOSED, components: [], echoes: [], divergences: [], movements: [] },
    };

    // Distinct from the case above: composition *ran*, over subjects that carry
    // no provenance — a fixture built with `createElement`, a page served
    // without source stamping. A census of zeros with an empty `components:`
    // list after it reads as a broken report, not as an answered question.
    const answer = composition.run(bare, {});

    expect(answer).toContain('no component named in 4 subject(s)');
    expect(answer).toContain('located in the image but not attributed');
    expect(answer).not.toContain('0 component(s)');
    expect(answer).not.toContain('components: ');
  });
});
