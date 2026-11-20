/**
 * A workspace whose packages are imported by path, in every shape the two
 * questions about packages answer for: past a declared entry, into a package
 * that declares none, into a package that declares an entry this reading could
 * not follow, and into a package whose `exports` opens only subpaths.
 */

// compass: variance-authority.report.agent-surface

import type { Deep, Help, Taken, Use } from '@variance-authority/package/help';
import { encodeHelpStore, type StoreUse } from '@variance-authority/sense';
import { heldStore } from '../snapshot.js';
import { specifierOf } from '../tools/find.js';

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
      entry: true,
      openings: [
        {
          subpath: '.',
          source: 'packages/lib/src/index.ts',
          entries: [{ name: 'greet', kind: 'function', at: 'packages/lib/src/greet.ts', declared: 'greet', line: 1, usedBy: ['@acme/app'], uses: 1, sites: [], throughDefault: [] }],
          whole: [],
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
  unfollowed: [],
  exported: [],
  unreadable: [],
};

/** `base`, `BY_PATH` unless given, with `more` imports of each file another package imports by path. */
export function busier(more: number, base: Help = BY_PATH): Help {
  const again = (held: Deep, index: number): Deep => {
    const at = held.at.replace(/\.ts$/u, `-${index}.ts`);
    return { ...held, at, names: held.names.map((taken) => ({ ...taken, at })) };
  };
  const repeated = (imports: readonly Deep[]): readonly Deep[] => [
    ...imports,
    ...Array.from({ length: more }, (_, index) => imports.map((held) => again(held, index))).flat(),
  ];
  return { ...base, deep: repeated(base.deep), byPath: repeated(base.byPath), unfollowed: repeated(base.unfollowed) };
}

/**
 * A package that declares an entry this reading could not follow, so it opens
 * nothing: one import of that entry, one past it, and one of its own.
 */
export const QUIET: Help = {
  ...BY_PATH,
  packages: [...BY_PATH.packages, { name: '@acme/quiet', declared: { main: 'gone.js' }, entry: true, openings: [] }],
  deep: [importOf('@acme/quiet/src/hush', '@acme/app', 'apps/app/src/hushed.ts', ['hush'])],
  byPath: [],
  unfollowed: [
    { specifier: '@acme/quiet', by: '@acme/app', at: 'apps/app/src/entered.ts', line: 1, names: importOf('@acme/quiet', '@acme/app', 'apps/app/src/entered.ts', ['hush']).names },
    { specifier: '@acme/quiet', by: '@acme/quiet', at: 'packages/quiet/src/self.ts', line: 1, names: [] },
  ],
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
      entry: true,
      openings: [
        {
          subpath: './server',
          source: 'packages/srv/src/server.ts',
          entries: [{ name: 'listen', kind: 'function', at: 'packages/srv/src/server.ts', declared: 'listen', line: 1, usedBy: ['@acme/app'], uses: 1, sites: [], throughDefault: [] }],
          whole: [],
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

/**
 * The value `help` describes, as every answer holds it: laid out as the
 * addon's encoder takes a store, encoded by the addon, and opened, so a
 * question that reads the store's rows can ask it.
 */
export function stored(help: Help): Help {
  const use = (held: Use | Taken): StoreUse => ({
    by: held.by,
    at: held.at,
    line: held.line,
    type: held.type,
    kind: held.kind,
    ...(held.local === undefined ? {} : { local: held.local }),
    ...(held.through === undefined ? {} : { through: held.through.kind }),
    throughLine: held.through?.line ?? 0,
    throughDefault: held.through?.throughDefault === true,
    whole: held.through?.whole === true,
    ...('name' in held ? { name: held.name } : {}),
  });
  const deep = (held: Deep) => ({ specifier: held.specifier, by: held.by, at: held.at, line: held.line, ...(held.to === undefined ? {} : { to: held.to }), names: held.names.map(use) });
  const store = {
    packages: help.packages.map((owner) => ({
      name: owner.name,
      entry: owner.entry,
      openings: owner.openings.map((opening) => ({
        subpath: opening.subpath,
        source: opening.source,
        spec: specifierOf(owner, opening),
        entries: opening.entries.map(({ sites, throughDefault, ...entry }) => ({ ...entry, sites: sites.map(use), throughDefault: throughDefault.map(use) })),
        whole: opening.whole.map(use),
      })),
    })),
    deep: help.deep.map(deep),
    byPath: help.byPath.map(deep),
    unfollowed: help.unfollowed.map(deep),
    unreadable: help.unreadable,
  };
  return heldStore(encodeHelpStore(store, help.exported).bytes);
}
