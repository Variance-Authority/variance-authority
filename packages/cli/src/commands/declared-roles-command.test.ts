import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW } from '../exit.js';

/** `variance restrictions` over the roles docs declare with `@testOnly` and `@production`, with no rule file written. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-roles-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const FIXTURE = '/**\n * Builds a fixture.\n * @testOnly\n */\nexport function makeFixture() {\n  return 1;\n}\n';

function checkout(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-roles-')));
  const all: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['lib'] }),
    'lib/package.json': JSON.stringify({ name: 'lib', exports: { '.': './src/index.ts', './testing': './src/testing.ts' } }),
    'lib/src/fixture.ts': FIXTURE,
    'lib/src/testing.ts': "export { makeFixture } from './fixture';\n",
    'lib/src/fixture.test.ts': "import { makeFixture } from './fixture';\nmakeFixture();\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance restrictions over declared roles', () => {
  it('passes a test-only name that tests and a shipped testing entry use', async () => {
    checkout({ 'lib/src/index.ts': 'export const run = () => 1;\n' });
    await run(['index']);

    expect(await run(['restrictions'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: 'No .relations.json is tracked in this checkout, so nothing is restricted.\n',
    });
  });

  it('passes a testing entry that star re-exports only test-only names, and names a mixed one and a user behind the star', async () => {
    checkout({
      'lib/src/index.ts': "import { makeFixture } from './testing';\nexport const run = () => makeFixture();\n",
      'lib/src/testing.ts': "export * from './fixture';\n",
      'lib/src/mixed.ts': "export * from './fixture';\nexport * from './index';\n",
    });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe([
      'lib/src/index.ts:1 ships makeFixture, declared @testOnly at lib/src/fixture.ts:5',
      'lib/src/mixed.ts:1 ships makeFixture, declared @testOnly at lib/src/fixture.ts:5',
      '2 declared roles contradicted. No .relations.json is tracked in this checkout, so nothing is restricted.',
      '',
    ].join('\n'));
  });

  it('passes a shipped file that uses a test-only name only as a type', async () => {
    checkout({
      'lib/src/index.ts': "import type { makeFixture } from './fixture';\nimport { type makeFixture as again } from './testing';\nexport type Made = ReturnType<typeof makeFixture> | ReturnType<typeof again>;\nexport const run = () => 1;\n",
    });
    await run(['index']);

    expect((await run(['restrictions'])).code).toBe(EXIT_CLEAN);
  });

  it('names a shipped file that runs a test-only name, directly or through a barrel, and where the name is declared', async () => {
    checkout({
      'lib/src/index.ts': "import { makeFixture } from './fixture';\nimport { viaBarrel } from './barrel-user';\nexport const run = () => makeFixture() + viaBarrel();\n",
      'lib/src/barrel-user.ts': "import { makeFixture } from './testing';\nexport const viaBarrel = makeFixture;\n",
    });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe([
      'lib/src/barrel-user.ts:1 ships makeFixture, declared @testOnly at lib/src/fixture.ts:5',
      'lib/src/index.ts:1 ships makeFixture, declared @testOnly at lib/src/fixture.ts:5',
      '2 declared roles contradicted. No .relations.json is tracked in this checkout, so nothing is restricted.',
      '',
    ].join('\n'));
  });

  it('follows a test-only name re-exported under a new name, and passes the file that only re-exports it', async () => {
    checkout({
      'lib/src/renamed.ts': "export { makeFixture as madeHere } from './fixture';\n",
      'lib/src/index.ts': "import { madeHere } from './renamed';\nexport const run = () => madeHere();\n",
    });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe([
      'lib/src/index.ts:1 ships madeHere, declared @testOnly at lib/src/fixture.ts:5',
      '1 declared role contradicted. No .relations.json is tracked in this checkout, so nothing is restricted.',
      '',
    ].join('\n'));
  });

  it('names a shipped file that re-exports test-only names under a namespace', async () => {
    checkout({ 'lib/src/index.ts': "export * as fixtures from './fixture';\nexport const run = () => 1;\n" });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out.split('\n')[0]).toBe('lib/src/index.ts:1 ships makeFixture, declared @testOnly at lib/src/fixture.ts:5');
  });

  it('names a production name only tests reach, and a doc that declares both roles', async () => {
    checkout({
      'lib/src/index.ts': "import { both } from './both';\nexport const run = () => both;\n",
      'lib/src/both.ts': '/** @testOnly @production */\nexport const both = 1;\n',
      'lib/src/kept.ts': 'const kept = 1;\n/** Kept for the next release. @production */\nexport { kept };\n',
      'lib/src/kept.test.ts': "import { kept } from './kept';\nkept;\n",
    });
    await run(['index']);

    const found = await run(['restrictions', '--format', 'json']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect((await run(['restrictions'])).out).toBe([
      'lib/src/both.ts:2 both is declared both @testOnly and @production',
      'lib/src/index.ts:1 ships both, declared @testOnly at lib/src/both.ts:2',
      'lib/src/kept.ts:3 kept is declared @production, but only tests reach it',
      '3 declared roles contradicted. No .relations.json is tracked in this checkout, so nothing is restricted.',
      '',
    ].join('\n'));
    expect(JSON.parse(found.out).roles).toEqual([
      { kind: 'contradiction', file: 'lib/src/both.ts', line: 2, name: 'both', declaredLine: 0 },
      { kind: 'test-only-shipped', file: 'lib/src/index.ts', line: 1, name: 'both', declared: 'lib/src/both.ts', declaredLine: 2 },
      { kind: 'production-unshipped', file: 'lib/src/kept.ts', line: 3, name: 'kept', declaredLine: 0 },
    ]);
  });

  it('refuses to check a declared role without a code map that says which files ship', async () => {
    const root = checkout({ 'lib/src/index.ts': 'export const run = () => 1;\n' });
    await run(['index']);
    rmSync(`${sourceIndexPath(root)}.shipped`);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_OPERATOR);
    expect(found.err).toContain('1 export declares a role, but no code map folded from the current source index says which files packages ship');
  });
});
