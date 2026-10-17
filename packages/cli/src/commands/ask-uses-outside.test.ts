import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a name an installed package declares: every import
 * of it out of that package, each written the way the workspace writes its
 * own — an `import()` and an `export … from` marked — nearest to `from` first,
 * after the workspace's own answer when the workspace declares the name too,
 * and what was not read named after them.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-outside-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const OUTSIDE = {
  'packages/pkg/package.json': JSON.stringify({
    name: '@acme/pkg',
    type: 'module',
    exports: { './help': { types: './dist/help.d.ts', default: './dist/help.js' } },
  }),
  'packages/pkg/tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
  'packages/pkg/src/help.ts': 'export function render(text: string): string {\n  return text;\n}\n',
  'packages/tool/package.json': JSON.stringify({ name: '@acme/tool', dependencies: { '@acme/pkg': '*', thirdp: '1.0.0' } }),
  'packages/tool/src/view.ts': "import { render } from '@acme/pkg/help';\nexport const view = render('a');\n",
  'packages/tool/src/paint.ts': "import { render } from 'thirdp';\nexport const painted = render('b');\n",
  'packages/tool/src/lazy.ts': "export async function load(): Promise<unknown> {\n  const mod = await import('thirdp');\n  return mod.parseSync('z');\n}\n",
  'packages/other/package.json': JSON.stringify({ name: '@acme/other', dependencies: { thirdp: '1.0.0' } }),
  'packages/other/src/deep/near.ts': "import { parseSync } from 'thirdp';\nexport const near = parseSync('n');\n",
  'node_modules/thirdp/package.json': JSON.stringify({ name: 'thirdp', version: '1.0.0', types: 'index.d.ts', main: 'index.js' }),
  'node_modules/thirdp/index.d.ts': 'export declare function parseSync(text: string): unknown;\nexport declare function render(text: string): string;\n',
  'node_modules/thirdp/index.js': 'exports.parseSync = (t) => t;\nexports.render = (t) => t;\n',
};

describe('variance ask uses over a name an installed package declares', () => {
  it('answers the workspace declaration first, then the imports from outside, counting each apart', async () => {
    checkout(OUTSIDE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'render']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n').slice(0, 3)).toEqual([
      '`render` names 1 declaration and is imported from 1 installed package, each answered below:',
      '  function, published, at packages/pkg/src/help.ts:1',
      '  imported from thirdp, which declares it outside the workspace',
    ]);
    expect(out).toMatch(/^packages\/tool\/src\/view\.ts:1 — @acme\/tool$/m);
    expect(out).toContain('`render` is imported from outside the workspace too, in 1 place, out of thirdp:');
    expect(out).toMatch(/^packages\/tool\/src\/paint\.ts:1 — @acme\/tool, from thirdp$/m);
    expect(out.indexOf('packages/tool/src/view.ts:1')).toBeLessThan(out.indexOf('packages/tool/src/paint.ts:1'));
  }, 120_000);

  it('marks an import(), and lists the import nearest to `from` first', async () => {
    checkout(OUTSIDE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'parseSync', '--from', 'packages/other/src/deep/here.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`parseSync` is declared in no file of this workspace; it is imported from outside it in 2 places, out of thirdp.');
    expect(out).toContain('Nearest to packages/other/src/deep/here.ts first.');
    const source = out.split('\n').filter((line) => line.startsWith('packages/'));
    expect(source).toEqual([
      'packages/other/src/deep/near.ts:1 — @acme/other, from thirdp',
      'packages/tool/src/lazy.ts:3 — @acme/tool, from thirdp (import() on line 2)',
    ]);
  }, 120_000);

  it('names the files whose declarations were not read after the imports from outside', async () => {
    checkout({
      ...OUTSIDE,
      'packages/huge/package.json': JSON.stringify({ name: '@acme/huge' }),
      'packages/huge/src/huge.ts': `export const huge = 1;\n${'// filler line\n'.repeat(80_000)}`,
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`parseSync` is declared in no file of this workspace that the source index read; it is imported from outside it in 2 places, out of thirdp.');
    expect(out).toContain('The declarations of 1 file were not read into the source index, so a name declared there is not known: packages/huge/src/huge.ts.');
  }, 120_000);

  it('names the files whose imports were not read, which may import the name too', async () => {
    checkout({ ...OUTSIDE, 'packages/tool/src/any.ts': 'export const load = (at: string): Promise<unknown> => import(at);\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('The imports of 1 file were not read, so an import of it there out of an installed package is not known: packages/tool/src/any.ts.');
  }, 120_000);

  it('lists an export … from out of an installed package as an import that passes the name on, and no declaration', async () => {
    checkout({ ...OUTSIDE, 'packages/tool/src/again.ts': "export { parseSync } from 'thirdp';\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('each answered below');
    expect(out).toContain('`parseSync` is imported from outside the workspace too, in 3 places, out of thirdp:');
    expect(out).toMatch(/^packages\/tool\/src\/again\.ts:1 — @acme\/tool, from thirdp, passes it on$/m);
  }, 120_000);
});
