import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { dependencyStack, queryDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * A refresh that appends what the index gained answers as the refresh from nothing does, whatever moved: a
 * file written, a file deleted, an installed package that changed version, a manifest that gained a
 * dependency. Each step is answered twice over the same inputs, once from what the refreshes so far wrote and
 * once with both lexicon files removed.
 *
 * A source edit that asks for nothing the catalogue does not hold leaves the catalogue's bytes as they were
 * and appends the edited files' rows to the sites file: a refresh that rewrites either whole is the whole
 * lexicon's cost each time an agent saves a file. A file written back to bytes the index's base holds has its
 * parse there, and an index can be replaced by one over the same base with another working layer, as a
 * worktree seeded from another checkout's index is.
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

it('appends each kind of change and answers as a refresh from nothing does', async () => {
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
  const { path, sites } = await refreshDependencyLexicon(root);

  const answers = () => JSON.stringify([
    queryDependencyLexicon(root, '', undefined, false, undefined, 100),
    queryDependencyLexicon(root, 'one', ['packages/app/src/x.ts'], true),
    dependencyStack(root, ['packages/app/src/x.ts'], 0, 100),
  ]);
  const appends = async (label: string): Promise<void> => {
    const catalogue = readFileSync(path);
    const held = readFileSync(sites);
    const refreshed = await refreshDependencyLexicon(root);
    expect(refreshed.unchanged, label).toBe(false);
    expect(refreshed.appended, label).toBeGreaterThan(0);
    expect(readFileSync(path).equals(catalogue), label).toBe(true);
    if (!refreshed.rebuilt) expect(readFileSync(sites).subarray(0, held.length).equals(held), label).toBe(true);
  };
  const agrees = async (label: string): Promise<void> => {
    const appended = answers();
    rmSync(path);
    rmSync(sites);
    await refreshDependencyLexicon(root);
    expect(answers(), label).toBe(appended);
  };

  put(root, { 'packages/app/src/z.ts': "import { one } from 'alpha';\nimport 'beta';\n" });
  await updateSourceIndex(root);
  await appends('a file written');
  await agrees('a file written');

  put(root, { 'packages/app/src/z.ts': "import { one } from 'alpha';\n" });
  await updateSourceIndex(root);
  await appends('the file written again');
  await agrees('the file written again');

  // `agrees` leaves files a refresh from nothing wrote; this appends over ones an append wrote.
  put(root, { 'packages/app/src/z.ts': "import 'beta';\n" });
  await updateSourceIndex(root);
  await appends('a file written over what an append wrote');
  put(root, { 'packages/app/src/v.ts': "import { one } from 'alpha';\n" });
  await updateSourceIndex(root);
  await appends('another file written over what an append wrote');
  await agrees('two appends in a row');

  put(root, { 'packages/app/src/x.ts': "import { one } from 'alpha';\nimport { bee } from 'beta';\none(); bee();\n" });
  await updateSourceIndex(root);
  await appends('a file the base holds written');
  await agrees('a file the base holds written');

  put(root, { 'packages/app/src/x.ts': "import { one } from 'alpha';\none();\n" });
  await updateSourceIndex(root);
  await appends('the file written back to the bytes the base holds');
  await agrees('the file written back to the bytes the base holds');

  const index = sourceIndexPath(root);
  const held = mkdtempSync(join(tmpdir(), 'va-merge-held-'));
  cpSync(index, join(held, 'index'));
  cpSync(`${index}.segments`, join(held, 'segments'), { recursive: true });
  put(root, { 'packages/app/src/w.ts': "import { bee } from 'beta';\n" });
  await updateSourceIndex(root);
  await appends('a file written over the held index');
  await agrees('a file written over the held index');
  // The held index has the same base and a working layer that never wrote `w.ts`.
  rmSync(`${index}.segments`, { recursive: true });
  cpSync(join(held, 'segments'), `${index}.segments`, { recursive: true });
  cpSync(join(held, 'index'), index);
  await appends('an index over the same base with another working layer');
  await agrees('an index over the same base with another working layer');
  await updateSourceIndex(root);

  execFileSync('git', ['rm', '-q', '-f', 'packages/app/src/y.ts'], { cwd: root });
  await updateSourceIndex(root);
  await appends('a file deleted');
  await agrees('a file deleted');

  put(root, kit('alpha', '2.0.0', 'export declare function one(): void;\nexport declare function three(): void;\n'));
  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, 'packages/app/node_modules/alpha/package.json'), later, later);
  // The version change recomputes `alpha` alone: `beta`, under the same manifest, is reused.
  expect(await refreshDependencyLexicon(root)).toMatchObject({ unchanged: false, reused: 1 });
  await agrees('an installed version changed');

  put(root, { 'packages/app/package.json': manifest({ alpha: '2.0.0' }) });
  await updateSourceIndex(root);
  expect((await refreshDependencyLexicon(root)).unchanged).toBe(false);
  await agrees('a manifest changed');

  // A specifier the catalogue never offered is read, and written into the catalogue.
  put(root, { 'packages/app/src/u.ts': "import 'alpha/extra';\n", 'packages/app/node_modules/alpha/extra.d.ts': 'export declare const extra: 1;\n' });
  await updateSourceIndex(root);
  expect((await refreshDependencyLexicon(root)).unchanged).toBe(false);
  expect(queryDependencyLexicon(root, 'extra', undefined, true)?.shown).toMatchObject([{ specifier: 'alpha/extra', imports: 1 }]);
  await agrees('a specifier imported for the first time');
});
