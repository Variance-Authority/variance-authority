import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { readDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * A refresh that merges what the index gained is the refresh from nothing, whatever moved: a file written,
 * a file deleted, an installed package that changed version, a manifest that gained a dependency. Each step
 * is refreshed twice over the same inputs, once through the record and once with the record removed.
 *
 * Each step after the first since the index was readied rewrites the index's working layer, where the first
 * appends it, so the record is merged into for both: a refresh that reads everything again on every edit
 * after the first is the whole lexicon's cost each time an agent saves a file. A file written back to bytes the
 * index's base holds has its parse there, and an index can be replaced by one over the same base with another
 * working layer, as a worktree seeded from another checkout's index is.
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
  await refreshDependencyLexicon(root);
  const { path } = readDependencyLexicon(root);
  const built = path.replace(/\.json$/, '.built.json');

  const merges = async (label: string): Promise<void> => {
    const refreshed = await refreshDependencyLexicon(root);
    expect(refreshed.unchanged, label).toBe(false);
    expect(refreshed.merged, label).toBe(true);
  };
  const agrees = async (label: string): Promise<void> => {
    const merged = unstamped(readFileSync(path, 'utf8'));
    rmSync(built);
    await refreshDependencyLexicon(root);
    expect(merged, label).toBe(unstamped(readFileSync(path, 'utf8')));
  };

  put(root, { 'packages/app/src/z.ts': "import { one } from 'alpha';\nimport 'beta';\n" });
  await updateSourceIndex(root);
  await merges('a file written');
  await agrees('a file written');

  put(root, { 'packages/app/src/z.ts': "import { one } from 'alpha';\n" });
  await updateSourceIndex(root);
  await merges('the file written again');
  await agrees('the file written again');

  // `agrees` leaves a record a refresh from nothing wrote; this merges over one a merge wrote.
  put(root, { 'packages/app/src/z.ts': "import 'beta';\n" });
  await updateSourceIndex(root);
  await merges('a file written over the record a merge wrote');
  put(root, { 'packages/app/src/v.ts': "import { one } from 'alpha';\n" });
  await updateSourceIndex(root);
  await merges('another file written over the record a merge wrote');
  await agrees('two merges in a row');

  put(root, { 'packages/app/src/x.ts': "import { one } from 'alpha';\nimport { bee } from 'beta';\none(); bee();\n" });
  await updateSourceIndex(root);
  await merges('a file the base holds written');
  await agrees('a file the base holds written');

  put(root, { 'packages/app/src/x.ts': "import { one } from 'alpha';\none();\n" });
  await updateSourceIndex(root);
  await merges('the file written back to the bytes the base holds');
  await agrees('the file written back to the bytes the base holds');

  const index = sourceIndexPath(root);
  const held = mkdtempSync(join(tmpdir(), 'va-merge-held-'));
  cpSync(index, join(held, 'index'));
  cpSync(`${index}.segments`, join(held, 'segments'), { recursive: true });
  put(root, { 'packages/app/src/w.ts': "import { bee } from 'beta';\n" });
  await updateSourceIndex(root);
  await merges('a file written over the held index');
  await agrees('a file written over the held index');
  // The held index has the same base and a working layer that never wrote `w.ts`.
  rmSync(`${index}.segments`, { recursive: true });
  cpSync(join(held, 'segments'), `${index}.segments`, { recursive: true });
  cpSync(join(held, 'index'), index);
  await merges('an index over the same base with another working layer');
  await agrees('an index over the same base with another working layer');
  await updateSourceIndex(root);

  execFileSync('git', ['rm', '-q', '-f', 'packages/app/src/y.ts'], { cwd: root });
  await updateSourceIndex(root);
  await merges('a file deleted');
  await agrees('a file deleted');

  put(root, kit('alpha', '2.0.0', 'export declare function one(): void;\nexport declare function three(): void;\n'));
  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, 'packages/app/node_modules/alpha/package.json'), later, later);
  expect((await refreshDependencyLexicon(root)).unchanged).toBe(false);
  await agrees('an installed version changed');

  put(root, { 'packages/app/package.json': manifest({ alpha: '2.0.0' }) });
  await updateSourceIndex(root);
  expect((await refreshDependencyLexicon(root)).unchanged).toBe(false);
  await agrees('a manifest changed');
});
