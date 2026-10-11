import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from '../bin.js';

/**
 * The checkout `variance ask` is measured over for the shape a large
 * monorepo's internal libraries take: a package that writes `main` and no
 * `exports`, another whose `exports` opens only `.`, two that declare no entry
 * at all — one public, one private — and a private app that imports files of
 * all four across the package boundary.
 */

/** `git` with `args` in the working directory, which `checkout` makes the checkout. */
function git(args: readonly string[]): void {
  execFileSync('git', args, { stdio: 'pipe' });
}

/** Commit everything in the checkout `checkout` made last. */
export function commit(message: string): void {
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', message]);
}

/** The paragraph of `text` that opens with `heading`. */
export function paragraph(text: string, heading: RegExp): string {
  return text.split('\n\n').find((block) => heading.test(block)) ?? '';
}

/**
 * The checkout, with `more` written over it, committed and made the working
 * directory. A package `more` adds under `packages/` is linked under its
 * `@acme/` name.
 */
export function checkout(more: Readonly<Record<string, string>> = {}): string {
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
  process.chdir(root);
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  commit('the checkout');
  return root;
}

/** `variance` run with `argv`, its exit code and what it wrote to each stream. */
export async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}
