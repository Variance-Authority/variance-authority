import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { affectedSubjects, indexOf } from './affected.js';
import { affectedFiles, refused } from './reach.js';

/**
 * A changed file read from both texts as running what it ran before.
 *
 * The reading is the addon's, and it is asserted where it is made; here it
 * arrives as a list, `quiet`, and the property is what every walk does with
 * it: a quiet file seeds nothing, forces nothing, and is named in the sentence
 * under the answer rather than vanishing from it.
 */

const GRAPH = relationsOfFiles([
  { file: 'src/ds/Button.tsx', declares: ['Button'], edges: [{ to: 'src/ds/tokens.ts', kind: 'imports' }] },
  { file: 'src/ds/Clock.tsx', declares: ['Clock'] },
  { file: 'src/ds/tokens.ts' },
]);

const ROOTS = ['src'];
const PLANNED = ['story:button', 'story:clock'];
const BASELINES = new Map<string, readonly string[] | undefined>([
  ['story:button', ['Button']],
  ['story:clock', ['Clock']],
]);
const SOURCE = indexOf(
  new Map([
    ['src/ds/Button.tsx', 'export function Button() { return null }'],
    ['src/ds/Clock.tsx', 'export const Clock = () => null'],
  ]),
);

describe('the files a diff reaches', () => {
  it('walks from the files that moved and names the ones that did not', () => {
    const affected = affectedFiles(GRAPH, ['src/ds/tokens.ts', 'src/ds/Clock.tsx'], ROOTS, [], ['src/ds/tokens.ts']);
    if (refused(affected)) throw new Error(affected.whole);

    expect(affected.files).toEqual(['src/ds/Clock.tsx']);
    expect(affected.how).toMatch(/src\/ds\/tokens\.ts changes nothing that runs, so it seeds nothing/);
  });

  it('refuses a diff every file of which runs what it ran before, and says why', () => {
    const affected = affectedFiles(GRAPH, ['src/ds/tokens.ts'], ROOTS, [], ['src/ds/tokens.ts']);

    expect(refused(affected) && affected.whole).toMatch(/src\/ds\/tokens\.ts changes nothing that runs/);
  });
});

describe('the subjects a diff reaches', () => {
  const answerFor = (changed: readonly string[], quiet: readonly string[], graph = true) =>
    affectedSubjects({
      planned: PLANNED,
      changed,
      source: SOURCE,
      roots: ROOTS,
      baselines: BASELINES,
      ...(graph ? { relations: GRAPH } : {}),
      quiet,
    });

  it('observes no subject through a file that runs what it ran before', () => {
    const answer = answerFor(['src/ds/tokens.ts', 'src/ds/Clock.tsx'], ['src/ds/tokens.ts']);

    expect(answer.observe).toEqual(['story:clock']);
    expect(answer.whole).toBeUndefined();
  });

  it('observes nothing, with the file named, when every changed file is quiet', () => {
    const answer = answerFor(['src/ds/tokens.ts'], ['src/ds/tokens.ts']);

    expect(answer.observe).toEqual([]);
    expect(answer.because).toMatch(/src\/ds\/tokens\.ts changes nothing that runs/);
    expect(answer.skipped.map((entry) => entry.because)).not.toContainEqual(expect.stringMatching(/\(\)/));
  });

  it('does not widen over a quiet file that declares no component, without a graph', () => {
    // Without a graph a changed file nothing declares forces the whole run,
    // because a stylesheet or a helper can move anything. A quiet one moves
    // nothing, so it forces nothing either.
    const answer = answerFor(['src/ds/tokens.ts', 'src/ds/Clock.tsx'], ['src/ds/tokens.ts'], false);

    expect(answer.whole).toBeUndefined();
    expect(answer.observe).toEqual(['story:clock']);
  });

  it('still widens over a changed file that declares nothing and is not quiet, without a graph', () => {
    const answer = answerFor(['src/ds/tokens.ts', 'src/ds/Clock.tsx'], [], false);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toMatch(/declares no component/);
  });
});
