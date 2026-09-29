import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * A refresh that finds the source index's chain and every installed file it read where the last one left
 * them reads nothing and writes nothing. Each thing the lexicon is a function of, moved alone, defeats it:
 * a source that imports something new, an installed file, and a package installed where none resolved.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

function put(root: string, files: Record<string, string>): void {
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
}

const kit = (name: string, body: string): Record<string, string> => ({
  [`packages/app/node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', types: 'index.d.ts' }),
  [`packages/app/node_modules/${name}/index.d.ts`]: body,
});

it('does nothing when nothing moved, and something exactly when one of its inputs did', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-unchanged-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-unchanged-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  put(root, {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/app/package.json': JSON.stringify({ name: 'app', dependencies: { alpha: '1.0.0', beta: '1.0.0' } }),
    'packages/app/src/x.ts': "import { one } from 'alpha';\none();\n",
    ...kit('alpha', 'export declare function one(): void;\n'),
  });
  await updateSourceIndex(root);

  const first = refreshDependencyLexicon(root);
  expect(first.unchanged).toBe(false);
  const { path } = readDependencyLexicon(root);
  const written = statSync(path).mtimeMs;

  const second = refreshDependencyLexicon(root);
  expect(second).toMatchObject({ unchanged: true, entrypoints: first.entrypoints, unavailable: first.unavailable, packages: first.packages });
  expect(statSync(path).mtimeMs).toBe(written);

  // A record outliving the lexicon it described is not a reason to skip writing it again.
  rmSync(path);
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  expect(refreshDependencyLexicon(root).unchanged).toBe(true);

  put(root, { 'packages/app/src/y.ts': "import { one } from 'alpha';\none();\n" });
  await updateSourceIndex(root);
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  expect(refreshDependencyLexicon(root).unchanged).toBe(true);

  const index = join(root, 'packages/app/node_modules/alpha/index.d.ts');
  writeFileSync(index, 'export declare function one(): void;\nexport declare function two(): void;\n');
  utimesSync(index, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  expect(refreshDependencyLexicon(root).unchanged).toBe(true);

  // `beta` is declared and was never installed; installing it adds a directory, not a file the lexicon read.
  put(root, kit('beta', 'export declare function bee(): void;\n'));
  const installed = refreshDependencyLexicon(root);
  expect(installed.unchanged).toBe(false);
  expect(installed.unavailable).toBeLessThan(first.unavailable);
  expect(refreshDependencyLexicon(root).unchanged).toBe(true);
});
