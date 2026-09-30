import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `variance ask` over the shape a large monorepo's internal libraries take: a
 * package that writes `main` and no `exports`, another whose `exports` opens
 * only `.`, and a private app that imports the deep internals of both across
 * the package boundary. With no `exports` the first package opened nothing, so
 * it went missing from `ask packages` with every import of it, and a name its
 * `main` publishes was refused as unpublished.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-deep-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-deep-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'] }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@acme/lib-exports/src/*': ['packages/lib-exports/src/*'] } } }),
    'packages/lib/package.json': JSON.stringify({ name: '@acme/lib', main: 'src/index.ts' }),
    'packages/lib/src/index.ts': "export { greet } from './greet.js';\n",
    'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\n',
    'packages/lib/src/internal/math.ts': 'export function addTax(amount: number): number {\n  return amount * 1.2;\n}\n',
    'packages/lib/src/internal/deep/format.ts': 'export function formatPrice(amount: number): string {\n  return `$${amount}`;\n}\n',
    'packages/lib-exports/package.json': JSON.stringify({ name: '@acme/lib-exports', exports: { '.': './src/index.ts' } }),
    'packages/lib-exports/src/index.ts': 'export const slug = (title: string): string => title;\n',
    'packages/lib-exports/src/internal/clamp.ts': 'export const clamp = (value: number): number => value;\n',
    'apps/app/package.json': JSON.stringify({ name: '@acme/app', private: true, dependencies: { '@acme/lib': '*', '@acme/lib-exports': '*' } }),
    'apps/app/src/hello.ts': "import { greet } from '@acme/lib';\nexport const hello = greet('app');\n",
    'apps/app/src/total.ts': "import { addTax } from '@acme/lib/src/internal/math';\nexport const total = addTax(10);\n",
    'apps/app/src/label.ts': "import { formatPrice } from '@acme/lib/src/internal/deep/format';\nexport const label = formatPrice(3);\n",
    'apps/app/src/bounded.ts': "import { clamp } from '@acme/lib-exports/src/internal/clamp';\nexport const bounded = clamp(140);\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'node_modules/@acme'), { recursive: true });
  symlinkSync('../../packages/lib', join(root, 'node_modules/@acme/lib'));
  symlinkSync('../../packages/lib-exports', join(root, 'node_modules/@acme/lib-exports'));
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: () => {} });
  return { code, out };
}

describe('variance ask over a private app that reaches into another package', () => {
  it('lists a package published by `main` alone, and every deep import into either package', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'packages']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^@acme\/lib — 1 names?, 1 imported elsewhere/m);
    expect(out).toMatch(/^@acme\/lib-exports — 1 names?, 0 imported elsewhere/m);
    expect(out).not.toMatch(/^@acme\/app/m);
    expect(out).toMatch(/3 imports reach past a published entrypoint/);
    expect(out).toContain('@acme/lib/src/internal/math — @acme/app at apps/app/src/total.ts:1');
    expect(out).toContain('@acme/lib/src/internal/deep/format — @acme/app at apps/app/src/label.ts:1');
    expect(out).toContain('@acme/lib-exports/src/internal/clamp — @acme/app at apps/app/src/bounded.ts:1');
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
});
