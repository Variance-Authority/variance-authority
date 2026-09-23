import { describe, expect, it } from 'vitest';
import { beforeReach, relationsOfFiles } from '@variance-authority/core/relate';
import { affectedSubjects, indexOf } from './affected.js';

const SOURCE = indexOf(
  new Map([
    ['src/ds/Button.tsx', 'export function Button() { return null }'],
    ['src/ds/Clock.tsx', 'export const Clock = () => null'],
  ]),
);

const ROOTS = ['src'];
const PLANNED = ['story:button', 'story:clock'];
const BASELINES = new Map<string, readonly string[] | undefined>([
  ['story:button', ['Button']],
  ['story:clock', ['Clock']],
]);

/**
 * A change to what the run rests on, which is the one end of the line no walk
 * can reach.
 *
 * Nothing imports a `vitest.config.ts`, so a walk against the arrows from one
 * arrives nowhere and the honest answer from the graph is *no component moved*.
 * That answer is a skipped suite over the file that decides how every test in
 * it runs, so the cases here all assert the refusal — including the one that
 * used to pass silently, a config edited **beside** a component file, where the
 * walk has a seed and answers confidently about a change it never looked at.
 */
describe('a diff that moved what the run rests on', () => {
  const GRAPH = relationsOfFiles(
    [
      {
        file: 'vitest.config.ts',
        edges: [{ to: 'test/setup.ts', kind: 'imports' }],
        packages: [{ to: 'jest-environment-jsdom', kind: 'imports' }],
      },
      { file: 'test/setup.ts' },
      { file: 'src/ds/Button.tsx', declares: ['Button'] },
      { file: 'src/ds/Clock.tsx', declares: ['Clock'] },
    ],
    { depends: [['jest-environment-jsdom', 'jsdom']] },
  );

  const BEFORE = beforeReach(GRAPH, ['vitest.config.ts', '.github/workflows'], { sensed: ROOTS });

  function answerFor(changed: readonly string[], packages: readonly string[] = []) {
    return affectedSubjects({
      planned: PLANNED,
      changed,
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      before: BEFORE,
      install: { packages, manifests: ['yarn.lock', 'package.json'], moved: [] },
    });
  }

  it('observes everything when the harness config itself moved', () => {
    const answer = answerFor(['vitest.config.ts']);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('vitest.config.ts');
  });

  it('still observes everything when the config moved beside a component file', () => {
    // The hole this closes. A diff wholly outside the graph already widened;
    // one changed component alongside it gave the walk a seed, and the run
    // narrowed to that component over a harness edit nobody looked at.
    const answer = answerFor(['vitest.config.ts', 'src/ds/Clock.tsx']);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('vitest.config.ts');
  });

  it('observes everything when a setup file below the entry point moved', () => {
    // Nobody declared `test/setup.ts`. It came with the config, which is the
    // whole return on declaring one file rather than a list.
    const answer = answerFor(['test/setup.ts']);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('test/setup.ts');
  });

  it('observes everything for a path under a declared directory', () => {
    const answer = answerFor(['.github/workflows/ci.yml']);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('.github/workflows/ci.yml');
  });

  it('observes everything for a package the harness rests on and no file names', () => {
    // Before and beyond reach at once: `jsdom` is bumped, the install names it,
    // no file in the repository writes the word, and the environment every test
    // runs in is built on it.
    const answer = answerFor(['yarn.lock'], ['jsdom']);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('jsdom');
  });

  it('narrows as usual for a change the harness does not rest on', () => {
    const answer = answerFor(['src/ds/Clock.tsx']);

    expect(answer.observe).toEqual(['story:clock']);
    expect(answer.whole).toBeUndefined();
  });

  it('narrows as usual when no entry points were declared', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['src/ds/Clock.tsx'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { packages: [], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual(['story:clock']);
    expect(answer.whole).toBeUndefined();
  });
});
