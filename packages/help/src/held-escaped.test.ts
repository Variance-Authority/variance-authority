import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { readWorkspace } from './read.js';
import { symbol } from './tools/symbol.js';
import { uses } from './tools/uses.js';

/**
 * A module held whole that leaves the file's sight — passed to a call the file
 * does not declare, here `Object.keys` inside the function it was handed to —
 * is a read the source index cannot follow, and a name read off its `default` is a
 * read through `default`. Neither stays silent: the answer names the site and
 * says what the reading could not see. Neither is a use of a name, and no count
 * holds it: `default` holds the name only when the module is CommonJS, and a
 * module passed on whole may read any name of it. Each is listed as a site that
 * may read the name, and a name with nothing else is unknown, not unused.
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
  it('names a name read off its default as a read through `default` that may read it', () => {
    expect(uses.run(help, { name: 'narrow' })).toContain('packages/beta/src/index.ts:2 — beta (import() on line 2, through `default`: may read it)');
  });

  it('keeps a module passed on whole out of every count, once for its module', () => {
    const [opening] = help.packages.find((published) => published.name === 'alpha')?.openings ?? [];
    expect(opening?.whole.map((use) => `${use.at}:${use.line}`)).toEqual(['packages/gamma/src/index.ts:7']);
    const widen = opening?.entries.find((entry) => entry.name === 'widen');
    expect(widen).toMatchObject({ usedBy: [], uses: 0, sites: [], throughDefault: [] });
  });

  it('keeps a read through `default` out of every count, as an uncertain fact of the name', () => {
    const entries = help.packages.find((published) => published.name === 'alpha')?.openings.flatMap((opening) => opening.entries) ?? [];
    const narrow = entries.find((entry) => entry.name === 'narrow');
    expect(narrow).toMatchObject({ usedBy: [], uses: 0, sites: [] });
    expect(narrow?.throughDefault.map((use) => `${use.at}:${use.line}`)).toEqual(['packages/beta/src/index.ts:2']);
  });

  it('says the catalogue entry of a name it may read is unknown, not unused', () => {
    expect(symbol.run(help, { name: 'widen' })).toContain(
      'no other package imports it by name through its published path; it may be read in 1 place: 1 passing the module on whole, so whether it is used is unknown',
    );
    expect(symbol.run(help, { name: 'narrow' })).toContain(
      "no other package imports it by name through its published path; it may be read in 2 places: 1 off the module's `default`, 1 passing the module on whole, so whether it is used is unknown",
    );
  });

  it('counts no place that may read a name as a place that imports it, and leaves their count to the header', () => {
    expect(symbol.run(help, { name: 'widen' })).toContain(
      '`docs_uses` names no place that imports this, and lists the ones that may read it.',
    );
    expect(symbol.run(help, { name: 'narrow' })).toContain(
      '`docs_uses` names no place that imports this, and lists the ones that may read it.',
    );
  });

  it('lists a module passed on whole as a site that may read the name', () => {
    const widen = uses.run(help, { name: 'widen' });
    expect(widen).toContain('is imported by name nowhere. 1 place passes the module on whole, where this reading does not follow it, and may read `widen`.');
    expect(widen).toContain('packages/gamma/src/index.ts:7 — gamma (import() on line 2, passed on whole: may read it)');
    const narrow = uses.run(help, { name: 'narrow' });
    expect(narrow).toContain(
      "is imported by name nowhere. 1 place reads it off the module's `default`, which holds `narrow` only when the module is CommonJS. 1 more passes the module on whole, where this reading does not follow it, and may read `narrow`.",
    );
    expect(narrow).toContain('packages/gamma/src/index.ts:7 — gamma (import() on line 2, passed on whole: may read it)');
  });
});
