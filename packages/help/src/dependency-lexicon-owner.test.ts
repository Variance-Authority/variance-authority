import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { dependencyStack, refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * A file's import is counted for the nearest manifest above it: a workspace inside another owns its own files,
 * and the top of the checkout owns what no workspace holds. The owner is found when a question reads the rows,
 * so a manifest that moves ownership rewrites no file's row.
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
  execFileSync('git', ['add', '.'], { cwd: root });
}

const imports = (root: string, file: string) => dependencyStack(root, [file], 0, 10)?.rows.map((row) => [row.manifest, row.imports]);

it('counts an import for the nearest workspace above the file', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-owner-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-owner-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  put(root, {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/app', 'packages/app/inner', 'packages/app/nameless'] }),
    'tools/run.ts': "import 'kit';\n",
    'packages/app/package.json': JSON.stringify({ name: 'app' }),
    'packages/app/src/deep/page.ts': "import 'kit';\n",
    'packages/app/inner/package.json': JSON.stringify({ name: 'inner' }),
    'packages/app/inner/src/page.ts': "import 'kit';\n",
    'packages/app/nameless/src/page.ts': "import 'kit';\n",
    'packages/application/src/page.ts': "import 'kit';\n",
    'node_modules/kit/package.json': JSON.stringify({ name: 'kit', version: '1.0.0', types: 'index.d.ts' }),
    'node_modules/kit/index.d.ts': 'export declare const kit: true;\n',
  });
  await updateSourceIndex(root);
  const { sites } = await refreshDependencyLexicon(root);
  expect(imports(root, 'tools/run.ts')).toEqual([['package.json', 2]]);
  expect(imports(root, 'packages/app/inner/src/page.ts')).toEqual([['packages/app/inner/package.json', 1]]);
  expect(imports(root, 'packages/app/src/deep/page.ts')).toEqual([['packages/app/package.json', 2]]);

  // A manifest with no name is a workspace all the same, and takes its directory's imports from `app`.
  const held = readFileSync(sites);
  put(root, { 'packages/app/nameless/package.json': JSON.stringify({ private: true }) });
  await updateSourceIndex(root);
  expect(await refreshDependencyLexicon(root)).toMatchObject({ unchanged: false, rebuilt: false });
  expect(readFileSync(sites).subarray(0, held.length).equals(held)).toBe(true);
  expect(imports(root, 'packages/app/nameless/src/page.ts')).toEqual([['packages/app/nameless/package.json', 1]]);
  expect(imports(root, 'packages/app/src/deep/page.ts')).toEqual([['packages/app/package.json', 1]]);
});
