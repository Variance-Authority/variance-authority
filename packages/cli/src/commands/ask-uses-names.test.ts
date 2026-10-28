import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a name that is more than one declaration, a name
 * an installed package declares, and a Rust item. A name is how the asker
 * spells a declaration, so every declaration that carries it is named before
 * any is answered. A name declared outside the checkout is still imported in
 * it, and the imports are the answer. A Rust item JavaScript reaches through a
 * native binding is imported by no file, and the answer says that use is not
 * followed.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-names-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const TOOL = {
  'packages/pkg/package.json': JSON.stringify({
    name: '@acme/pkg',
    type: 'module',
    exports: { './help': { types: './dist/help.d.ts', default: './dist/help.js' } },
  }),
  'packages/pkg/tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
  'packages/pkg/src/help.ts': 'export function reachedFrom(key: string): string[] {\n  return [key];\n}\n',
  'packages/tool/package.json': JSON.stringify({ name: '@acme/tool', dependencies: { '@acme/pkg': '*', thirdp: '1.0.0' } }),
  'packages/tool/src/read.ts':
    "import { reachedFrom } from '@acme/pkg/help';\nimport { parseSync } from 'thirdp';\nexport const read = reachedFrom('b');\nexport const parsed = parseSync('x');\n",
  'packages/tool/src/tree.ts':
    'export interface Tree {\n  reachedFrom(seeds: string[]): Set<string>;\n}\nexport function walk(tree: Tree): Set<string> {\n  return tree.reachedFrom([]);\n}\n',
  'packages/tool/src/whole.test.ts': "import * as thirdp from 'thirdp';\nexport const probe = thirdp.parseSync('y');\n",
  'node_modules/thirdp/package.json': JSON.stringify({ name: 'thirdp', version: '1.0.0', types: 'index.d.ts', main: 'index.js' }),
  'node_modules/thirdp/index.d.ts': 'export declare function parseSync(text: string): unknown;\n',
  'node_modules/thirdp/index.js': 'exports.parseSync = (t) => t;\n',
};

describe('variance ask uses over what a name names', () => {
  it('names every declaration that carries the name before it answers any', async () => {
    checkout(TOOL);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'reachedFrom']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n').slice(0, 3)).toEqual([
      '`reachedFrom` names 2 declarations, each answered below:',
      '  function, published, at packages/pkg/src/help.ts:1',
      '  member of `Tree` at packages/tool/src/tree.ts:2',
    ]);
    // The export is answered by its imports, the member after it by its declarations.
    expect(out).toMatch(/^packages\/tool\/src\/read\.ts:1 — @acme\/tool; used on line 3$/m);
    expect(out.indexOf('packages/tool/src/read.ts:1')).toBeLessThan(out.indexOf('is a member too'));
  }, 120_000);

  it('names a declaration the file keeps unexported among the ones it answers', async () => {
    checkout({
      ...TOOL,
      'packages/tool/src/local.ts': 'function reachedFrom(): string[] {\n  return [];\n}\nexport const local = reachedFrom();\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'reachedFrom']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n').slice(0, 4)).toEqual([
      '`reachedFrom` names 3 declarations, each answered below:',
      '  function, published, at packages/pkg/src/help.ts:1',
      '  function, declared, not exported, at packages/tool/src/local.ts:1',
      '  member of `Tree` at packages/tool/src/tree.ts:2',
    ]);
  }, 120_000);

  it('answers a name an installed package declares with the imports of it', async () => {
    checkout(TOOL);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`parseSync` is declared in no file of this workspace; it is imported from outside it in 2 places, out of thirdp.');
    expect(out).toMatch(/^packages\/tool\/src\/read\.ts:2 — @acme\/tool, from thirdp; used on line 4$/m);
    expect(out).toMatch(/^packages\/tool\/src\/whole\.test\.ts:2 — @acme\/tool, from thirdp \(namespace, line 1\)$/m);
    expect(out).toContain('`variance ask symbol` has its declaration in each package.');
  }, 120_000);

  it('says a Rust item is not followed across a native binding', async () => {
    checkout({
      'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
      'packages/kit/src/lib.rs': 'pub struct NameUse {\n    pub key: String,\n}\n\npub fn make() -> NameUse {\n    NameUse { key: String::new() }\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'NameUse']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(
      "A use from JavaScript through a native binding (napi, wasm-bindgen) imports no Rust name, and which name a binding gives a Rust item is not read, so those uses are not listed; ask for the name the binding's JavaScript side declares.",
    );
  }, 120_000);
});
