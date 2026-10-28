import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a name an installed package or a module of the
 * runtime's declares: every import of it out of that package or module, each
 * written the way the workspace writes its own — an `import()` and an
 * `export … from` marked — nearest to `from` first, after the workspace's own
 * answer when the workspace declares the name too, and what was not read
 * named after them.
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
    expect(out).toMatch(/^packages\/tool\/src\/view\.ts:1 — @acme\/tool; used on line 2$/m);
    expect(out).toContain('`render` is imported from outside the workspace too, in 1 place, out of thirdp:');
    expect(out).toMatch(/^packages\/tool\/src\/paint\.ts:1 — @acme\/tool, from thirdp; used on line 2$/m);
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
      'packages/other/src/deep/near.ts:1 — @acme/other, from thirdp; used on line 2',
      'packages/tool/src/lazy.ts:3 — @acme/tool, from thirdp (import() on line 2)',
    ]);
  }, 120_000);

  it('hands the imports from outside to a crossing of questions as the files that import the name', async () => {
    checkout(OUTSIDE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const both = await run(['ask', 'intersection', 'uses --name parseSync', 'discover --path deep']);
    expect(both.err).toBe('');
    expect(both.out).toContain('1 file in all of them.');
    expect(both.out).toContain('packages/other/src/deep/near.ts — 1: line 1 · 2: the file');
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
    expect(out).toContain('The imports of 1 file were not read, so an import of it there from outside the workspace is not known: packages/tool/src/any.ts.');
  }, 120_000);

  it('names the files whose imports were not read after a workspace answer with no import from outside', async () => {
    checkout({ ...OUTSIDE, 'packages/tool/src/any.ts': 'export const load = (at: string): Promise<unknown> => import(at);\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'view']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('imported from outside the workspace');
    expect(out).toContain('The imports of 1 file were not read, so an import of it there from outside the workspace is not known: packages/tool/src/any.ts.');
  }, 120_000);

  it('lists an export … from out of an installed package as an import that passes the name on, and no declaration', async () => {
    checkout({ ...OUTSIDE, 'packages/tool/src/again.ts': "export { parseSync } from 'thirdp';\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('each answered below');
    expect(out).not.toContain('exported at');
    expect(out).toContain('`parseSync` is declared in no file of this workspace; it is imported from outside it in 3 places, out of thirdp.');
    expect(out).toMatch(/^packages\/tool\/src\/again\.ts:1 — @acme\/tool, from thirdp, passes it on$/m);
  }, 120_000);
});

const RUNTIME = {
  ...OUTSIDE,
  'packages/other/src/resolve.ts': 'export function resolve(at: string): string {\n  return at;\n}\n',
  'packages/tool/src/where.ts': "import { join, resolve } from 'node:path';\nexport const at = resolve(join('a', 'b'));\n",
  'packages/tool/src/bare.ts': "import { resolve as resolved } from 'path';\nexport const there = resolved('c');\n",
};

describe('variance ask uses over a name a module of the runtime declares', () => {
  it('counts the runtime module as one more source, with or without its scheme, after the workspace declaration', async () => {
    checkout(RUNTIME);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'resolve']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n').slice(0, 3)).toEqual([
      '`resolve` names 1 declaration and is imported from 1 built-in module, each answered below:',
      '  function, exported, at packages/other/src/resolve.ts:1',
      '  imported from node:path, which the runtime declares',
    ]);
    expect(out).toContain('`resolve` is imported from outside the workspace too, in 2 places, out of node:path:');
    expect(out).toMatch(/^packages\/tool\/src\/bare\.ts:1 — @acme\/tool, from node:path, the runtime's \(as resolved\); used on line 2$/m);
    expect(out).toMatch(/^packages\/tool\/src\/where\.ts:1 — @acme\/tool, from node:path, the runtime's; used on line 2$/m);
  }, 120_000);

  it('answers a name only the runtime declares by its imports, and says the declaration is the runtime’s', async () => {
    checkout(RUNTIME);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'join']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`join` is declared in no file of this workspace; it is imported from outside it in 1 place, out of node:path.');
    expect(out).toContain("A built-in module's declaration is the runtime's, which the source index does not read.");
    expect(out).not.toContain('has its declaration in each package');
  }, 120_000);
});

describe('variance ask uses --package over a name declared outside the workspace', () => {
  it('keeps the imports out of the package asked, and drops the others', async () => {
    checkout(RUNTIME);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const outside = await run(['ask', 'uses', '--name', 'render', '--package', 'thirdp']);
    expect(outside.code).toBe(EXIT_CLEAN);
    expect(outside.out).toMatch(/^packages\/tool\/src\/paint\.ts:1 — @acme\/tool, from thirdp; used on line 2$/m);
    expect(outside.out).not.toContain('packages/tool/src/view.ts');

    const workspace = await run(['ask', 'uses', '--name', 'render', '--package', '@acme/pkg']);
    expect(workspace.code).toBe(EXIT_CLEAN);
    expect(workspace.out).toMatch(/^packages\/tool\/src\/view\.ts:1 — @acme\/tool; used on line 2$/m);
    expect(workspace.out).not.toContain('from thirdp');
  }, 120_000);

  it('keeps the imports through the package specifier asked, and drops the package\'s other specifiers', async () => {
    checkout({
      ...OUTSIDE,
      'packages/tool/src/sub.ts': "import { parseSync } from 'thirdp/sub';\nexport const sub = parseSync('s');\n",
      'node_modules/thirdp/sub.d.ts': 'export declare function parseSync(text: string): unknown;\n',
      'node_modules/thirdp/sub.js': 'exports.parseSync = (t) => t;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const subpath = await run(['ask', 'uses', '--name', 'parseSync', '--package', 'thirdp/sub']);
    expect(subpath.code).toBe(EXIT_CLEAN);
    expect(subpath.out).toContain('`parseSync` is declared in no file of this workspace; it is imported from outside it in 1 place, out of thirdp.');
    expect(subpath.out).toMatch(/^packages\/tool\/src\/sub\.ts:1 — @acme\/tool, from thirdp; used on line 2$/m);
    expect(subpath.out).not.toContain('packages/other/src/deep/near.ts');

    const whole = await run(['ask', 'uses', '--name', 'parseSync', '--package', 'thirdp']);
    expect(whole.out).toContain('packages/other/src/deep/near.ts:1');
    expect(whole.out).toContain('packages/tool/src/sub.ts:1');
  }, 120_000);

  it('takes a module of the runtime by its name with or without the scheme', async () => {
    checkout(RUNTIME);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const asked of ['path', 'node:path']) {
      const { code, out } = await run(['ask', 'uses', '--name', 'resolve', '--package', asked]);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain('`resolve` is declared in no file of this workspace; it is imported from outside it in 2 places, out of node:path.');
      expect(out).toMatch(/^packages\/tool\/src\/bare\.ts:1 — @acme\/tool, from node:path, the runtime's \(as resolved\); used on line 2$/m);
      expect(out).toMatch(/^packages\/tool\/src\/where\.ts:1 — @acme\/tool, from node:path, the runtime's; used on line 2$/m);
      expect(out).not.toContain('packages/other/src/resolve.ts');
    }
  }, 120_000);
});
