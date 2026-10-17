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
 * says what the reading could not see. A module passed on whole is no use of a
 * name, and no count holds it; it is listed as a site that may read one.
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

  it('keeps a module passed on whole out of every count, as an uncertain fact of its own', () => {
    const entries = help.packages.find((published) => published.name === 'alpha')?.openings.flatMap((opening) => opening.entries) ?? [];
    const widen = entries.find((entry) => entry.name === 'widen');
    expect(widen).toMatchObject({ usedBy: [], uses: 0, sites: [] });
    expect(widen?.escapes.map((use) => `${use.at}:${use.line}`)).toEqual(['packages/gamma/src/index.ts:3']);
    const narrow = entries.find((entry) => entry.name === 'narrow');
    expect(narrow).toMatchObject({ usedBy: ['beta'], uses: 1 });
    expect(narrow?.sites.map((use) => `${use.at}:${use.line}`)).toEqual(['packages/beta/src/index.ts:2']);
  });

  it('lists a module passed on whole as a site that may read the name', () => {
    const widen = uses.run(help, { name: 'widen' });
    expect(widen).toContain('is imported by name nowhere. 1 place passes the module on whole, where this reading does not follow it, and may read `widen`.');
    expect(widen).toContain('packages/gamma/src/index.ts:3 — gamma (import() on line 2, passed on whole: may read it)');
    const narrow = uses.run(help, { name: 'narrow' });
    expect(narrow).toContain(
      'imported in 1 place, 1 through import(), which loads the module when the call runs. 1 more passes the module on whole, where this reading does not follow it, and may read `narrow`.',
    );
    expect(narrow).toContain('packages/gamma/src/index.ts:3 — gamma (import() on line 2, passed on whole: may read it)');
  });
});
