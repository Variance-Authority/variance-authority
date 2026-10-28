import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { readWorkspace } from './read.js';
import { uses } from './tools/uses.js';

/**
 * A name read off a module through an `import()` type — `import('alpha').x` or
 * `typeof import('alpha')` — is a type-only site, as `import type` would be,
 * from the reading of the workspace as from the index's: the module never loads.
 * A bare `typeof import('alpha')` names the module's type and reads no name.
 */

const FILES: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'held-as-type', private: true, workspaces: ['packages/*'] }),
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
  'packages/gamma/package.json': JSON.stringify({ name: 'gamma', type: 'module' }),
  'packages/gamma/src/index.ts': 'export function gauge(): number { return 3; }\n',
  'packages/beta/package.json': JSON.stringify({ name: 'beta', type: 'module' }),
  'packages/beta/src/index.ts': [
    "export type Narrowed = ReturnType<typeof import('alpha').narrow>;",
    "export type Alpha = typeof import('alpha');",
    "export type Gauge = typeof import('gamma/src/index.js').gauge;",
    '',
  ].join('\n'),
};

let temporary: string;
let help: Help;

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'help-held-as-type-'));
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
    `${use.at}:${use.line}${use.type ? ' type' : ''}${use.through === undefined ? '' : ` ${use.through.kind} ${use.through.line}`}`);
}

describe('a name read off a module through an `import()` type', () => {
  it('is a type-only site of the name it takes, and of no name when it names the module whole', () => {
    expect(sitesOf('narrow')).toEqual(['packages/beta/src/index.ts:1 type dynamic 1']);
    for (const name of ['narrow', 'widen']) {
      expect(uses.run(help, { name })).not.toContain('packages/beta/src/index.ts:2');
    }
  });

  it('is not counted among the import() uses that load the module', () => {
    const answer = uses.run(help, { name: 'narrow' });
    expect(answer).not.toContain('which loads the module when the call runs');
    expect(answer).toContain('packages/beta/src/index.ts:1 — beta (type only) (import() on line 1)');
  });

  it('is a type-only name taken by path from a package that declares no entry', () => {
    const held = help.byPath.find((imported) => imported.by === 'beta' && imported.specifier === 'gamma/src/index.js');
    expect(held?.names.map((taken) => `${taken.name}:${taken.line}${taken.type ? ' type' : ''} ${taken.through?.kind}`)).toEqual(['gauge:3 type dynamic']);
  });
});
