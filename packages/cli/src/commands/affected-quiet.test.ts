import { relationsOfFiles, type EdgeUse } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { affectedSubjects, indexOf } from './affected.js';
import { affectedFiles, refused } from './reach.js';

/**
 * A changed file read from both texts as running what it ran before.
 *
 * The reading is the addon's, and it is asserted where it is made; here it
 * arrives as `movedExports`, and the property is what every walk does with
 * it: a file that moved nothing seeds nothing, forces nothing, and is named in
 * the sentence under the answer rather than vanishing from it; a file that
 * moved some exports reaches only the files that import them.
 */

const quiet = (...files: string[]) => new Map(files.map((file) => [file, [] as readonly string[]]));

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
    const affected = affectedFiles(GRAPH, ['src/ds/tokens.ts', 'src/ds/Clock.tsx'], ROOTS, [], quiet('src/ds/tokens.ts'));
    if (refused(affected)) throw new Error(affected.whole);

    expect(affected.files).toEqual(['src/ds/Clock.tsx']);
    expect(affected.how).toMatch(/\(src\/ds\/tokens\.ts: no runtime change\)/);
  });

  it('refuses a diff every file of which runs what it ran before, and says why', () => {
    const affected = affectedFiles(GRAPH, ['src/ds/tokens.ts'], ROOTS, [], quiet('src/ds/tokens.ts'));

    expect(refused(affected) && affected.whole).toMatch(/src\/ds\/tokens\.ts changes nothing that runs/);
  });
});

describe('the subjects a diff reaches', () => {
  const answerFor = (changed: readonly string[], still: readonly string[], graph = true) =>
    affectedSubjects({
      planned: PLANNED,
      changed,
      source: SOURCE,
      roots: ROOTS,
      baselines: BASELINES,
      ...(graph ? { relations: GRAPH } : {}),
      movedExports: quiet(...still),
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

describe('a changed file read by the exports it changed', () => {
  // `Button` reads `color` from the tokens and `Badge` reads `space`; the
  // barrel hands `color` on as `ink`, and `Label` reads it from there.
  const records = [
    { file: 'src/ds/Button.tsx', declares: ['Button'], edges: [{ to: 'src/ds/tokens.ts', kind: 'imports' as const }] },
    { file: 'src/ds/Badge.tsx', declares: ['Badge'], edges: [{ to: 'src/ds/tokens.ts', kind: 'imports' as const }] },
    { file: 'src/ds/index.ts', edges: [{ to: 'src/ds/tokens.ts', kind: 'reexports' as const }] },
    { file: 'src/ds/Label.tsx', declares: ['Label'], edges: [{ to: 'src/ds/index.ts', kind: 'imports' as const }] },
    { file: 'src/ds/tokens.ts' },
  ];
  const uses: Record<string, EdgeUse> = {
    'src/ds/Button.tsx>src/ds/tokens.ts': { imports: ['color'] },
    'src/ds/Badge.tsx>src/ds/tokens.ts': { imports: ['space'] },
    'src/ds/index.ts>src/ds/tokens.ts': { reexports: [['color', 'ink']] },
    'src/ds/Label.tsx>src/ds/index.ts': { imports: ['ink'] },
  };
  const named = relationsOfFiles(records, { uses: (importer, target) => uses[`${importer}>${target}`] });

  it('reaches the importers of what moved, through the barrel, and says which exports moved', () => {
    const moved = new Map([['src/ds/tokens.ts', ['color']]]);
    const affected = affectedFiles(named, ['src/ds/tokens.ts'], ROOTS, [], moved);
    if (refused(affected)) throw new Error(affected.whole);

    expect(affected.files).toEqual(['src/ds/Button.tsx', 'src/ds/Label.tsx', 'src/ds/index.ts', 'src/ds/tokens.ts']);
    expect(affected.how).toMatch(/\(src\/ds\/tokens\.ts changes color\)/);
  });

  it('walks whole from a file the reading named no exports for', () => {
    const affected = affectedFiles(named, ['src/ds/tokens.ts'], ROOTS, [], new Map());
    if (refused(affected)) throw new Error(affected.whole);

    expect(affected.files).toContain('src/ds/Badge.tsx');
  });
});
