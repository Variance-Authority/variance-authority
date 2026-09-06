import { describe, expect, it } from 'vitest';
import { capture, node } from '../rules/normalize/fixture.js';
import { normalize } from '../rules/normalize/index.js';
import { SUITE, chip, instance } from './composition-fixture.js';
import { componentInstances } from './instances.js';
import { LEXICON_CAP, lexiconOf, structureOf } from './lexicon.js';

/**
 * The subject-first folds, tested at the edges where they would lie.
 *
 * A lexicon that indexed a digest would match a coordinate; one that counted
 * the unattributed root as a boundary would rank a page above its own story; a
 * structure that keyed rows on the rendering would print three rows for three
 * identical chips and call it a tree. Each of those is one assertion below.
 */

describe('lexiconOf — what a subject is indexed under', () => {
  const [story, page] = lexiconOf(SUITE, {
    examples: new Map([['story:ds-chip--done', ['Story']]]),
    declaredIn: new Map([['Chip', ['src/ds/Chip.tsx']]]),
    regions: new Map([['story:page--default', ['Footer', 'Footer/anon#0']]]),
  });

  it('indexes the instances, and only the attributed ones count as boundaries', () => {
    expect(story).toEqual({
      subject: 'story:ds-chip--done',
      boundaries: 2,
      terms: {
        example: ['Story'],
        components: ['Chip', 'Story'],
        files: ['src/ds/Chip.tsx'],
      },
    });
  });

  it('takes the example, the files and the regions from the caller rather than deriving them', () => {
    expect(page?.terms.regions).toEqual(['Footer', 'Footer/anon#0']);
    expect(page?.terms.example).toBeUndefined();
    expect(page?.terms.files).toEqual(['src/ds/Chip.tsx']);
  });

  it('reads roles, names and text off a snapshot, and never a digest', () => {
    const snapshot = normalize(
      capture({
        subjectId: 'story:footer',
        root: node({
          owners: [{ name: 'Footer' }],
          children: [
            node({ tag: 'button', role: 'button', name: 'Clear completed', text: 'Clear completed', owners: [{ name: 'Button' }, { name: 'Footer' }] }),
            node({ tag: 'input', role: 'textbox', attributes: { placeholder: 'What needs doing?' }, owners: [{ name: 'Footer' }] }),
            node({ tag: 'span', text: '  ', owners: [{ name: 'Footer' }] }),
            node({ tag: 'span', text: 'v1:0123456789abcdef', owners: [{ name: 'Footer' }] }),
          ],
        }),
      }),
    );

    const [footer] = lexiconOf([
      { subject: 'story:footer', instances: componentInstances(snapshot), snapshot },
    ]);

    expect(footer?.terms.roles).toEqual(['button', 'textbox']);
    expect(footer?.terms.names).toEqual(['Clear completed', 'What needs doing?']);
    expect(footer?.terms.text).toEqual(['Clear completed']);
    expect(footer?.terms.components).toEqual(['Button', 'Footer']);
  });

  it('caps a field and counts what the cap left out, rather than saying nothing', () => {
    const many = Array.from({ length: LEXICON_CAP + 7 }, (_, index) =>
      instance({ component: `C${String(index).padStart(3, '0')}`, path: `0/${index}` }),
    );
    const [wide] = lexiconOf([{ subject: 'story:wide', instances: many }]);

    expect(wide?.terms.components).toHaveLength(LEXICON_CAP);
    expect(wide?.elided).toEqual({ components: 7 });
  });

  it('is a function of the instances, whatever order they were read in', () => {
    const shuffled = SUITE.map((subject) => ({
      ...subject,
      instances: [...subject.instances].reverse(),
    }));
    expect(lexiconOf(shuffled)).toEqual(lexiconOf(SUITE));
  });
});

describe('structureOf — one subject as rows', () => {
  it('folds identical rows and keeps the number of distinct inputs', () => {
    const rows = structureOf({
      subject: 'story:page',
      instances: [
        instance({ component: 'Footer', path: '0', depth: 0, renders: ['Chip', 'Chip', 'Chip'] }),
        chip('0/0', 'Footer', { createdBy: 'Footer', props: 'v1:chip-all' }),
        chip('0/1', 'Footer', { createdBy: 'Footer' }),
        chip('0/2', 'Footer', { createdBy: 'Footer' }),
      ],
    });

    expect(rows).toEqual([
      { component: 'Footer', depth: 0, count: 1, variants: 1 },
      { component: 'Chip', depth: 2, within: 'Footer', createdBy: 'Footer', count: 3, variants: 2 },
    ]);
  });

  it('keeps document order and separates the same component at two places', () => {
    const rows = structureOf({
      subject: 'story:page',
      instances: [
        instance({ component: 'App', path: '0', depth: 0 }),
        chip('0/0', 'App', { depth: 1 }),
        instance({ component: 'Footer', path: '0/1', depth: 1, within: 'App' }),
        chip('0/1/0', 'Footer'),
      ],
    });

    expect(rows.map((row) => `${row.component}@${row.depth}<${row.within ?? ''}`)).toEqual([
      'App@0<',
      'Chip@1<App',
      'Footer@1<App',
      'Chip@2<Footer',
    ]);
  });

  it('leaves the unattributed root out, because it is not a component', () => {
    const rows = structureOf({
      subject: 'story:bare',
      instances: [instance({ component: '(unattributed)', path: '0', depth: 0 })],
    });
    expect(rows).toEqual([]);
  });
});
