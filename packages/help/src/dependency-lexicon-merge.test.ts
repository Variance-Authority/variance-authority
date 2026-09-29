import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * A refresh that merges what the index gained is the refresh from nothing, whatever moved: a file written,
 * a file deleted, an installed package that changed version, a manifest that gained a dependency. Each step
 * is refreshed twice over the same inputs, once through the record and once with the record removed.
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

const kit = (name: string, version: string, body: string): Record<string, string> => ({
  [`packages/app/node_modules/${name}/package.json`]: JSON.stringify({ name, version, types: 'index.d.ts' }),
  [`packages/app/node_modules/${name}/index.d.ts`]: body,
});

const unstamped = (text: string): string => text.replace(/"refreshedAt":"[^"]*"/, '');

it('merges each kind of change into the lexicon a refresh from nothing gives', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-merge-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-merge-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const manifest = (dependencies: Record<string, string>): string => JSON.stringify({ name: 'app', dependencies });
  put(root, {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/app/package.json': manifest({ alpha: '1.0.0', beta: '1.0.0' }),
    'packages/app/src/x.ts': "import { one } from 'alpha';\none();\n",
    'packages/app/src/y.ts': "import { bee } from 'beta';\nbee();\n",
    ...kit('alpha', '1.0.0', 'export declare function one(): void;\n'),
    ...kit('beta', '1.0.0', 'export declare function bee(): void;\n'),
  });
  await updateSourceIndex(root);
  refreshDependencyLexicon(root);
  const { path } = readDependencyLexicon(root);
  const built = path.replace(/\.json$/, '.built.json');

  const agrees = (label: string): void => {
    const merged = unstamped(readFileSync(path, 'utf8'));
    rmSync(built);
    refreshDependencyLexicon(root);
    expect(merged, label).toBe(unstamped(readFileSync(path, 'utf8')));
  };

  put(root, { 'packages/app/src/z.ts': "import { one } from 'alpha';\nimport 'beta';\n" });
  await updateSourceIndex(root);
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  agrees('a file written');

  execFileSync('git', ['rm', '-q', '-f', 'packages/app/src/y.ts'], { cwd: root });
  await updateSourceIndex(root);
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  agrees('a file deleted');

  put(root, kit('alpha', '2.0.0', 'export declare function one(): void;\nexport declare function three(): void;\n'));
  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, 'packages/app/node_modules/alpha/package.json'), later, later);
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  agrees('an installed version changed');

  put(root, { 'packages/app/package.json': manifest({ alpha: '2.0.0' }) });
  await updateSourceIndex(root);
  expect(refreshDependencyLexicon(root).unchanged).toBe(false);
  agrees('a manifest changed');
});
