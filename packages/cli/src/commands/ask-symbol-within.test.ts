import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` counts the imports of a published name the way `ask
 * uses` lists them: the ones from other packages and the ones inside its own,
 * each labelled, summing to the places `uses` names. The header counts only
 * the imports by published path, and says so.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-within-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** Five files of `@acme/lib` that import `greet` from its declaration, beside the one import from `@acme/app`. */
const FIVE_WITHIN = Object.fromEntries(
  ['one', 'two', 'three', 'four', 'five'].map((file) => [`packages/lib/src/${file}.ts`, `import { greet } from './greet.js';\nexport const ${file} = greet('${file}');\n`]),
);

describe('variance ask symbol over the imports of a published name inside its own package', () => {
  it('counts one import from another package and five inside its own, as `uses` lists six', async () => {
    checkout(FIVE_WITHIN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.code).toBe(EXIT_CLEAN);
    expect(symbol.out).toContain('used by 1 package: @acme/app — 1 import by published path');
    expect(symbol.out).toContain(
      '`variance ask uses` names the 6 places that import this: 1 from another package and 5 inside @acme/lib, nearest to a file you name first.',
    );

    const uses = await run(['ask', 'uses', '--name', 'greet']);
    expect(uses.out).toContain('`greet` [function] is imported in 6 places.');
  });

  it('counts the imports inside its own package of a name no other package imports', async () => {
    checkout({ ...FIVE_WITHIN, 'apps/app/src/hello.ts': 'export const hello = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('no other package imports it by its published path');
    expect(out).toContain('`variance ask uses` names the 5 places that import this: 5 inside @acme/lib, nearest to a file you name first.');
  });

  it('counts the imports that may read the name apart, as `uses` does, and no import among them', async () => {
    checkout({
      ...FIVE_WITHIN,
      'apps/app/src/passed.ts': "export async function keys(): Promise<number> {\n  const passed = await import('@acme/lib');\n  return count(passed);\n}\n\nfunction count(held: object): number {\n  return Object.keys(held).length;\n}\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await run(['ask', 'uses', '--name', 'greet']);
    expect(uses.out).toContain('`greet` [function] is imported in 6 places. 1 more passes the module on whole');

    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.out).toContain(
      '`variance ask uses` names the 6 places that import this: 1 from another package and 5 inside @acme/lib, nearest to a file you name first, and the ones that may read it.',
    );
    expect(symbol.out).toContain('used by 1 package: @acme/app — 1 import by published path; it also may be read in 1 place: 1 passing the module on whole');
  });

  it('names the places inside its own package that may read the name once, in the header, with the count `uses` lists', async () => {
    checkout({
      ...FIVE_WITHIN,
      'packages/lib/src/passed.ts': "export async function keys(): Promise<number> {\n  const passed = await import('./greet.js');\n  return count(passed);\n}\n\nfunction count(held: object): number {\n  return Object.keys(held).length;\n}\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await run(['ask', 'uses', '--name', 'greet']);
    expect(uses.out).toContain('`greet` [function] is imported in 6 places. 1 more passes the module on whole');

    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.out).toContain('used by 1 package: @acme/app — 1 import by published path; it also may be read in 1 place: 1 passing the module on whole');
    expect(symbol.out).toContain(
      '`variance ask uses` names the 6 places that import this: 1 from another package and 5 inside @acme/lib, nearest to a file you name first, and the ones that may read it.',
    );
    expect(symbol.out.match(/may be read in/gu)).toHaveLength(1);
  });

  it('counts inside the package that declares the name when a package that re-exports it is imported most', async () => {
    checkout({
      ...FIVE_WITHIN,
      'packages/adapter/package.json': JSON.stringify({ name: '@acme/adapter', main: 'src/index.ts', dependencies: { '@acme/lib': '*' } }),
      'packages/adapter/src/index.ts': "export { greet } from '@acme/lib';\n",
      'apps/web/package.json': JSON.stringify({ name: '@acme/web', private: true, dependencies: { '@acme/adapter': '*' } }),
      'apps/web/src/welcome.ts': "import { greet } from '@acme/adapter';\nexport const welcome = greet('web');\n",
      'apps/shop/package.json': JSON.stringify({ name: '@acme/shop', private: true, dependencies: { '@acme/adapter': '*' } }),
      'apps/shop/src/welcome.ts': "import { greet } from '@acme/adapter';\nexport const welcome = greet('shop');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    // The total is the count `uses` gives, however it reads the adapter's own `export … from`.
    const uses = await run(['ask', 'uses', '--name', 'greet']);
    const listed = /is imported in (\d+) places\./u.exec(uses.out)?.[1];
    expect(listed).toBeDefined();
    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.out).toContain('used by 2 packages: @acme/shop, @acme/web');
    expect(symbol.out).toContain(
      `\`variance ask uses\` names the ${listed} places that import this: ${Number(listed) - 5} from other packages and 5 inside @acme/lib, nearest to a file you name first.`,
    );
  });

  it('counts the imports from other packages alone when the source index does not read, and says why', async () => {
    const root = checkout(FIVE_WITHIN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(sourceIndexPath(root), 'not a source index');

    const { code, out } = await run(['ask', 'symbol', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(
      /^`variance ask uses` names the 1 place that imports this: 1 from another package, nearest to a file you name first\. The imports inside @acme\/lib are read from the source index, and the source index at .* did not read: .*; run `variance index`\.$/m,
    );
  });
});
