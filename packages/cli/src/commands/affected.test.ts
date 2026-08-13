import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core';
import { affectedSubjects, indexOf } from './affected.js';

/**
 * What an edit could not possibly have changed.
 *
 * Every test here is about the *asymmetry*. Observing a subject that did not need
 * it costs a collection; skipping one that did produces a green run over an
 * unwatched surface — silently, because the subject is not in the report to be
 * missing from. So the interesting cases are all the ones where the answer is
 * unknown, and the assertion is always that unknown resolves to *observe*.
 */

const SOURCE = indexOf(
  new Map([
    ['src/ds/Button.tsx', 'export function Button() { return null }'],
    ['src/ds/Clock.tsx', 'export const Clock = () => null'],
  ]),
);

const ROOTS = ['src'];

function baselines(
  entries: readonly (readonly [string, readonly string[] | undefined])[],
): ReadonlyMap<string, readonly string[] | undefined> {
  return new Map(entries);
}

describe('choosing what to observe from a diff', () => {
  it('observes the subjects whose baseline records a component the diff touched', () => {
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button', 'Text']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.skipped.map((entry) => entry.subject)).toEqual(['story:clock']);
    expect(answer.whole).toBeUndefined();
    // The skip carries its own reason, because a subject absent from a report is
    // a subject nobody can ask about.
    expect(answer.skipped[0]?.because).toContain('touched none of them');
  });

  it('observes a subject that has no baseline, because nothing is known about it', () => {
    const answer = affectedSubjects({
      planned: ['story:new'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:new', undefined]]),
    });

    expect(answer.observe).toEqual(['story:new']);
    expect(answer.skipped).toEqual([]);
  });

  it('observes a subject whose baseline predates the component list', () => {
    // Absent is unknown, never "renders nothing". A selector that read a missing
    // field as an empty list would skip every subject in a suite whose baselines
    // were written before ADR-0027.
    const answer = affectedSubjects({
      planned: ['story:old'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:old', undefined]]),
    });

    expect(answer.observe).toEqual(['story:old']);
  });

  it('runs everything when a changed file under the roots declares no component', () => {
    // A stylesheet, a token file, a helper every component imports. None of them
    // names itself in any subject's component list, and all of them can move
    // every subject in the suite.
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/tokens.css'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(answer.observe).toEqual(['story:button', 'story:clock']);
    expect(answer.whole).toContain('declare no component');
    expect(answer.because).toContain('every subject was observed');
  });

  it('ignores a change outside the scanned roots rather than widening to everything', () => {
    // Otherwise every diff that touched a README would force a whole run, and the
    // operator would conclude selection does not work rather than that their
    // roots are narrow.
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['README.md', 'src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(answer.observe).toEqual(['story:button']);
  });

  it('runs everything when nothing changed inside the roots at all', () => {
    // Distinct from "nothing was affected". The diff says nothing about
    // components either way, and answering it with an empty selection would
    // report a clean suite that looked at none of itself.
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: ['README.md'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toContain('none of the 1 changed file(s) is under the scanned roots');
  });

  it('runs everything when the diff named nothing', () => {
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: [],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toContain('named no changed file');
  });

  it('matches a root on a directory boundary, not on a prefix of characters', () => {
    // `src` claiming `srcery/` would force whole runs forever, and the reason
    // would be invisible.
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: ['srcery/theme.css'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(answer.whole).toContain('under the scanned roots');
    expect(answer.whole).not.toContain('declare no component');
  });
});

/**
 * The same selector, given a file graph.
 *
 * Everything above narrows by *what a changed file declares*, which is why a
 * stylesheet forces a whole run. A graph answers *what reaches this file*
 * instead, and the whole value of it is that one case — so the first test is the
 * same input twice, once each way.
 *
 * The over-inclusion arrangement has to survive intact, and the rest of these are
 * the places it does: a file the scan never read, a diff the graph has nothing to
 * say about, and a diff that reaches no component at all.
 */

const GRAPH = relationsOfFiles([
  { file: 'src/ds/tokens.css' },
  { file: 'src/ds/button.css', edges: [{ to: 'src/ds/tokens.css', kind: 'asset' }] },
  {
    file: 'src/ds/Button.tsx',
    declares: ['Button'],
    edges: [{ to: 'src/ds/button.css', kind: 'asset' }],
  },
  {
    file: 'src/ds/Clock.tsx',
    declares: ['Clock'],
    edges: [{ to: 'src/ds/time.ts', kind: 'imports' }],
  },
  { file: 'src/ds/time.ts' },
  { file: 'src/ds/unused.ts' },
]);

const BOTH = baselines([
  ['story:button', ['Button']],
  ['story:clock', ['Clock']],
]);

describe('choosing what to observe from a file graph', () => {
  it('narrows past a file that declares nothing, which the index alone cannot', () => {
    const input = {
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/tokens.css'],
      source: SOURCE,
      roots: ROOTS,
      baselines: BOTH,
    };

    // Two hops: `tokens.css` ← `button.css` ← `Button.tsx` ← `Button`. Without
    // them a token file is a file that declares nothing, and the run is whole.
    expect(affectedSubjects({ ...input, relations: GRAPH }).observe).toEqual(['story:button']);
    expect(affectedSubjects(input).whole).toContain('declare no component');
  });

  it('runs everything when a changed file under the roots is not in the graph', () => {
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/Button.tsx', 'src/ds/Missing.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: BOTH,
      relations: GRAPH,
    });

    // The roots are the operator's own statement of where renders come from, so
    // a file inside them the graph cannot place is a gap in the scan — not a
    // file that affects nothing.
    expect(answer.observe).toEqual(['story:button', 'story:clock']);
    expect(answer.whole).toContain('not in the file graph');
  });

  it('runs everything when the diff is entirely outside the graph', () => {
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: ['yarn.lock'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
      relations: GRAPH,
    });

    // A lockfile is a node in no graph and can repaint every subject in the
    // suite. Narrowing on it would be narrowing on silence.
    expect(answer.whole).toContain('none of the 1 changed file(s) is in the file graph');
  });

  it('runs everything when the changed files reach no component', () => {
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: ['src/ds/unused.ts'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
      relations: GRAPH,
    });

    // The subtle one. A file that genuinely affects nothing and a file declaring
    // a component the scanner failed to recognise produce the same empty answer,
    // and only one of them is safe to act on.
    expect(answer.whole).toContain('reach no component');
  });

  it('names the file it widened for, and why, rather than counting it', () => {
    const opaque = relationsOfFiles([
      { file: 'src/ds/tokens.css' },
      { file: 'src/ds/Button.tsx', declares: ['Button'] },
      { file: 'src/ds/legacy.js', unknown: 'a require() call with a specifier that is not a literal' },
      {
        file: 'src/ds/Clock.tsx',
        declares: ['Clock'],
        edges: [{ to: 'src/ds/legacy.js', kind: 'imports' }],
      },
    ]);

    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: BOTH,
      relations: opaque,
    });

    // `Clock` rides along because its own dependency could not be read. That is
    // the only line in a run telling an operator which file to fix to make the
    // next run smaller, and a bare count tells them there is nothing to be done.
    expect(answer.observe).toEqual(['story:button', 'story:clock']);
    expect(answer.because).toContain('src/ds/legacy.js: a require() call');
  });
});

describe('a project a monorepo tool called affected', () => {
  const WORKSPACE = indexOf(
    new Map([
      ['packages/ds/src/Button.tsx', 'export function Button() { return null }'],
      ['apps/site/src/Page.tsx', 'export function Page() { return null }'],
    ]),
  );

  const PACKAGES = relationsOfFiles([
    { file: 'packages/ds/src/Button.tsx', declares: ['Button'] },
    { file: 'packages/ds/package.json' },
    { file: 'apps/site/src/Page.tsx', declares: ['Page'] },
  ]);

  const PLANNED = ['story:button', 'story:page'];
  const RECORDED = baselines([
    ['story:button', ['Button']],
    ['story:page', ['Page']],
  ]);

  it('seeds the graph with every file under the project, and narrows from there', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: [],
      changedDirs: ['packages/ds'],
      source: WORKSPACE,
      roots: ['packages', 'apps'],
      baselines: RECORDED,
      relations: PACKAGES,
    });

    // The edge a specifier scan cannot see: one workspace package importing
    // another's built output. It arrives as more changed input, and the graph
    // narrows outwards from it like it does from any other change.
    expect(answer.observe).toEqual(['story:button']);
  });

  it('narrows on a project even with no graph to narrow through', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: [],
      changedDirs: ['packages/ds'],
      source: WORKSPACE,
      roots: ['packages', 'apps'],
      baselines: RECORDED,
    });

    // A project directory does not get the declares-nothing rule. It is a whole
    // package a tool called affected, and every package contains files that
    // declare no component — so applying it would make every answer from `nx` or
    // `turbo` force a whole run, every time.
    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toBeUndefined();
  });

  it('runs everything when neither the diff nor the tool named anything', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: [],
      changedDirs: [],
      source: WORKSPACE,
      roots: ['packages', 'apps'],
      baselines: RECORDED,
      relations: PACKAGES,
    });

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('named no changed file');
  });
});
