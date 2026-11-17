import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readWorkspace } from './read.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../../package/src/__fixtures__/workspace');

const usage = await readWorkspace(WORKSPACE);
const usesOf = (specifier: string, name: string) => {
  const [owner, subpath] = specifier.split(' ');
  return usage.packages.find((one) => one.name === owner)?.openings.find((one) => one.subpath === subpath)?.entries.find((one) => one.name === name)?.sites;
};

describe('what a workspace imports from what it publishes', () => {

  it('records every place a published name is imported', () => {
    const uses = usesOf('alpha .', 'measure') ?? [];
    expect(uses.map((use) => `${use.by} ${use.at}:${use.line}`)).toEqual([
      'beta packages/beta/src/index.ts:1',
    ]);
  });

  it('names the package that imports, not the file', () => {
    // Ownership is the nearest manifest above the file. It is what makes an
    // example directory a consumer with a name rather than an anonymous caller.
    expect(usesOf('alpha ./direct', 'already')?.[0]?.by).toBe('beta');
  });

  it('counts a re-export as an import, because it is one', () => {
    expect(usesOf('alpha .', 'Shape')?.map((use) => use.at)).toEqual([
      'packages/beta/src/deep.ts',
      'packages/beta/src/index.ts',
    ]);
  });

  it('says whether a use was a type-only one', () => {
    const uses = usesOf('alpha .', 'Shape') ?? [];
    expect(uses.map((use) => use.type)).toEqual([true, false]);
  });

  it('attributes nothing to a specifier that names no workspace package', () => {
    expect(usage.packages.some((one) => one.name.startsWith('node:'))).toBe(false);
  });

  it('counts a namespace import against the package and against no name in it', () => {
    // `import * as everything from 'alpha'` takes whatever is there. Filing it
    // under a name would be a guess, and the guess would rank that name.
    expect(usesOf('alpha .', 'everything')).toBeUndefined();
  });

  it('records a subpath the manifest does not open, and the names it takes, rather than dropping it', () => {
    expect(usage.deep).toMatchObject([
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

  it('keeps the published package list when an unrelated directory is skipped', async () => {
    const narrow = await readWorkspace(WORKSPACE, { skip: ['extra'] });
    expect(narrow.packages.map((one) => one.name)).toEqual(usage.packages.map((one) => one.name));
  });

  it('reads the same workspace the same way twice', async () => {
    expect(await readWorkspace(WORKSPACE)).toEqual(usage);
  });
});

