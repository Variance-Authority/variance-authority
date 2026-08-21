import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Names, createReader, namesReachedBy } from './reach.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');
const ALPHA = join(WORKSPACE, 'packages/alpha/src');
const BETA = join(WORKSPACE, 'packages/beta/src');

const ENTRYPOINTS = new Map([
  ['alpha .', join(ALPHA, 'index.ts')],
  ['alpha ./direct', join(ALPHA, 'direct.ts')],
]);

const temporary: string[] = [];
afterAll(() => {
  for (const where of temporary) rmSync(where, { recursive: true, force: true });
});

/** A directory of files that can see each other, read from one of them. */
function reachIn(files: Readonly<Record<string, string>>, from: string): Names {
  const where = mkdtempSync(join(tmpdir(), 'variance-reach-'));
  temporary.push(where);
  mkdirSync(where, { recursive: true });
  for (const [name, source] of Object.entries(files)) writeFileSync(join(where, name), source);
  return namesReachedBy(createReader(where), join(where, from));
}

/** A name to the one word it turned out to be. */
function words(names: Names): Record<string, string> {
  return Object.fromEntries([...names].map(([name, kinds]) => [name, [...kinds].sort().join('+')]));
}

describe('a barrel', () => {
  const reader = createReader(WORKSPACE, ENTRYPOINTS);
  const index = join(ALPHA, 'index.ts');
  const found = words(namesReachedBy(reader, index));

  it('publishes every name the files under it declare', () => {
    expect(found['measure']).toBe('function');
    expect(found['Shape']).toBe('interface');
    expect(found['third']).toBe('const');
  });

  it('publishes a namespace re-export as one object rather than as a set', () => {
    // `export * as shapes from './shapes.js'` is one name. A bare `export *`
    // from the same file is the set, and both are written in that barrel.
    expect(found['shapes']).toBe('namespace-object');
  });

  it('is read once, however many lines reach it', () => {
    expect(namesReachedBy(reader, index)).toBe(reader.reached.get(index));
  });
});

describe('a specifier that leaves the workspace', () => {
  const found = words(namesReachedBy(createReader(WORKSPACE, ENTRYPOINTS), join(BETA, 'index.ts')));

  it('is a name the workspace publishes and does not own', () => {
    expect(found['readFileSync']).toBe('foreign');
  });

  it('is recorded as the star it was written as, when it is a star', () => {
    expect(found["* from 'node:path'"]).toBe('foreign');
  });
});

describe('a re-export that hops packages', () => {
  it('lands on the source behind the other manifest', () => {
    const found = words(namesReachedBy(createReader(WORKSPACE, ENTRYPOINTS), join(BETA, 'index.ts')));
    expect(found['measure']).toBe('function');
    expect(found['already']).toBe('const');
  });

  it('is foreign when no manifest answers for it', () => {
    const found = words(namesReachedBy(createReader(WORKSPACE), join(BETA, 'index.ts')));
    expect(found['measure']).toBe('foreign');
  });
});

describe('two files that re-export each other', () => {
  it('terminate', () => {
    const found = reachIn(
      {
        'one.ts': "export * from './two.js';\nexport const here = 1;\n",
        'two.ts': "export * from './one.js';\nexport const there = 2;\n",
      },
      'one.ts',
    );
    expect(words(found)).toEqual({ here: 'const', there: 'const' });
  });
});

describe('what it refuses rather than guesses', () => {
  it('a name a file exports and nothing in it declares', () => {
    expect(() => reachIn({ 'one.ts': 'export { missing };\n' }, 'one.ts')).toThrow(
      /exports `missing`, and no declaration there says what it is/,
    );
  });

  it('a name re-exported from a file that does not publish it', () => {
    expect(() =>
      reachIn(
        { 'one.ts': "export { absent } from './two.js';\n", 'two.ts': 'export const present = 1;\n' },
        'one.ts',
      ),
    ).toThrow(/re-exports `absent` from `\.\/two\.js`, which does not publish it/);
  });
});
