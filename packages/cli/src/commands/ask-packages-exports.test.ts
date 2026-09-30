import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `variance ask packages` over a package whose `exports` is written as the
 * conditions of `.`, the shape `@tanstack/solid-query` ships. Read as subpaths,
 * the condition key was glued onto the package name and reported as a package
 * that does not exist, with nothing imported from it.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-exports-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(overrides: Readonly<Record<string, string>> = {}): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-exports-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { customConditions: ['@tanstack/custom-condition'] } }),
    'packages/solid/package.json': JSON.stringify({
      name: '@t/solid',
      exports: {
        '@tanstack/custom-condition': './src/index.ts',
        development: { import: { types: './build/index.d.ts', default: './build/dev.js' } },
        import: { types: './build/index.d.ts', default: './build/index.js' },
      },
    }),
    'packages/solid/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { outDir: './dist-ts', rootDir: '.' } }),
    'packages/solid/src/index.ts': 'export const useQuery = () => 1;\n',
    'packages/app/package.json': JSON.stringify({ name: '@t/app', dependencies: { '@t/solid': '*' } }),
    'packages/app/src/page.ts': "import { useQuery } from '@t/solid';\nexport const page = useQuery();\n",
    ...overrides,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
  symlinkSync('../../packages/solid', join(root, 'node_modules/@t/solid'));
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

describe('variance ask packages over an `exports` written as conditions', () => {
  it('names the package itself, with the name another package imports from it, and invents no package from a condition key', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'packages']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toMatch(/custom-condition/);
    expect(out).toMatch(/^@t\/solid — 1 names?, 1 imported elsewhere/m);
    expect(out).not.toMatch(/reach past a published entrypoint/);
  });

  it('reads the condition from a commented `tsconfig.base.json` the package extends', async () => {
    // Kibana's shape: every config in an `extends` chain is JSONC, whatever its name.
    checkout({
      'tsconfig.json': '{}',
      'tsconfig.base.json': '// shared settings\n{ "compilerOptions": { "customConditions": ["@tanstack/custom-condition"], }, }\n',
      'packages/solid/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.base.json', compilerOptions: { outDir: './dist-ts', rootDir: '.' } }),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'packages']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^@t\/solid — 1 names?, 1 imported elsewhere/m);
  });
});
