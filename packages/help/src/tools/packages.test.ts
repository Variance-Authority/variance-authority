import { describe, expect, it } from 'vitest';
import type { Deep, Help } from '@variance-authority/package/help';
import { packages } from './packages.js';

/**
 * `docs_packages` with no package counts each package and names the question
 * that opens one; with a package it lists what stands behind that package's
 * counts.
 *
 * Kibana's shape is the reason. Its packages declare no entry, and other
 * packages import 141,632 of their files by path. Listing every one of those
 * imports printed 200,330 lines, and walking every import once per package
 * took 30 seconds on that one repository.
 */

/** An import of `specifier` by `by`, at `at`, taking `names`. */
function importOf(specifier: string, by: string, at: string, names: readonly string[]): Deep {
  return {
    specifier,
    by,
    at,
    line: 1,
    to: `${specifier.replace(/^@acme\//u, 'packages/')}.ts`,
    names: names.map((name, index) => ({ name, by, at, line: index + 1, kind: 'source' as const, type: false })),
  };
}

const HELP: Help = {
  packages: [
    {
      name: '@acme/lib',
      declared: { main: 'src/index.ts' },
      openings: [
        {
          subpath: '.',
          source: 'packages/lib/src/index.ts',
          entries: [{ name: 'greet', kind: 'function', at: 'packages/lib/src/greet.ts', line: 1, usedBy: ['@acme/app'], uses: 1, sites: [] }],
        },
      ],
    },
  ],
  deep: [
    importOf('@acme/lib/src/internal/math', '@acme/app', 'apps/app/src/total.ts', ['addTax']),
    importOf('@acme/lib/src/internal/format', '@acme/app', 'apps/app/src/label.ts', ['formatPrice']),
  ],
  byPath: [
    importOf('@acme/kit/src/money/tax', '@acme/app', 'apps/app/src/checkout.ts', ['taxOf']),
    importOf('@acme/kit/src/ui/Button', '@acme/app', 'apps/app/src/checkout.ts', ['Button']),
    importOf('@acme/kit/src/money/tax', '@acme/kit', 'packages/kit/src/self.ts', ['taxOf']),
    importOf('@acme/stamp/src/stamp', '@acme/app', 'apps/app/src/stamped.ts', ['stamp']),
  ],
  exported: [],
  unreadable: [],
};

/** `HELP` with `more` imports of each file another package imports by path. */
function busier(more: number): Help {
  const again = (held: Deep, index: number): Deep => ({ ...held, at: held.at.replace(/\.ts$/u, `-${index}.ts`) });
  return {
    ...HELP,
    deep: [...HELP.deep, ...Array.from({ length: more }, (_, index) => HELP.deep.map((held) => again(held, index))).flat()],
    byPath: [...HELP.byPath, ...Array.from({ length: more }, (_, index) => HELP.byPath.map((held) => again(held, index))).flat()],
  };
}

describe('docs_packages with no package', () => {
  it('counts what each package is imported for, one row per package, and lists no import', () => {
    const text = packages.run(HELP, {});

    expect(text).toMatch(/^@acme\/lib — 1 name, 1 imported elsewhere, 0 documented$/m);
    expect(text).toMatch(/^ {2}@acme\/kit — 2 names from 2 of its files$/m);
    expect(text).toMatch(/^ {2}@acme\/stamp — 1 name from 1 of its files$/m);
    expect(text).toMatch(/^2 imports reach past a published entrypoint\./m);
    expect(text).toMatch(/^ {2}@acme\/lib — 2 imports$/m);
    expect(text).not.toContain('apps/app/src/');
  });

  it('prints the narrower questions, with arguments from the rows above', () => {
    const text = packages.run(HELP, {});

    expect(text).toMatch(/^Narrower questions:$/m);
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/lib$/m);
    expect(text).toMatch(/^ {2}variance ask packages --package @acme\/kit$/m);
  });

  it('opens on its first row when no published package opens an entry', () => {
    const text = packages.run({ ...HELP, packages: [{ name: '@acme/lib', declared: {}, openings: [] }] }, {});

    expect(text.split('\n')[0]).toBe('2 packages declare no entry. Other packages import their files by path, most names first:');
  });

  it('is as long for a hundred imports of each file as for one', () => {
    expect(packages.run(busier(100), {}).split('\n')).toHaveLength(packages.run(HELP, {}).split('\n').length);
  });

  it('reads each import a number of times that does not grow with the number of packages', () => {
    // Every package another package imports by path, once each. The answer
    // used to walk every import once per package, so the reads of one import
    // grew with the package count; counted through a getter on the field every
    // walk reads first, the reads per import must be the same at 10 and at 200.
    function readsPerImport(owners: number): number {
      let reads = 0;
      const byPath = Array.from({ length: owners }, (_, index) => {
        const held = importOf(`@acme/p${index}/src/file`, '@acme/app', `apps/app/src/f${index}.ts`, ['one']);
        return Object.defineProperty({ ...held }, 'specifier', {
          get: () => {
            reads += 1;
            return held.specifier;
          },
          enumerable: true,
        });
      });
      packages.run({ ...HELP, deep: [], byPath }, {});
      return reads / owners;
    }

    expect(readsPerImport(200)).toBe(readsPerImport(10));
  });
});

describe('docs_packages with a package', () => {
  it('lists what other packages import by path from a package that declares no entry, its own imports left out', () => {
    const text = packages.run(HELP, { package: '@acme/kit' });

    expect(text).toMatch(/^@acme\/kit declares no entry\. Other packages import 2 names from 2 of its files by path:$/m);
    expect(text).toContain('  @acme/kit/src/money/tax — taxOf — @acme/app at apps/app/src/checkout.ts:1');
    expect(text).toContain('  @acme/kit/src/ui/Button — Button — @acme/app at apps/app/src/checkout.ts:1');
    expect(text).not.toContain('packages/kit/src/self.ts');
    expect(text).not.toContain('@acme/stamp');
    expect(text).toMatch(/^ {2}variance ask packages --package @acme\/kit\/src\/money\/tax$/m);
    expect(text).toMatch(/^ {2}variance ask uses --name taxOf --package @acme\/kit$/m);
  });

  it('lists every import past the entry of a package that declares one, after its specifiers', () => {
    const text = packages.run(HELP, { package: '@acme/lib' });

    expect(text).toMatch(/^@acme\/lib — 1 name, 1 imported elsewhere, 0 documented$/m);
    expect(text).toMatch(/^2 imports reach past a published entrypoint of @acme\/lib\./m);
    expect(text).toContain('  @acme/lib/src/internal/math — @acme/app at apps/app/src/total.ts:1');
    expect(text).toContain('  @acme/lib/src/internal/format — @acme/app at apps/app/src/label.ts:1');
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/lib$/m);
  });

  it('takes one specifier of the package, and answers for that specifier alone', () => {
    const text = packages.run(HELP, { package: '@acme/lib/src/internal/math' });

    expect(text).toContain('  @acme/lib/src/internal/math — @acme/app at apps/app/src/total.ts:1');
    expect(text).not.toContain('format');
  });

  it('refuses a package nothing publishes and nothing imports, and names the question that counts the ones there are', () => {
    expect(() => packages.run(HELP, { package: '@acme/nowhere' })).toThrow(/`@acme\/nowhere`.*`variance ask packages`/u);
  });
});
