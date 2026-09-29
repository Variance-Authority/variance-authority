import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { refreshDependencyLexicon } from '../dependency-lexicon.js';
import { searchNames } from '../tools.js';
import { searchIndexOf } from './search.js';

/**
 * A dependency is usable where the manifest owning the location declares it.
 * `beta` imports `alpha`, so `alpha` is in `beta`'s closure, and what `alpha`
 * declares is still not something `beta` may import: asking from `beta` must not
 * offer it, while asking from `alpha` does.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

it('offers a name only from the workspace whose manifest declares it, not from one that merely reaches it', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-owner-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-owner-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/alpha/package.json': JSON.stringify({ name: 'alpha', dependencies: { 'alpha-kit': '1.0.0' } }),
    'packages/alpha/src/index.ts': 'export const alpha = 1;\n',
    'packages/beta/package.json': JSON.stringify({ name: 'beta', dependencies: { 'beta-kit': '1.0.0' } }),
    'packages/beta/src/index.ts': "import { alpha } from '../../alpha/src/index.js';\nexport const beta = alpha;\n",
    'node_modules/alpha-kit/package.json': JSON.stringify({ name: 'alpha-kit', version: '1.0.0', types: 'index.d.ts' }),
    'node_modules/alpha-kit/index.d.ts': 'export declare const alphaOnlyName: true;\n',
    'node_modules/beta-kit/package.json': JSON.stringify({ name: 'beta-kit', version: '1.0.0', types: 'index.d.ts' }),
    'node_modules/beta-kit/index.d.ts': 'export declare const betaOwnName: true;\n',
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  refreshDependencyLexicon(root);

  const tree = treeOf([reads('packages/alpha/src/index.ts'), reads('packages/beta/src/index.ts', 'packages/alpha/src/index.ts')], root);
  const index = searchIndexOf(readHelp(root));
  const total = (query: string, from: string): number | undefined => searchNames(index, { query, from }, tree, root).thirdParty?.total;
  expect(total('alphaOnlyName', 'packages/beta/src/index.ts')).toBe(0);
  expect(total('betaOwnName', 'packages/beta/src/index.ts')).toBe(1);
  expect(total('alphaOnlyName', 'packages/alpha/src/index.ts')).toBe(1);
});
