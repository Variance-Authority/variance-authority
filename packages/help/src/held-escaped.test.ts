import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { readWorkspace } from './read.js';
import { uses } from './tools/uses.js';

/**
 * A module held whole that leaves the file's sight — passed to a call — is a
 * read the source index cannot follow, and a name read off its `default` is a
 * read through `default`. Neither stays silent: the answer names the site and
 * says what the reading could not see.
 */

const FILES: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'held-escaped', private: true, workspaces: ['packages/*'] }),
  'packages/alpha/package.json': JSON.stringify({
    name: 'alpha',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  }),
  'packages/alpha/tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
  'packages/alpha/src/index.ts': [
    'export function narrow(): number { return 1; }',
    'export function widen(): number { return 2; }',
    '',
  ].join('\n'),
  'packages/beta/package.json': JSON.stringify({ name: 'beta', type: 'module' }),
  'packages/beta/src/index.ts': [
    'export async function run(): Promise<number> {',
    "  const { narrow } = (await import('alpha')).default;",
    '  return narrow();',
    '}',
    '',
  ].join('\n'),
  'packages/gamma/package.json': JSON.stringify({ name: 'gamma', type: 'module' }),
  'packages/gamma/src/index.ts': [
    'export async function run(): Promise<number> {',
    "  const passed = await import('alpha');",
    '  return count(passed);',
    '}',
    '',
    'function count(held: object): number {',
    '  return Object.keys(held).length;',
    '}',
    '',
  ].join('\n'),
};

let temporary: string;
let help: Help;

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'help-held-escaped-'));
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(temporary, path)), { recursive: true });
    await writeFile(join(temporary, path), text);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: temporary });
  execFileSync('git', ['add', '.'], { cwd: temporary });
  help = await readWorkspace(temporary, { index: join(temporary, 'source-index.bin'), save: false });
}, 60_000);

afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe('a module held whole that the reading cannot follow', () => {
  it('names a name read off its default as a read through `default`', () => {
    expect(uses.run(help, { name: 'narrow' })).toContain('packages/beta/src/index.ts:2 — beta (import() on line 2, through `default`)');
  });

  it('names a module passed on whole as a site of every name, whose reads are not recorded', () => {
    const answer = uses.run(help, { name: 'widen' });
    expect(answer).toContain(
      'imported in 1 place, 1 through import(), which loads the module when the call runs. 1 of them passes the module on whole, where this reading does not follow it, and may not read `widen` at all.',
    );
    expect(answer).toContain('packages/gamma/src/index.ts:3 — gamma (import() on line 2, passed on whole: what it reads is not recorded)');
    expect(uses.run(help, { name: 'narrow' })).toContain('packages/gamma/src/index.ts:3 — gamma (import() on line 2, passed on whole');
  });
});
