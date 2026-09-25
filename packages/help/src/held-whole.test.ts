import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { readWorkspace } from './read.js';
import { uses } from './tools/uses.js';

/**
 * A name read off a module the file holds whole — `import()` or `import * as` —
 * is a site, and says which request loaded it.
 *
 * The reported case: `ask uses` said nothing in the workspace imported
 * `narrowByJourneys`, which `select-command.ts` reads as `selection.narrowByJourneys`
 * after `const selection = await import(…)`. No import statement names it, so
 * the statement's bindings could not say it was used.
 */

const FILES: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'held-whole', private: true, workspaces: ['packages/*'] }),
  'packages/alpha/package.json': JSON.stringify({
    name: 'alpha',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  }),
  'packages/alpha/tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
  'packages/alpha/src/index.ts': [
    'export function narrow(): number { return 1; }',
    'export function widen(): number { return 2; }',
    'export function later(): number { return 3; }',
    'export function picked(): number { return 4; }',
    'export function spaced(): number { return 5; }',
    'export function unused(): number { return 6; }',
    '',
  ].join('\n'),
  'packages/beta/package.json': JSON.stringify({ name: 'beta', type: 'module' }),
  'packages/beta/src/index.ts': [
    "import * as alpha from 'alpha';",
    '',
    'export async function run(): Promise<number> {',
    "  const loaded = await import('alpha');",
    "  const { picked } = await import('alpha');",
    "  const later = await import('alpha').then((held) => held.later());",
    '  return loaded.narrow() + (await import(\'alpha\')).widen() + picked() + later + alpha.spaced();',
    '}',
    '',
  ].join('\n'),
};

let temporary: string;
let help: Help;

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'help-held-whole-'));
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

function sitesOf(name: string): readonly string[] {
  const entry = help.packages
    .flatMap((published) => published.openings)
    .flatMap((opening) => opening.entries)
    .find((held) => held.name === name);
  return (entry?.sites ?? []).map((use) =>
    `${use.at}:${use.line}${use.through === undefined ? '' : ` ${use.through.kind} ${use.through.line}`}`);
}

describe('a name read off a module held whole', () => {
  it('is a site of every spelling that reads it', () => {
    expect(sitesOf('narrow')).toEqual(['packages/beta/src/index.ts:7 dynamic 4']);
    expect(sitesOf('widen')).toEqual(['packages/beta/src/index.ts:7 dynamic 7']);
    expect(sitesOf('picked')).toEqual(['packages/beta/src/index.ts:5 dynamic 5']);
    expect(sitesOf('later')).toEqual(['packages/beta/src/index.ts:6 dynamic 6']);
    expect(sitesOf('spaced')).toEqual(['packages/beta/src/index.ts:7 namespace 1']);
    expect(sitesOf('unused')).toEqual([]);
  });

  it('says in the answer that an import() loads the module when the call runs', () => {
    const answer = uses.run(help, { name: 'narrow' });
    expect(answer).toContain('read off import(), which loads the module when that call runs');
    expect(answer).toContain(
      'packages/beta/src/index.ts:7 — beta (through import() on line 4, loaded when that call runs)');
    expect(uses.run(help, { name: 'spaced' })).toContain('(through the namespace imported on line 1)');
  });
});
