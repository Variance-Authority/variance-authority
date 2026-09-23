import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { affectedSubjects, indexOf } from './affected.js';

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

/**
 * A dependency bump, which is a change no file in this repository contains.
 *
 * The package layer is the far right of the same line: the run starts at the
 * harness, crosses the tests into our code, and goes out into the install
 * without coming back. So every test here is the ordinary walk run one node
 * further out — and the ones that matter are the two that used to be
 * indistinguishable, a lockfile whose packages moved and a lockfile that was
 * merely rewritten.
 */
describe('a diff that changed the install rather than a file', () => {
  const GRAPH = relationsOfFiles(
    [
      {
        file: 'src/ds/Button.tsx',
        declares: ['Button'],
        packages: [{ to: '@mui/material', kind: 'imports' }],
      },
      { file: 'src/ds/Clock.tsx', declares: ['Clock'] },
    ],
    { depends: [['@mui/material', '@emotion/react']] },
  );

  const PLANNED = ['story:button', 'story:clock'];
  const BASELINES = baselines([
    ['story:button', ['Button']],
    ['story:clock', ['Clock']],
  ]);

  it('observes the subjects whose files import a package the install moved', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['yarn.lock', 'package.json'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { packages: ['@mui/material'], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toBeUndefined();
    expect(answer.because).toContain('1 changed package');
  });

  it('follows a transitive bump up to the package our code actually imports', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['yarn.lock'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      // Nothing imports `@emotion/react` by name. `@mui/material` rests on it,
      // and that is the whole reason the install is read as a graph rather than
      // as a list of direct dependencies.
      install: { packages: ['@emotion/react'], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toBeUndefined();
  });

  it('skips everything when the lockfile was rewritten and resolved the same install', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['yarn.lock'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      // The case this whole layer exists for. A workspace version bump rewrites
      // the lockfile and installs nothing, and read as a changed file it used
      // to repaint the entire suite.
      install: { packages: [], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual([]);
    expect(answer.whole).toBeUndefined();
  });

  it('skips everything when the package that moved is one no file imports', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['yarn.lock'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { packages: ['eslint'], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual([]);
    expect(answer.whole).toBeUndefined();
  });

  it('observes everything when the install could not be compared', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['src/ds/Clock.tsx'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { whole: 'pnpm-lock.yaml declares lockfileVersion 10, which this cannot read' },
    });

    // Not the narrower answer the changed file alone would have given. An
    // install this cannot read may have bumped every package in it, and the
    // file list looks identical either way.
    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('lockfileVersion 10');
  });

  it('observes everything when a package moved and no file graph is configured', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['yarn.lock'],
      source: SOURCE,
      roots: ROOTS,
      baselines: BASELINES,
      install: { packages: ['@mui/material'], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('source: { relations: true }');
  });
});

/**
 * A manifest whose change the install does not speak for.
 *
 * `exports`, `main`, `type`, `name` are read by every resolver that loads the
 * package, and none of them is in the lockfile. A diff confined to one of them
 * moves which file every importer of the package loads, so the package is a
 * changed directory, walked back to its importers like one.
 */
describe('a manifest change the install comparison does not read', () => {
  const GRAPH = relationsOfFiles([
    { file: 'packages/ds/src/index.ts' },
    {
      file: 'src/ds/Button.tsx',
      declares: ['Button'],
      edges: [{ to: 'packages/ds/src/index.ts', kind: 'imports' }],
    },
    { file: 'src/ds/Clock.tsx', declares: ['Clock'] },
  ]);

  const PLANNED = ['story:button', 'story:clock'];
  const BASELINES = baselines([
    ['story:button', ['Button']],
    ['story:clock', ['Clock']],
  ]);

  it('observes the importers of a package whose `exports` moved', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['packages/ds/package.json'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { packages: [], manifests: ['yarn.lock', 'package.json'], moved: ['packages/ds/package.json'] },
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toBeUndefined();
  });

  it('still sets a manifest aside when the install spoke for all of it', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['packages/ds/package.json'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { packages: [], manifests: ['yarn.lock', 'package.json'], moved: [] },
    });

    expect(answer.observe).toEqual([]);
    expect(answer.whole).toBeUndefined();
  });

  it('reads a moved manifest the graph holds no file beside as an ordinary changed file', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['src/vendored/package.json'],
      source: SOURCE,
      roots: ROOTS,
      relations: GRAPH,
      baselines: BASELINES,
      install: { packages: [], manifests: ['yarn.lock', 'package.json'], moved: ['src/vendored/package.json'] },
    });

    // Under the scanned roots and nothing scanned beside it: a gap, not an answer.
    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('src/vendored/package.json');
  });
});
