import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceStem } from './page-side.mjs';
import { bridgeWorkspace, foldBuilt, manifests, packageFaces, published } from './since-graph.mjs';
import { ROOT } from './workspaces.js';

/**
 * The half of `yarn test:since` that decides whether the graph is one graph.
 *
 * The scan resolves imports and then refuses any resolution that landed in
 * `dist`, which is correct for a graph of somebody's source and, in a workspace
 * whose every cross-package import is a manifest `exports` entry pointing at
 * built output, leaves one island per package. Nothing fails when that happens:
 * the narrowing still selects, the walk still runs, and every distance comes back
 * *unmeasurable* — a tool reporting that it cannot see, in a shape that reads
 * like a repository with no cross-package reach in it.
 *
 * So the two steps that put the graph back together are checked here, and the
 * repository's own manifests are checked against the fold that consumes them.
 */

const stemOf = (path: string): string => sourceStem(ROOT, path);

describe('a specifier is resolved the way the runtime resolved it', () => {
  const packages = manifests(ROOT, ['packages']);

  it('follows the manifest rather than guessing a source path', () => {
    expect(published(packages, '@variance-authority/core/format')).toBe('packages/core/dist/format/index.js');
    expect(published(packages, '@variance-authority/core')).toBe('packages/core/dist/index.js');
  });

  it('says nothing about a package this workspace does not hold', () => {
    expect(published(packages, 'vitest')).toBeUndefined();
    expect(published(packages, '@variance-authority/core/not-published')).toBeUndefined();
  });

  it('lands on a built path whose source this repository has', () => {
    // The fold is by stem, so a published entry that does not fold onto a real
    // file is an edge the walk will dead-end on. Two extensions, because a
    // package publishing a `.tsx` entry folds the same way.
    const built = published(packages, '@variance-authority/sense/test-selection')!;
    const stem = stemOf(built);

    expect(['.ts', '.tsx'].some((extension) => existsSync(join(ROOT, `${stem}${extension}`)))).toBe(true);
  });
});

describe('the two copies of one module are one node', () => {
  const records = [
    { file: 'packages/a/src/index.ts', edges: [{ to: 'packages/b/dist/index.js', kind: 'imports' as const }] },
    { file: 'packages/b/src/index.ts', edges: [] },
  ];

  it('folds an edge that landed on built output onto the source it was built from', () => {
    const { records: folded } = foldBuilt(records, stemOf);

    expect(folded[0]!.edges).toEqual([{ to: 'packages/b/src/index.ts', kind: 'imports' }]);
  });

  it('leaves an edge nothing was scanned for alone, and says the graph did not read it', () => {
    // A package outside the scan is not a package with no imports, and the
    // reading next door tells those two apart by asking exactly this.
    const { records: folded, enumerated } = foldBuilt(
      [{ file: 'packages/a/src/index.ts', edges: [{ to: 'vendor/thing/dist/index.js', kind: 'imports' as const }] }],
      stemOf,
    );

    expect(folded[0]!.edges).toEqual([{ to: 'vendor/thing/dist/index.js', kind: 'imports' }]);
    expect(enumerated('vendor/thing/dist/index.js')).toBe(false);
    expect(enumerated('packages/a/src/index.ts')).toBe(true);
  });

  it('answers for a file the scan read but could not enumerate', () => {
    const { enumerated, named } = foldBuilt(
      [{ file: 'packages/a/src/index.ts', unknown: 'it does something dynamic' }],
      stemOf,
    );

    expect(enumerated('packages/a/src/index.ts')).toBe(false);
    expect(named('packages/a/dist/index.js')).toBe('packages/a/src/index.ts');
  });
});

describe('an import the resolver refused is put back', () => {
  it('adds the edge the manifest describes, and nothing for a real dependency', () => {
    const packages = manifests(ROOT, ['packages']);
    const [record] = bridgeWorkspace(
      [{ file: 'packages/cli/src/x.ts', unresolved: ['@variance-authority/core/format', 'vitest'] }],
      packages,
    );

    expect(record!.edges).toEqual([{ to: 'packages/core/dist/format/index.js', kind: 'imports' }]);
  });
});

describe('a face is what a package publishes', () => {
  const packages = manifests(ROOT, ['packages']);
  const named = (file: string): string => `${stemOf(file)}.ts`;
  const faces = packageFaces(packages, stemOf, named);

  it('reports an importer that landed behind a package rather than on it', () => {
    expect(faces('packages/core/src/format/canonical.ts', 'packages/cli/src/x.ts')).toMatchObject({
      unit: 'packages/core',
      as: '@variance-authority/core',
    });
  });

  it('holds a package against nobody inside it', () => {
    // The rule this repository actually keeps is `boundaries.check.ts`: a
    // manifest, not a directory index. A module reaching sideways within its own
    // package has crossed nothing anybody declared.
    expect(faces('packages/core/src/format/canonical.ts', 'packages/core/src/judge/fingerprint.ts')).toBeUndefined();
  });

  it('leaves a published entry alone', () => {
    expect(faces('packages/core/src/format/index.ts', 'packages/cli/src/x.ts')).toBeUndefined();
  });
});
