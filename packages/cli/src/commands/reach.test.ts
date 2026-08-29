import { relationsOfFiles } from '@variance-authority/core';
import { describe, expect, it } from 'vitest';
import { reachOf } from './reach.js';

/**
 * What the commit reaches, as a thing a reviewer is going to read.
 *
 * The selector's own tests next door assert the *decision* — which subjects are
 * observed and which are ruled out. These assert the *sentence*, which is a
 * different property and a stricter one: the selector may over-include for any
 * reason it likes and still be correct, while a trail printed on a build page is
 * an attribution, and an attribution that names a file nobody edited is worse
 * than no attribution at all.
 *
 * So the cases here are the ones where the answer is qualified: a subject the run
 * cannot describe, a walk that refused, and a component reached only through the
 * scan's own blind spot.
 */

const GRAPH = relationsOfFiles([
  { file: 'src/ds/tokens.css' },
  { file: 'src/ds/button.css', edges: [{ to: 'src/ds/tokens.css', kind: 'asset' }] },
  {
    file: 'src/ds/Button.tsx',
    declares: ['Button'],
    edges: [{ to: 'src/ds/button.css', kind: 'asset' }],
  },
  { file: 'src/ds/Clock.tsx', declares: ['Clock'] },
]);

const ROOTS = ['src'];

function baselines(
  entries: readonly (readonly [string, readonly string[] | undefined])[],
): ReadonlyMap<string, readonly string[] | undefined> {
  return new Map(entries);
}

describe('the chain from a changed file to a component', () => {
  it('names every hop, changed file first and component last', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/ds/tokens.css'],
      relations: GRAPH,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    // The whole value of the section in one assertion. `tokens.css` declares no
    // component, so nothing derived from names alone could connect it to a
    // picture; the graph connects it in two hops, and the reviewer is handed the
    // file to open rather than a component to guess about.
    expect(reach.components).toEqual([
      {
        component: 'Button',
        trail: ['src/ds/tokens.css', 'src/ds/button.css', 'src/ds/Button.tsx', 'Button'],
      },
    ]);
    expect(reach.subjects?.['story:button']?.trail?.[0]).toBe('src/ds/tokens.css');
  });

  it('separates the subject this diff reaches from the one it does not', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/ds/tokens.css'],
      relations: GRAPH,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(reach.subjects?.['story:button']?.reached).toBe(true);
    expect(reach.subjects?.['story:clock']).toEqual({
      reached: false,
      through: [],
      because: 'its baseline records 1 component and this diff reaches none of them',
    });
  });

  it('says nothing at all about a subject whose baseline listed no components', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/ds/tokens.css'],
      relations: GRAPH,
      roots: ROOTS,
      baselines: baselines([['story:new', undefined]]),
    });

    // Not `reached: false`. The run does not know what that subject is made of,
    // and `false` here would be the sentence "this commit cannot have moved it" —
    // which is exactly the claim a reviewer would use to dismiss a real change.
    expect(reach.subjects).toEqual({});
  });
});

describe('a walk that could not attribute the diff', () => {
  it('leaves the subjects out entirely rather than reporting none reached', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/ds/Missing.tsx'],
      relations: GRAPH,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    // Absent and empty are opposite claims here: empty would say the commit was
    // understood and reaches nothing, which is what somebody merges on.
    expect(reach.subjects).toBeUndefined();
    expect(reach.whole).toContain('not in the file graph');
    expect(reach.unscanned).toEqual(['src/ds/Missing.tsx']);
  });

  it('refuses on a diff outside the graph rather than reaching nothing', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['yarn.lock'],
      relations: GRAPH,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(reach.subjects).toBeUndefined();
    expect(reach.whole).toContain('none of the 1 changed file is in the file graph');
  });
});

describe('a component reached through a file the scan could not read', () => {
  const OPAQUE = relationsOfFiles([
    { file: 'src/ds/Button.tsx', declares: ['Button'] },
    {
      file: 'src/ds/legacy.js',
      unknown: 'a require() call with a specifier that is not a literal',
    },
    {
      file: 'src/ds/Clock.tsx',
      declares: ['Clock'],
      edges: [{ to: 'src/ds/legacy.js', kind: 'imports' }],
    },
  ]);

  it('marks the trail that does not begin at a changed file', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/ds/Button.tsx'],
      relations: OPAQUE,
      roots: ROOTS,
      baselines: baselines([['story:clock', ['Clock']]]),
    });

    const clock = reach.components.find((entry) => entry.component === 'Clock');

    // `Clock` is in the answer because an unreadable file might import what
    // changed — sound for deciding what to observe, and a false attribution if
    // printed as though the commit reached it. The trail opens with a path the
    // diff never named, so it is labelled rather than shown bare.
    expect(clock?.trail[0]).toBe('src/ds/legacy.js');
    expect(clock?.throughUnread).toBe('src/ds/legacy.js');
    expect(reach.components.find((entry) => entry.component === 'Button')?.throughUnread)
      .toBeUndefined();
  });

  it('names the file to fix, with the reason, rather than counting it', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/ds/Button.tsx'],
      relations: OPAQUE,
      roots: ROOTS,
      baselines: baselines([['story:clock', ['Clock']]]),
    });

    expect(reach.opaque).toEqual([
      {
        file: 'src/ds/legacy.js',
        because: 'a require() call with a specifier that is not a literal',
      },
    ]);
  });
});
