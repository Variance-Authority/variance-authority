import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readOfferings } from './manifest.js';
import { readUsage, usageFrom } from './use.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

function opened(): Set<string> {
  const keys = new Set<string>();
  for (const offering of readOfferings(WORKSPACE)) {
    for (const entry of offering.entrypoints) keys.add(`${offering.name} ${entry.subpath}`);
  }
  return keys;
}

describe('what a workspace imports from what it publishes', () => {
  const usage = readUsage(WORKSPACE, opened());

  it('records every place a published name is imported', () => {
    const uses = usage.names.get('alpha .')?.get('measure') ?? [];
    expect(uses.map((use) => `${use.by} ${use.at}:${use.line}`)).toEqual([
      'beta packages/beta/src/index.ts:1',
    ]);
  });

  it('names the package that imports, not the file', () => {
    // Ownership is the nearest manifest above the file. It is what makes an
    // example directory a consumer with a name rather than an anonymous caller.
    expect(usage.names.get('alpha ./direct')?.get('already')?.[0]?.by).toBe('beta');
  });

  it('counts a re-export as an import, because it is one', () => {
    expect(usage.names.get('alpha .')?.get('Shape')?.map((use) => use.at)).toEqual([
      'packages/beta/src/deep.ts',
      'packages/beta/src/index.ts',
    ]);
  });

  it('says whether a use was a type-only one', () => {
    const uses = usage.names.get('alpha .')?.get('Shape') ?? [];
    expect(uses.map((use) => use.type)).toEqual([true, false]);
  });

  it('attributes nothing to a specifier that names no workspace package', () => {
    expect([...usage.names.keys()].some((key) => key.startsWith('node:'))).toBe(false);
  });

  it('counts a namespace import against the package and against no name in it', () => {
    // `import * as everything from 'alpha'` takes whatever is there. Filing it
    // under a name would be a guess, and the guess would rank that name.
    expect(usage.names.get('alpha .')?.get('everything')).toBeUndefined();
  });

  it('records a subpath the manifest does not open, and the names it takes, rather than dropping it', () => {
    expect(usage.deep).toEqual([
      {
        specifier: 'alpha/values',
        by: 'beta',
        at: 'packages/beta/src/deep.ts',
        line: 4,
        names: [{ name: 'Level', by: 'beta', at: 'packages/beta/src/deep.ts', line: 4, type: false, kind: 'source' }],
      },
    ]);
  });

  it('reads every file it walked', () => {
    expect(usage.unreadable).toEqual([]);
  });

  it('descends into a directory an option does not skip, and not into one it does', () => {
    const narrow = readUsage(WORKSPACE, opened(), { skip: ['extra'] });
    expect(narrow.names.get('alpha .')?.get('measure')).toHaveLength(1);
    expect([...narrow.names.keys()].sort()).toEqual([...usage.names.keys()].sort());
  });

  it('reads the same workspace the same way twice', () => {
    expect(readUsage(WORKSPACE, opened())).toEqual(usage);
  });
});

describe('an import into a package nothing the reading opens', () => {
  const importing = (specifier: string) => [
    { at: 'apps/app/src/a.ts', by: 'app', requests: [{ specifier, line: 1, names: [{ imported: 'hush', type: false, line: 1 }] }] },
  ];

  it('is past the entry of a published package whose declared entry leads to no file', () => {
    const usage = usageFrom(new Set(), importing('gone/src/hush'), { published: new Set(['gone']), unentered: new Set(), declared: new Set(['gone .']) });

    expect(usage.deep.map((held) => held.specifier)).toEqual(['gone/src/hush']);
    expect(usage.byPath).toEqual([]);
  });

  it('is of that entry, and not past it, when it names the entry the manifest declares', () => {
    const usage = usageFrom(new Set(), importing('gone'), { published: new Set(['gone']), unentered: new Set(), declared: new Set(['gone .']) });

    expect(usage.unfollowed.map((held) => held.specifier)).toEqual(['gone']);
    expect(usage.deep).toEqual([]);
  });

  it('is by path into a package that declares no entry, and not followed into a package that is neither', () => {
    const targets = { published: new Set<string>(), unentered: new Set(['kit']), declared: new Set<string>() };

    expect(usageFrom(new Set(), importing('kit/src/tax'), targets).byPath.map((held) => held.specifier)).toEqual(['kit/src/tax']);
    expect(usageFrom(new Set(), importing('react/jsx-runtime'), targets)).toMatchObject({ deep: [], byPath: [], unfollowed: [] });
  });
});
