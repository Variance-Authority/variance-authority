import { afterEach, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { answerSearch, searchIndexOf } from './search.js';

/**
 * An engineer describes this repository's code in the words it is written
 * about in: a file by what its name and its opening doc say, a declaration by
 * the phrase its doc writes, and a name by `module`, `package` or `use` as much
 * as by any other word. A typo reaches a name its file keeps to itself the way
 * it reaches an exported one.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

const ask = async (own: Readonly<Record<string, string>>, query: string): Promise<string> => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], own);
  return answerSearch(searchIndexOf(readHelp(root)), { query }, treeOf([], root), root);
};

/** The lines of the section that answers a description, in order. */
const describedLines = (said: string): readonly string[] =>
  said.split('\n').filter((line) => line.includes('[holds:') && !line.includes(' @1.0.0 '));

describe('a file is described by its name and the doc it opens with', () => {
  it('reaches a file whose doc is written after its imports', async () => {
    const said = await ask(
      {
        'src/tools/tokens.ts': "export const tokensOf = (query: string): readonly string[] => query.split(' ');\n",
        'src/tools/loose.ts': [
          "import { tokensOf } from './tokens.js';",
          '',
          '/**',
          " * The loose pass's membership, read off the published dictionary.",
          ' */',
          '',
          '/** The most edits a term may be from what was asked. */',
          'const MAX_FUZZY = 1;',
          '',
          'export function looseNames(query: string): readonly string[] {',
          '  return tokensOf(query).slice(MAX_FUZZY);',
          '}',
          '',
        ].join('\n'),
      },
      'loose reading',
    );
    const lines = describedLines(said);
    expect(lines[0]).toMatch(/^src\/tools\/loose\.ts \[file\] — .*The loose pass's membership, read off the published dictionary\. \[holds: loose, reading\]$/);
    expect(lines.some((line) => line.startsWith('looseNames'))).toBe(true);
  });

  it('reaches a file whose doc is written before its imports', async () => {
    const said = await ask(
      {
        'src/steps.ts': 'export const STEPS = 1;\n',
        'src/precision.ts': [
          '/**',
          " * How precisely a suite's selection decides which tests to skip.",
          ' */',
          '',
          "import { STEPS } from './steps.js';",
          '',
          '/** The steps of it, coarsest first. */',
          'export const PRECISION_STEPS = [STEPS];',
          '',
        ].join('\n'),
      },
      'suite precision grain',
    );
    expect(describedLines(said)).toContainEqual(expect.stringMatching(/^src\/precision\.ts \[file\] — .*How precisely a suite's selection decides which tests to skip\. \[holds: precision, suite\]$/));
  });

  it('does not take a doc that documents the first statement for the file\'s own', async () => {
    const said = await ask({ 'src/sweep.ts': '/** The eviction policy a cache runs under. */\nexport const sweep = 1;\n' }, 'cache eviction policy');
    expect(said).toMatch(/sweep .*\[holds: cache, eviction, policy\]/);
    expect(said).not.toContain('src/sweep.ts [file]');
  });
});

describe('the words a description is asked by', () => {
  it('puts a name that holds the question\'s words before a doc that writes them as its phrase', async () => {
    const said = await ask(
      {
        'src/symbol.ts': '/** `docs_symbol` — what a name is and where it is declared, in full. */\nexport const symbol = 1;\n',
        'src/name.ts': 'export function declaredName(): void {}\n',
      },
      'what a name is and where it is declared in the source',
    );
    const lines = describedLines(said);
    // `what` and `where` are how a question is asked, not what it is about.
    expect(lines.every((line) => !/\[holds: .*\b(what|where)\b/.test(line))).toBe(true);
    const symbol = lines.findIndex((line) => /^symbol .*\[holds: declared, name\]$/.test(line));
    const declaredName = lines.findIndex((line) => line.startsWith('declaredName'));
    expect(declaredName).toBeGreaterThan(-1);
    expect(symbol).toBeGreaterThan(declaredName);
  });

  it('puts the doc that writes the phrase first when two docs hold every word', async () => {
    const said = await ask(
      {
        'src/alpha.ts': '/** The declared type of a name. */\nexport const alpha = 1;\n',
        'src/zeta.ts': '/** Where a name is declared. */\nexport const zeta = 1;\n',
      },
      'name declared',
    );
    const lines = describedLines(said);
    const alpha = lines.findIndex((line) => line.startsWith('alpha '));
    const zeta = lines.findIndex((line) => line.startsWith('zeta '));
    expect(zeta).toBeGreaterThan(-1);
    expect(alpha).toBeGreaterThan(zeta);
  });

  it('does not count the question\'s grammar as its phrase', async () => {
    const lines = describedLines(
      await ask(
        {
          'src/alpha.ts': '/** Where it is: a store and a cache. */\nexport const alpha = 1;\n',
          'src/store.ts': 'export function cacheStore(): void {}\n',
        },
        'where it is the cache for a store',
      ),
    );
    const alpha = lines.findIndex((line) => line.startsWith('alpha '));
    const cacheStore = lines.findIndex((line) => line.startsWith('cacheStore '));
    expect(alpha).toBeGreaterThan(-1);
    expect(cacheStore).toBeGreaterThan(-1);
    expect(cacheStore).toBeLessThan(alpha);
  });

  it('asks this repository by `module`, `package` and `use`, the words its code is written in', async () => {
    const own = {
      'src/modules.ts': 'export function packageModuleOf(path: string): string {\n  return path;\n}\n',
      'src/store.ts': 'export function useStore(): number {\n  return 1;\n}\n',
    };
    expect(await ask(own, 'modules of each package')).toMatch(/packageModuleOf .*\[holds: modules, package\]/);
    expect(await ask(own, 'use of a store')).toMatch(/useStore .*\[holds: store, use\]/);
  });
});

describe('the loose pass', () => {
  it('reaches a name its file keeps to itself through a word one character off', async () => {
    const said = await ask(
      { 'src/harvest.ts': 'function harvestOnce(): number {\n  return 1;\n}\n\nexport const harvested = harvestOnce();\n' },
      'harvst',
    );
    expect(said).toContain('loosely');
    expect(said).toContain('harvestOnce [function] — fixture · src/harvest.ts:1');
  });
});
