import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * A file's import is counted for the nearest manifest above it: a workspace inside another owns its own files,
 * and the top of the checkout owns what no workspace holds.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

it('counts an import for the nearest workspace above the file', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-owner-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-owner-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  for (const [path, value] of Object.entries({
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/app', 'packages/app/inner'] }),
    'tools/run.ts': "import 'kit';\n",
    'packages/app/package.json': JSON.stringify({ name: 'app' }),
    'packages/app/src/deep/page.ts': "import 'kit';\n",
    'packages/app/inner/package.json': JSON.stringify({ name: 'inner' }),
    'packages/app/inner/src/page.ts': "import 'kit';\n",
    'packages/application/src/page.ts': "import 'kit';\n",
    'node_modules/kit/package.json': JSON.stringify({ name: 'kit', version: '1.0.0', types: 'index.d.ts' }),
    'node_modules/kit/index.d.ts': 'export declare const kit: true;\n',
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  await updateSourceIndex(root);
  await refreshDependencyLexicon(root);
  const read = readDependencyLexicon(root).lexicon;
  expect(read?.availability.map((entry) => [entry.owner, entry.imports])).toEqual([
    ['package.json', 2], ['packages/app/inner/package.json', 1], ['packages/app/package.json', 1],
  ]);
});
