import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { refreshDependencyLexicon } from '../dependency-lexicon.js';
import { symbol } from './symbol.js';

/**
 * `symbol` over a name an import binds with `as`, where the original is an
 * installed declaration, or a file of the checkout that `files` gives to
 * `intersection`, and where the renaming is a re-export, which publishes the
 * name rather than binding it, also beside an import that binds the same name.
 * An original a file only passes on is followed to its declaration.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-renamed-cache-'));
});
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-symbol-renamed-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/beta/package.json': JSON.stringify({ name: 'beta', dependencies: { 'shared-kit': '2.0.0' } }),
    'packages/beta/node_modules/shared-kit/package.json': JSON.stringify({ name: 'shared-kit', version: '2.0.0', types: 'index.d.ts' }),
    'packages/beta/node_modules/shared-kit/index.d.ts': 'export declare function sharedName(a: string, b: number): void;\n',
    'packages/beta/src/x.ts': "import { sharedName as share } from 'shared-kit';\nshare('a', 1);\n",
    'packages/beta/src/inner.ts': 'export const inner = (text: string): string => text;\n',
    'packages/beta/src/both.ts': "import { inner as loud, inner as quiet } from './inner.js';\nexport const both = [loud, quiet];\n",
    'packages/beta/src/relay.ts': "export { inner as relayed } from './inner.js';\n",
    'packages/beta/src/echo.ts': "import { relayed as echo } from './relay.js';\nexport const echoed = echo('x');\n",
    'packages/beta/src/kinds.ts': 'export type Kind = string;\n',
    'packages/beta/src/kind-relay.ts': "export type { Kind as Sort } from './kinds.js';\n",
    'packages/beta/src/kind-own.ts':
      "import type { Kind as Ilk } from './kinds.js';\nexport type { Kind as Ilk } from './kinds.js';\nexport type Own = Ilk;\n",
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  await refreshDependencyLexicon(root);
  return root;
}

it('answers a local name of an installed declaration with the import and that declaration', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'share' }, { root });
  expect(out).toContain("`share` is a local name: packages/beta/src/x.ts:1 imports `sharedName` as `share` from 'shared-kit'.");
  expect(out).toContain('shared-kit@2.0.0');
  expect(out).toContain('b: number');
});

it('gives `files` the import that binds a local name and the line that declares its original', async () => {
  const root = await workspace();
  const { files } = symbol.files!(readHelp(root), { name: 'loud' }, { root });
  expect(Object.fromEntries(files)).toEqual({ 'packages/beta/src/both.ts': [1], 'packages/beta/src/inner.ts': [1] });
});

it('names each local name one line binds the original to', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'inner' }, { root });
  expect(out).toContain('packages/beta/src/both.ts:1 as `loud`, packages/beta/src/both.ts:1 as `quiet`');
});

it('answers no local name for a name a re-export renames, which the file publishes', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'relayed' }, { root });
  expect(out).not.toContain('is a local name');
  expect(out).toContain('packages/beta/src/relay.ts');
});

it('answers no local name for a name a type-only re-export renames, whose request reads like an `import type`', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'Sort' }, { root });
  expect(out).not.toContain('is a local name');
  expect(out).toContain('packages/beta/src/kind-relay.ts');
});

it('answers the local name an `import type` binds beside a type-only re-export of the same name from the same file', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'Ilk' }, { root });
  expect(out).toContain("`Ilk` is a local name: packages/beta/src/kind-own.ts:1 imports `Kind` as `Ilk` from './kinds.js' (type only).");
});

it('follows the original of a local name that a file only passes on to its declaration, in the answer and in `files`', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'echo' }, { root });
  expect(out).toContain("`echo` is a local name: packages/beta/src/echo.ts:1 imports `relayed` as `echo` from './relay.js'.");
  expect(out).toContain(
    [
      'exported, without being published, at packages/beta/src/relay.ts:1 by beta',
      'It passes on `inner`, declared at packages/beta/src/inner.ts:1:',
      'const inner = (text: string): string =>',
    ].join('\n'),
  );
  expect(out).not.toContain('export const inner');
  const { files } = symbol.files!(readHelp(root), { name: 'echo' }, { root });
  expect(Object.fromEntries(files)).toEqual({ 'packages/beta/src/echo.ts': [1], 'packages/beta/src/inner.ts': [1], 'packages/beta/src/relay.ts': [1] });
});
