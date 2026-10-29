import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` and `ask symbol` over the imports of a name within its
 * own package. The Help value records the imports that cross a package, so
 * these are read off the source index: each import that resolved to the file
 * declaring the name, or to a file that passes it on with `export … from`,
 * which is followed under the name it passes and is not itself a use.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-within-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const UNCOUNTED_LINE = 'A namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted.';

describe('variance ask over the imports of a name within its own package', () => {
  it('answers `uses` for a published name with the imports within its own package as well as across one', async () => {
    // One of several names a list takes. A re-export passes the name on and is
    // no use; an import of what it passes on is, under the name it passes. A
    // file that re-exports the name and imports it too is listed for the
    // import, and a same-named export of another file is another name.
    checkout({
      'packages/lib/src/greet.ts': "export const hello = 'hello';\nexport function greet(name: string): string {\n  return name;\n}\n",
      'packages/lib/src/greeting.ts': "import { hello, greet } from './greet.js';\nexport const greeting = greet(hello);\n",
      'packages/lib/src/both.ts': "export { greet } from './greet.js';\nimport { greet } from './greet.js';\nexport const both = greet('both');\n",
      'packages/lib/src/barrelled.ts': "import { greet } from './index.js';\nexport const barrelled = greet('barrel');\n",
      'packages/lib/src/alias.ts': "export { greet as salute } from './greet.js';\n",
      'packages/lib/src/saluted.ts': "import { salute } from './alias.js';\nexport const saluted = salute('alias');\n",
      'packages/lib/src/other.ts': 'export const greet = 1;\n',
      'packages/lib/src/unrelated.ts': "import { greet } from './other.js';\nexport const unrelated = greet;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    // `other.ts` declares another `greet`, so the headline names the declaration it counts.
    expect(out).toContain('`greet` [function] is imported in 5 places: 1 from another package and 4 inside @acme/lib, published by @acme/lib, declared at packages/lib/src/greet.ts:2.');
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).toMatch(/^packages\/lib\/src\/greeting\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(out).toMatch(/^packages\/lib\/src\/both\.ts:2 — @acme\/lib; used on line 3$/m);
    expect(out).toMatch(/^packages\/lib\/src\/barrelled\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(out).toMatch(/^packages\/lib\/src\/saluted\.ts:1 — @acme\/lib \(as salute\); used on line 2$/m);
    // The same-named export of another file is answered apart, with its own import.
    const [own, namesake] = out.split('`greet` is exported, without being published, at packages/lib/src/other.ts:1 as well, which is another declaration.');
    expect(own).not.toMatch(/both\.ts:1|index\.ts|alias\.ts|unrelated\.ts/);
    expect(own).toContain(`\n\n${UNCOUNTED_LINE}`);
    expect(namesake).toMatch(/^Imported in 1 place, inside @acme\/lib\.$/m);
    expect(namesake).toMatch(/^packages\/lib\/src\/unrelated\.ts:1 — @acme\/lib; used on line 2$/m);
  });

  it('lists the imports within its package of a name an entry publishes under another name than its declaration', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport { greet as salute } from './greet.js';\n",
      'packages/lib/src/inner.ts': "import { salute } from './index.js';\nexport const inner = salute('inner');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'salute']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/inner\.ts:1 — @acme\/lib; used on line 2$/m);
  });

  it('does not list a re-export in another package as a use, and follows a type-only one as a type', async () => {
    checkout({
      'apps/app/src/relay.ts': "export { greet } from '@acme/lib';\n",
      'apps/app/src/relayed.ts': "import { greet } from './relay.js';\nexport const relayed = greet('relay');\n",
      'apps/app/src/typed.ts': "export { type greet as Greet } from '@acme/lib';\n",
      'apps/app/src/greeted.ts': "import type { Greet } from './typed.js';\nexport type Greeted = typeof Greet;\n",
      'apps/app/src/star.ts': "export * from '@acme/lib';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).toMatch(/^apps\/app\/src\/relayed\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).toMatch(/^apps\/app\/src\/greeted\.ts:1 — @acme\/app \(as Greet\) \(type only\); used on line 2$/m);
    expect(out).not.toMatch(/relay\.ts|typed\.ts|star\.ts/);
  });

  it('follows a type-only re-export in each spelling, and marks what comes through it a type', async () => {
    checkout({
      'packages/lib/src/greet.ts': "export const other = 1;\nexport function greet(name: string): string {\n  return name;\n}\n",
      'packages/lib/src/typed.ts': "export { type greet, other } from './greet.js';\n",
      'packages/lib/src/typeuse.ts': "import { other, greet } from './typed.js';\nexport type Typeuse = typeof greet | typeof other;\n",
      'packages/lib/src/types.ts': "import type { greet } from './greet.js';\nexport type { greet as Hi } from './greet.js';\nexport type Own = typeof greet;\n",
      'packages/lib/src/all.ts': "export type * from './types.js';\n",
      'packages/lib/src/hi.ts': "import { Hi } from './all.js';\nexport type Hello = typeof Hi;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/typeuse\.ts:1 — @acme\/lib \(type only\); used on line 2$/m);
    expect(out).toMatch(/^packages\/lib\/src\/types\.ts:1 — @acme\/lib \(type only\); used on line 3$/m);
    expect(out).toMatch(/^packages\/lib\/src\/hi\.ts:1 — @acme\/lib \(as Hi\) \(type only\); used on line 2$/m);
    expect(out).not.toMatch(/typed\.ts|types\.ts:2|all\.ts/);
  });

  it('leaves an import through another specifier of the package to that specifier when `--package` names one', async () => {
    checkout({
      'packages/duo/package.json': JSON.stringify({ name: '@acme/duo', exports: { '.': './src/index.ts', './hi': './src/hi.ts' } }),
      'packages/duo/src/index.ts': "export { hi } from './hi.js';\n",
      'packages/duo/src/hi.ts': 'export const hi = (name: string): string => name;\n',
      'apps/app/src/door.ts': "import { hi } from '@acme/duo';\nexport const door = hi('door');\n",
      'apps/app/src/subpath.ts': "import { hi } from '@acme/duo/hi';\nexport const subpath = hi('subpath');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'hi', '--package', '@acme/duo/hi']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^apps\/app\/src\/subpath\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).not.toContain('door.ts');

    const both = await run(['ask', 'uses', '--name', 'hi', '--package', '@acme/duo']);
    expect(both.out).toMatch(/^apps\/app\/src\/door\.ts:1 — @acme\/app; used on line 2$/m);
    expect(both.out).toMatch(/^apps\/app\/src\/subpath\.ts:1 — @acme\/app; used on line 2$/m);
  });

  it('answers plainly when the source index reads and nothing imports a published name', async () => {
    checkout({ 'apps/app/src/hello.ts': 'export const hello = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'greet']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')).toContain(
      '`greet` [function] is published and nothing in this workspace imports it; a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted. `variance ask symbol` has its signature and what is written above it.',
    );
  });

  it('keeps the imports by package path of a published name when the source index does not read, and says why the rest are not listed', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(sourceIndexPath(root), 'not a source index');

    const { code, out, err } = await run(['ask', 'uses', '--name', 'greet']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app$/m);
    expect(out).toMatch(/^Imports that do not name a package path are not listed: the source index at .* did not read: .*; run `variance index`\.$/m);
    expect(out).not.toContain(UNCOUNTED_LINE);
  });

  it('answers `symbol` for an unpublished name when the source index does not read, and says why it cannot count who imports it', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(sourceIndexPath(root), 'not a source index');

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'roundTax']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('exported, without being published, at packages/lib/src/internal/math.ts:5 by @acme/lib');
    expect(out).toMatch(/^Who imports it is read from the source index, and the source index at .* did not read: .*; run `variance index`\.$/m);
  });

  it('answers `symbol` for an unpublished name when no source index is published, and says so', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    rmSync(sourceIndexPath(root));

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'roundTax']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('exported, without being published, at packages/lib/src/internal/math.ts:5 by @acme/lib');
    expect(out).toMatch(/^Who imports it is read from the source index, and no source index is published; run `variance index`\.$/m);
  });

  it('answers `uses` and `symbol` alike for a name its package entry passes on and only its own package imports', async () => {
    // Declared in one file, published by `export … from` in the entry, and
    // imported by a file beside it: both answers call the name exported, and
    // neither calls it kept to its file.
    checkout({
      'apps/app/src/hello.ts': 'export const hello = 1;\n',
      'packages/lib/src/greet.test.ts': "import { greet } from './greet.js';\nexport const greeted = greet('test');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await run(['ask', 'uses', '--name', 'greet']);
    expect(uses.err).toBe('');
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toContain('`greet` [function] is imported in 1 place, inside @acme/lib.');
    expect(uses.out).toMatch(/^packages\/lib\/src\/greet\.test\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(uses.out).not.toContain('not exported');

    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.err).toBe('');
    expect(symbol.code).toBe(EXIT_CLEAN);
    expect(symbol.out).toContain("import { greet } from '@acme/lib';");
    expect(symbol.out).toContain('declared at packages/lib/src/greet.ts:1');
    expect(symbol.out).not.toContain('not exported');
  });

  it('counts the imports of an unpublished name through a barrel once, under the file that declares it', async () => {
    checkout({
      'packages/lib/src/internal/index.ts': "export { roundTax } from './math.js';\n",
      'packages/lib/src/internal/rounded.ts': "import { roundTax } from './index.js';\nexport const rounded = roundTax(2);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'roundTax']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('exported, without being published, at packages/lib/src/internal/math.ts:5 by @acme/lib');
    expect(out).toMatch(/Imported in 1 place\b/);
    expect(out).not.toContain('packages/lib/src/internal/index.ts');
    expect(out.match(/^roundTax \[\w+\]$/gm)).toHaveLength(1);
  });

  it('counts a published name read off `import x = require()` in another package, in `uses` and in `symbol`', async () => {
    checkout({
      'apps/app/src/hello.ts': 'export const hello = 1;\n',
      'apps/app/src/required.cts': "import lib = require('@acme/lib');\nexport const required = lib.greet('cjs');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await run(['ask', 'uses', '--name', 'greet']);
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toMatch(/^apps\/app\/src\/required\.cts:2 — @acme\/app \(namespace, line 1\)$/m);

    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.out).toContain('used by 1 package: @acme/app');
  });

  it('counts a Rust `use` of an item and not the `mod` that declares the module it is in', async () => {
    // `mod order;` takes the file as a module, as Python's `import m` does; it
    // imports no item, though the item shares the module's name.
    checkout({
      'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
      'packages/kit/src/lib.rs': 'mod order;\nuse crate::order::order;\n\npub fn run() {\n    order();\n}\n',
      'packages/kit/src/order.rs': 'pub fn order() {}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'order']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/kit\/src\/lib\.rs:2\b/m);
    expect(out).not.toMatch(/^packages\/kit\/src\/lib\.rs:1\b/m);
  });
});
