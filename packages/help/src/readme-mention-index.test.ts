import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Entry, type Help } from '@variance-authority/package/help';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readWorkspace } from './read.js';
import { readHelp } from './walk.js';

// compass: variance-authority.report.agent-surface

/**
 * The value published off the index is the value the walk joins.
 *
 * Both join the uses, the names each entry hands out and the READMEs that
 * mention the names nothing is written above in the one join on the addon's
 * side; the walk reads them from disk and the publish from the index. Both
 * must say the same: the same entries in the same order, and the same passage
 * of the same README for each name, its offsets counted as JavaScript counts
 * them, in UTF-16 code units.
 */

const temporary: string[] = [];
let root: string;
let walked: Help;
let indexed: Help;

function write(file: string, contents: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** A section long enough that the passage is windowed around the hit, cut on both sides. */
const LONG = [
  '## Windowed',
  '',
  ...Array.from({ length: 30 }, (_, at) => `Line ${at} of a section that goes on, written so the passage outgrows the window.`),
  'Here `windowed` is named, in the middle of the section.',
  ...Array.from({ length: 30 }, (_, at) => `Trailing line ${at} of the same section, written to outgrow the window below the hit.`),
].join('\n');

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'help-readme-mention-')));
  temporary.push(root);
  write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }));
  write('README.md', '# Root\n\nThe workspace says `rooted` here, and nowhere nearer.\n');
  write('packages/a/package.json', JSON.stringify({
    name: 'a',
    exports: { '.': './src/index.ts', './again': './src/index.ts', './inner': './src/inner/index.ts' },
  }));
  write('packages/a/README.md', [
    '﻿# a — пакет 🚀',
    '',
    'Café 🚀 prose that names `quoted` in backticks, and bare as well.',
    '',
    'A bare mention of bare, then measurements that are not the name.',
    '',
    'The name $dollar sits beside a word boundary.',
    '',
    '```ts',
    'const coded = 1;',
    '',
    'quoted(coded);',
    '```',
    '',
    LONG,
    '',
    '```js',
    'unclosed(fence);',
    '',
    'still code',
  ].join('\n'));
  write('packages/a/src/inner/README.md', 'Inner prose says `inner` and    \n\nthen `deeper` with trailing space.　\n');
  write('packages/a/src/index.ts', [
    "export { inner, deeper } from './inner/index.js';",
    'export const quoted = 1;',
    'export const bare = 2;',
    'export const measure = 3;',
    'export const $dollar = 4;',
    'export const coded = 5;',
    'export const windowed = 6;',
    'export const unclosed = 7;',
    'export const unmentioned = 9;',
    '/** Written above, so no README is read for it. */',
    'export const documented = 10;',
    'export interface Merged { readonly at: number }',
    'export const Merged = 11;',
    'export default function named(): void {}',
    '',
  ].join('\n'));
  write('packages/a/src/inner/index.ts', 'export const inner = 1;\nexport function deeper(): number { return inner; }\n');
  write('packages/a/src/self.ts', "import { bare } from 'a';\nexport const again = bare;\n");
  write('packages/b/package.json', JSON.stringify({ name: 'b', exports: { '.': './src/index.ts' } }));
  write('packages/b/src/index.ts', [
    "import { quoted, bare, Merged, coded } from 'a';",
    "import named from 'a';",
    "import { inner } from 'a/inner';",
    "export const used = quoted + bare + Merged + inner + named.length + coded;",
    "export const rooted = 8;",
    '',
  ].join('\n'));
  write('packages/b/src/index.test.ts', "import { windowed } from 'a';\nimport { deeper } from 'a/inner';\nexport const seen = windowed + deeper();\n");
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const cache = mkdtempSync(join(tmpdir(), 'help-readme-mention-cache-'));
  temporary.push(cache);
  walked = readHelp(root);
  indexed = await readWorkspace(root, { index: join(cache, 'source-index.bin') });
});

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

function entries(help: Help): readonly Entry[] {
  return help.packages.flatMap((held) => held.openings).flatMap((opening) => opening.entries);
}

describe('the value published off the index, beside the walk', () => {
  it('holds the same packages, entries, uses and mentions in the same order', () => {
    expect(indexed.packages).toEqual(walked.packages);
    expect(indexed.unreadable).toEqual(walked.unreadable);
  });

  it('reads a mention for every name the READMEs name and nothing is written above', () => {
    const mentioned = Object.fromEntries(entries(indexed).filter((entry) => entry.mention !== undefined).map((entry) => [entry.name, entry.mention]));
    expect(Object.keys(mentioned).toSorted()).toEqual(['$dollar', 'bare', 'coded', 'deeper', 'inner', 'quoted', 'rooted', 'unclosed', 'windowed']);
    expect(mentioned['quoted']).toEqual({ at: 'packages/a/README.md', line: 3, text: 'Café 🚀 prose that names `quoted` in backticks, and bare as well.' });
    expect(mentioned['rooted']).toMatchObject({ at: 'README.md', line: 3 });
    expect(mentioned['deeper']).toMatchObject({ at: 'packages/a/src/inner/README.md', line: 3, text: 'then `deeper` with trailing space.' });
    expect(mentioned['windowed']?.text).toMatch(/^…\n[^]*`windowed`[^]*\n…$/);
    expect(entries(indexed).find((entry) => entry.name === 'documented')?.mention).toBeUndefined();
  });
});
