/**
 * A workspace whose packages are imported by path, in every shape the two
 * questions about packages answer for: past a declared entry, into a package
 * that declares none, into a package that declares an entry and opens nothing,
 * and into a package whose `exports` opens only subpaths.
 */

// compass: variance-authority.report.agent-surface

import type { Deep, Help } from '@variance-authority/package/help';

/** An import of `specifier` by `by`, at `at`, taking `names`. */
export function importOf(specifier: string, by: string, at: string, names: readonly string[]): Deep {
  return {
    specifier,
    by,
    at,
    line: 1,
    to: `${specifier.replace(/^@acme\//u, 'packages/')}.ts`,
    names: names.map((name, index) => ({ name, by, at, line: index + 1, kind: 'source' as const, type: false })),
  };
}

/**
 * `@acme/lib` declares an entry and two imports reach past it; `@acme/kit` and
 * `@acme/stamp` declare none, and `@acme/kit` imports one of its own files.
 */
export const BY_PATH: Help = {
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

/** `BY_PATH` with `more` imports of each file another package imports by path. */
export function busier(more: number): Help {
  const again = (held: Deep, index: number): Deep => ({ ...held, at: held.at.replace(/\.ts$/u, `-${index}.ts`) });
  return {
    ...BY_PATH,
    deep: [...BY_PATH.deep, ...Array.from({ length: more }, (_, index) => BY_PATH.deep.map((held) => again(held, index))).flat()],
    byPath: [...BY_PATH.byPath, ...Array.from({ length: more }, (_, index) => BY_PATH.byPath.map((held) => again(held, index))).flat()],
  };
}

/** A package that declares an entry and opens nothing, and one import past it. */
export const QUIET: Help = {
  ...BY_PATH,
  packages: [...BY_PATH.packages, { name: '@acme/quiet', declared: { main: 'gone.js' }, openings: [] }],
  deep: [importOf('@acme/quiet/src/hush', '@acme/app', 'apps/app/src/hushed.ts', ['hush'])],
  byPath: [],
};

/**
 * `@acme/srv`, whose `exports` opens `./server` and no `.`, and three imports
 * past it: more than any other package, so `docs_packages` names it.
 */
export const SUBPATHS_ONLY: Help = {
  ...BY_PATH,
  packages: [
    ...BY_PATH.packages,
    {
      name: '@acme/srv',
      declared: { exports: { './server': './src/server.ts' } },
      openings: [
        {
          subpath: './server',
          source: 'packages/srv/src/server.ts',
          entries: [{ name: 'listen', kind: 'function', at: 'packages/srv/src/server.ts', line: 1, usedBy: ['@acme/app'], uses: 1, sites: [] }],
        },
      ],
    },
  ],
  deep: [
    ...BY_PATH.deep,
    importOf('@acme/srv/src/routes', '@acme/app', 'apps/app/src/routes.ts', ['route']),
    importOf('@acme/srv/src/routes', '@acme/app', 'apps/app/src/admin.ts', ['route']),
    importOf('@acme/srv/src/wire', '@acme/app', 'apps/app/src/wire.ts', ['connect']),
  ],
};
