import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileRecord, Tree } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { grep } from './grep.js';

/**
 * The closure decides which files ripgrep is given, and ripgrep decides what
 * matches in them. The checkout is written to disk because `rg` reads files,
 * and the tree is built from records so the closure is the rule and not a scan.
 *
 * `far.ts` and `outside.ts` say the same word. Only one of them is in reach,
 * so an answer holding both was a folder search, not a closure.
 */

const RG = spawnSync('rg', ['--version']).error === undefined;

/** Paths long enough that the closure cannot go to `rg` as one command line. */
const MANY = 3000;
const leaf = (at: number): string => `src/leaves/${'deep-folder-name/'.repeat(5)}leaf-${String(at).padStart(5, '0')}.ts`;

let root: string;
let tree: Tree;

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'grep-'));
  write('src/entry.ts', "import './near';\nconst needle = 0;\n");
  write('src/near.ts', "import './far';\nimport './leaves';\n");
  write('src/far.ts', 'export const needle = 1;\n');
  write('src/outside.ts', 'export const needle = 2;\n');
  write('src/leaves.ts', '');
  const leaves = Array.from({ length: MANY }, (_, at) => leaf(at));
  for (const [at, file] of leaves.entries()) write(file, `export const leaf${at} = ${at === MANY - 1 ? "'haystack'" : at};\n`);
  tree = treeOf(
    [
      reads('src/entry.ts', 'src/near.ts'),
      reads('src/near.ts', 'src/far.ts', 'src/leaves.ts'),
      reads('src/far.ts'),
      reads('src/outside.ts'),
      reads('src/leaves.ts', ...leaves),
      ...leaves.map((file) => reads(file)),
    ],
    root,
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const ask = (input: Record<string, unknown>): string => grep.run(undefined, input, { tree });

describe('grep refuses without a closure', () => {
  it('names the command that answers the whole checkout', () => {
    expect(() => grep.run(undefined, { query: 'needle' })).toThrow('run `rg "needle"`');
  });

  it('refuses a path the tree does not hold', () => {
    expect(() => ask({ query: 'needle', from: 'src/nope.ts' })).toThrow('`src/nope.ts` is not found');
  });
});

describe.skipIf(!RG)('grep over a closure', () => {
  it('answers from the files in reach, nearest first', () => {
    const text = ask({ query: 'needle', from: 'src/entry.ts' });
    expect(text).toContain('2 matching lines in 2 files, nearest first.');
    expect(text.indexOf('src/entry.ts:2:const needle = 0;')).toBeLessThan(text.indexOf('src/far.ts:1:export const needle = 1;'));
    expect(text).toContain('2 imports away:');
    expect(text).not.toContain('outside.ts');
  });

  it('answers against the imports with `to`', () => {
    const text = ask({ query: 'needle', to: 'src/far.ts' });
    expect(text).toContain('src/far.ts:1:');
    expect(text).toContain('src/entry.ts:2:');
    expect(text).not.toContain('outside.ts');
  });

  it('reaches the last of thousands of files, over more than one command line', () => {
    const text = ask({ query: 'haystack', from: 'src/entry.ts' });
    expect(text).toContain(`${leaf(MANY - 1)}:1:`);
    expect(text).toContain('3 imports away:');
  });

  it('counts what the limit leaves out', () => {
    expect(ask({ query: 'leaf', from: 'src/leaves.ts', limit: 2 })).toContain(`${MANY - 2} more not shown`);
  });

  it('says the area held nothing, not that the word is nowhere', () => {
    expect(ask({ query: 'needle', from: 'src/leaves.ts' })).toContain('Nothing in those files matches `needle`.');
  });

  it("hands ripgrep's refusal back", () => {
    expect(() => ask({ query: '(', from: 'src/entry.ts' })).toThrow('ripgrep refused the pattern');
  });
});
