import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask` over the shape a large monorepo's internal libraries take: a
 * package that writes `main` and no `exports`, another whose `exports` opens
 * only `.`, two that declare no entry at all — one public, one private — and a
 * private app that imports files of all four across the package boundary. With
 * no `exports` the first package opened nothing, so it went missing from `ask
 * packages` with every import of it, and a name its `main` publishes was refused
 * as unpublished. A package that declares no entry is a folder every consumer
 * imports files of by path, and every import of one was dropped. `ask packages`
 * counts those imports per package; `ask entrypoint --package` counts the ones
 * into one per file, and the ones written as one specifier per name.
 */

const cwd = process.cwd();
let commit: (message: string) => void = () => {};

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-deep-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** A published package whose `main` names a file the checkout does not hold, and an import of one of its files. */
const GONE = {
  'packages/gone/package.json': JSON.stringify({ name: '@acme/gone', main: 'target/index.js' }),
  'packages/gone/src/hush.ts': 'export const hush = (text: string): string => text;\n',
  'apps/app/src/hushed.ts': "import { hush } from '@acme/gone/src/hush';\nexport const hushed = hush('quiet');\n",
  'apps/app/src/entered.ts': "import { hush } from '@acme/gone';\nexport const entered = hush('loud');\n",
};

/** A published package that declares its entry by `typings` alone, naming a declaration file the checkout does not hold. */
const TYPED = {
  'packages/typed/package.json': JSON.stringify({ name: '@acme/typed', typings: 'dist/index.d.ts' }),
  'packages/typed/src/shout.ts': 'export const shout = (text: string): string => text;\n',
  'apps/app/src/typed.ts': "import { shout } from '@acme/typed';\nexport const typed = shout('hey');\n",
};

/** The paragraph of `text` that opens with `heading`. */
function paragraph(text: string, heading: RegExp): string {
  return text.split('\n\n').find((block) => heading.test(block)) ?? '';
}

function checkout(more: Readonly<Record<string, string>> = {}): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-deep-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'] }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@acme/lib-exports/src/*': ['packages/lib-exports/src/*'] } } }),
    'packages/lib/package.json': JSON.stringify({ name: '@acme/lib', main: 'src/index.ts' }),
    'packages/lib/src/index.ts': "export { greet } from './greet.js';\n",
    'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\n',
    'packages/lib/src/internal/math.ts':
      'export function addTax(amount: number): number {\n  return amount * 1.2;\n}\n\nexport const roundTax = (amount: number): number => amount;\n',
    'packages/lib/src/internal/deep/format.ts': 'export function formatPrice(amount: number): string {\n  return `$${amount}`;\n}\n',
    'packages/lib-exports/package.json': JSON.stringify({ name: '@acme/lib-exports', exports: { '.': './src/index.ts' } }),
    'packages/lib-exports/src/index.ts': 'export const slug = (title: string): string => title;\n',
    'packages/lib-exports/src/internal/clamp.ts': 'export const clamp = (value: number): number => value;\n',
    'packages/kit/package.json': JSON.stringify({ name: '@acme/kit' }),
    'packages/kit/src/money/tax.ts': 'export function taxOf(amount: number): number {\n  return amount / 5;\n}\n\nexport const unusedRate = 0.2;\n',
    'packages/kit/src/ui/Button.ts': "export const Button = (label: string): string => `[${label}]`;\n",
    'packages/kit/src/orphan.ts': 'export const orphan = 1;\n',
    'packages/kit-private/package.json': JSON.stringify({ name: '@acme/kit-private', private: true }),
    'packages/kit-private/src/stamp.ts': 'export const stamp = (text: string): string => text;\n',
    'apps/app/package.json': JSON.stringify({
      name: '@acme/app',
      private: true,
      dependencies: { '@acme/lib': '*', '@acme/lib-exports': '*', '@acme/kit': '*', '@acme/kit-private': '*' },
    }),
    'apps/app/src/hello.ts': "import { greet } from '@acme/lib';\nexport const hello = greet('app');\n",
    'apps/app/src/total.ts': "import { addTax } from '@acme/lib/src/internal/math';\nexport const total = addTax(10);\n",
    'apps/app/src/label.ts': "import { formatPrice } from '@acme/lib/src/internal/deep/format';\nexport const label = formatPrice(3);\n",
    'apps/app/src/bounded.ts': "import { clamp } from '@acme/lib-exports/src/internal/clamp';\nexport const bounded = clamp(140);\n",
    'apps/app/src/checkout.ts':
      "import { taxOf } from '@acme/kit/src/money/tax';\nimport { Button } from '@acme/kit/src/ui/Button';\nexport const checkout = Button(String(taxOf(10)));\n",
    'apps/app/src/stamped.ts': "import { stamp } from '@acme/kit-private/src/stamp';\nexport const stamped = stamp('paid');\n",
    ...more,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'node_modules/@acme'), { recursive: true });
  symlinkSync('../../packages/lib', join(root, 'node_modules/@acme/lib'));
  symlinkSync('../../packages/lib-exports', join(root, 'node_modules/@acme/lib-exports'));
  symlinkSync('../../packages/kit', join(root, 'node_modules/@acme/kit'));
  symlinkSync('../../packages/kit-private', join(root, 'node_modules/@acme/kit-private'));
  for (const path of Object.keys(more)) {
    const dir = /^packages\/([^/]+)\/package\.json$/u.exec(path)?.[1];
    if (dir !== undefined) symlinkSync(`../../packages/${dir}`, join(root, `node_modules/@acme/${dir}`));
  }
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  commit = (message) => {
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', message]);
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  commit('the checkout');
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask over a private app that reaches into another package', () => {
  it('lists a package published by `main` alone, and counts the deep imports into either package', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'packages']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^@acme\/lib — 1 names?, 1 imported elsewhere/m);
    expect(out).toMatch(/^@acme\/lib-exports — 1 names?, 0 imported elsewhere/m);
    expect(out).not.toMatch(/^@acme\/app/m);
    expect(out).toMatch(/3 imports reach past a published entrypoint/);
    expect(out).toMatch(/^ {2}@acme\/lib — 2 imports$/m);
    expect(out).toMatch(/^ {2}@acme\/lib-exports — 1 import$/m);
    expect(out).not.toContain('apps/app/src/');
  });

  it('counts the deep imports into one package per file when `entrypoint --package` names it, and per name for one specifier', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const lib = await run(['ask', 'entrypoint', '--package', '@acme/lib']);
    expect(lib.code).toBe(EXIT_CLEAN);
    expect(lib.out).toMatch(/^ {2}@acme\/lib\/src\/internal\/math — 1 name, imported by 1 file$/m);
    expect(lib.out).toMatch(/^ {2}@acme\/lib\/src\/internal\/deep\/format — 1 name, imported by 1 file$/m);
    expect(lib.out).not.toContain('apps/app/src/');
    expect(lib.out).not.toContain('clamp');

    const math = await run(['ask', 'entrypoint', '--package', '@acme/lib/src/internal/math']);
    expect(math.code).toBe(EXIT_CLEAN);
    expect(math.out).toMatch(/^ {2}addTax — imported by 1 file$/m);
    expect(math.out).not.toContain('apps/app/src/');
    expect(math.out).toMatch(/^ {2}variance ask uses --name addTax --package @acme\/lib\/src\/internal\/math$/m);

    const exports = await run(['ask', 'entrypoint', '--package', '@acme/lib-exports/src/internal/clamp']);
    expect(exports.code).toBe(EXIT_CLEAN);
    expect(exports.out).toMatch(/^ {2}clamp — imported by 1 file$/m);
  });

  it('answers for a name the package publishes by `main`, where it is declared and who imports it', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const symbol = await run(['ask', 'symbol', '--name', 'greet']);
    expect(symbol.code).toBe(EXIT_CLEAN);
    expect(symbol.out).toContain("import { greet } from '@acme/lib';");
    expect(symbol.out).toContain('declared at packages/lib/src/greet.ts:1');

    const uses = await run(['ask', 'uses', '--name', 'greet']);
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toContain('apps/app/src/hello.ts:1 — @acme/app');
  });

  it('keeps refusing a name nothing imports, naming where it is exported, and a name nothing exports', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const exported = 'is not published by this workspace; it is exported, without being published, at packages/lib/src/internal/math.ts:5';
    for (const verb of ['uses', 'symbol']) {
      const unimported = await run(['ask', verb, '--name', 'roundTax']);
      expect(unimported.code).toBe(EXIT_OPERATOR);
      expect(unimported.err).toContain(`\`roundTax\` ${exported}`);
      expect(unimported.out).toBe('');

      const unwritten = await run(['ask', verb, '--name', 'neverWritten']);
      expect(unwritten.code).toBe(EXIT_OPERATOR);
      expect(unwritten.err).toContain('`neverWritten` is not published by this workspace, and no published name contains it');
    }
  });

  it('answers `uses` for a name another package imports by a deep path, marking each import as deep', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [name, site] of [
      ['addTax', 'apps/app/src/total.ts:1'],
      ['formatPrice', 'apps/app/src/label.ts:1'],
      ['clamp', 'apps/app/src/bounded.ts:1'],
    ] as const) {
      const { code, out } = await run(['ask', 'uses', '--name', name]);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toMatch(new RegExp(`^${site} — @acme/app, deep import of @acme/lib`, 'm'));
    }
  });

  it('answers `symbol` for a name imported by a deep path: where it is declared, that it is not published, and who imports it', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'addTax']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('declared at packages/lib/src/internal/math.ts:1');
    expect(out).toContain('not published: @acme/lib declares an entry, and this file is not behind it');
    expect(out).toMatch(/^ {2}apps\/app\/src\/total\.ts:1 — @acme\/app, deep import of @acme\/lib\/src\/internal\/math$/m);
  });

  it('lists a package that declares no entry by what other packages import from it, public or private, and none of it as deep', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'packages']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^2 packages that declare no entry are imported by path/m);
    expect(out).toMatch(/^ {2}@acme\/kit — 2 names from 2 of its files$/m);
    expect(out).toMatch(/^ {2}@acme\/kit-private — 1 name from 1 of its files$/m);
    expect(out).not.toMatch(/unusedRate|orphan|taxOf/);
    expect(out).toMatch(/3 imports reach past a published entrypoint/);
    expect(out).toMatch(/^ {2}variance ask entrypoint --package @acme\/kit$/m);
  });

  it('answers `entrypoint` for a package that declares no entry with what other packages import from it', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const kit = await run(['ask', 'entrypoint', '--package', '@acme/kit']);
    expect(kit.code).toBe(EXIT_CLEAN);
    expect(kit.out).toMatch(/^@acme\/kit declares no entry: .* Other packages import 2 names from 2 of its files by path, most imported first:$/m);
    expect(kit.out).toMatch(/^ {2}@acme\/kit\/src\/money\/tax — 1 name, imported by 1 file$/m);
    expect(kit.out).toMatch(/^ {2}@acme\/kit\/src\/ui\/Button — 1 name, imported by 1 file$/m);
    expect(kit.out).not.toMatch(/unusedRate|orphan|kit-private/);

    const button = await run(['ask', 'entrypoint', '--package', '@acme/kit/src/ui/Button']);
    expect(button.code).toBe(EXIT_CLEAN);
    expect(button.out).toMatch(/^ {2}Button — imported by 1 file$/m);
    expect(button.out).toMatch(/^ {2}variance ask uses --name Button --package @acme\/kit\/src\/ui\/Button$/m);

    const hidden = await run(['ask', 'entrypoint', '--package', '@acme/kit-private']);
    expect(hidden.code).toBe(EXIT_CLEAN);
    expect(hidden.out).toMatch(/^@acme\/kit-private declares no entry: .* Other packages import 1 name from 1 of its files by path, most imported first:$/m);
    expect(hidden.out).toMatch(/^ {2}@acme\/kit-private\/src\/stamp — 1 name, imported by 1 file$/m);
  });

  it('answers `uses` and `symbol` for a name imported from a package that declares no entry, without calling the import deep', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await run(['ask', 'uses', '--name', 'taxOf']);
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toMatch(/^apps\/app\/src\/checkout\.ts:1 — @acme\/app, by path from @acme\/kit\/src\/money\/tax$/m);
    expect(uses.out).not.toContain('deep import');

    const symbol = await run(['ask', 'symbol', '--name', 'taxOf']);
    expect(symbol.code).toBe(EXIT_CLEAN);
    expect(symbol.out).toContain('declared at packages/kit/src/money/tax.ts:1');
    expect(symbol.out).toContain('not published: @acme/kit declares no entry');
  });

  it('keeps answering after an index that only an importer changed, which refreshes the reading in place', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync('apps/app/src/again.ts', "import { addTax } from '@acme/lib/src/internal/math';\nimport { stamp } from '@acme/kit-private/src/stamp';\n\nconsole.log(stamp(String(addTax(1))));\n");
    commit('an importer that exports nothing');
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await run(['ask', 'uses', '--name', 'addTax']);
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toMatch(/^apps\/app\/src\/again\.ts:1 — @acme\/app, deep import of @acme\/lib\/src\/internal\/math$/m);
    expect(uses.out).toMatch(/^apps\/app\/src\/total\.ts:1 — @acme\/app, deep import/m);

    const packages = await run(['ask', 'packages']);
    expect(packages.out).toMatch(/4 imports reach past a published entrypoint/);
    const hidden = await run(['ask', 'entrypoint', '--package', '@acme/kit-private/src/stamp']);
    expect(hidden.out).toMatch(/^ {2}stamp — imported by 2 files$/m);
  });

  it('keeps the imports into a package whose declared entry leads to no file: of that entry, and past it', async () => {
    checkout(GONE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const packages = await run(['ask', 'packages']);
    expect(packages.code).toBe(EXIT_CLEAN);
    // The import of `@acme/gone` itself names the entry, and only the one of `src/hush` reaches past it.
    expect(paragraph(packages.out, /past a published entrypoint/)).toMatch(/^4 imports reach past .*(\n.*)*\n {2}@acme\/gone — 1 import(\n|$)/);
    expect(paragraph(packages.out, /could not follow to a source file/)).toBe(
      '1 package declares an entry this reading could not follow to a source file, such as a build output the checkout ' +
        'does not hold, so none of its names are listed. 1 import names an entry like that, most first:\n  @acme/gone — 1 import',
    );
    expect(packages.out).toMatch(/^ {2}variance ask entrypoint --package @acme\/gone$/m);

    const gone = await run(['ask', 'entrypoint', '--package', '@acme/gone']);
    expect(gone.code).toBe(EXIT_CLEAN);
    expect(gone.out).toMatch(/^@acme\/gone declares an entry this reading could not follow to a source file, .* so none of its names are listed\.$/m);
    expect(paragraph(gone.out, /that this reading could not follow/)).toBe(
      '1 import names an entry @acme/gone declares that this reading could not follow, most imported first:\n' +
        '  @acme/gone — 1 name, imported by 1 file',
    );
    expect(gone.out).toMatch(/^ {2}@acme\/gone\/src\/hush — 1 name, imported by 1 file$/m);
    const hush = await run(['ask', 'entrypoint', '--package', '@acme/gone/src/hush']);
    expect(hush.out).toMatch(/^ {2}hush — imported by 1 file$/m);

    writeFileSync('apps/app/src/again.ts', "import { hush } from '@acme/gone/src/hush';\n\nconsole.log(hush('again'));\n");
    commit('a second importer');
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const uses = await run(['ask', 'uses', '--name', 'hush']);
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toMatch(/^apps\/app\/src\/again\.ts:1 — @acme\/app, deep import of @acme\/gone\/src\/hush$/m);
    expect(uses.out).toMatch(/^apps\/app\/src\/hushed\.ts:1 — @acme\/app, deep import of @acme\/gone\/src\/hush$/m);
    expect(uses.out).toMatch(/^apps\/app\/src\/entered\.ts:1 — @acme\/app, through @acme\/gone, an entry this reading could not follow to a source file$/m);
  });

  it('reads an entry declared by `typings` alone as declared, in the count of packages and of their imports alike', async () => {
    checkout(TYPED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const packages = await run(['ask', 'packages']);
    expect(packages.code).toBe(EXIT_CLEAN);
    expect(paragraph(packages.out, /could not follow to a source file/)).toBe(
      '1 package declares an entry this reading could not follow to a source file, such as a build output the checkout ' +
        'does not hold, so none of its names are listed. 1 import names an entry like that, most first:\n  @acme/typed — 1 import',
    );
    expect(packages.out).not.toMatch(/^ {2}@acme\/typed — \d+ names? from/m);

    const typed = await run(['ask', 'entrypoint', '--package', '@acme/typed']);
    expect(typed.code).toBe(EXIT_CLEAN);
    expect(typed.out).toMatch(/^@acme\/typed declares an entry this reading could not follow to a source file, .* so none of its names are listed\.$/m);
  });
});
