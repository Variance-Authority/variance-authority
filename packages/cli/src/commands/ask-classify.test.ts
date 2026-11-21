import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `variance ask classify`, through the command a person types: the words of a
 * request that name a published package or export, each placed on the code map
 * `variance index` folded.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-classify-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

/**
 * Four families of five packages, each member importing the members before it:
 * enough packages for the map to split the checkout into areas.
 */
function families(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-classify-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('.gitignore', 'node_modules\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['packages/*/*'] }));
  for (const family of ['admin', 'data', 'shop', 'tools']) {
    for (let member = 0; member < 5; member += 1) {
      const name = `${family}-${member}`;
      const takes = Array.from({ length: member }, (_, earlier) => `${family}-${earlier}`);
      const dependencies = Object.fromEntries(takes.map((taken) => [`@t/${taken}`, '*']));
      write(`packages/${family}/${name}/package.json`, JSON.stringify({ name: `@t/${name}`, exports: { '.': './src/index.ts' }, dependencies }));
      const imports = takes.map((taken) => `import { ${taken.replace('-', '')} } from '@t/${taken}';\n`).join('');
      const used = takes.map((taken) => taken.replace('-', '')).join(', ');
      write(`packages/${family}/${name}/src/index.ts`, `${imports}export const ${name.replace('-', '')} = [${used}];\n`);
      mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
      symlinkSync(`../../packages/${family}/${name}`, join(root, `node_modules/@t/${name}`));
    }
  }
  // A private package that publishes nothing is still a package on the map.
  write('packages/tools/case-runner/package.json', JSON.stringify({ name: '@t/case-runner', private: true, dependencies: { '@t/tools-0': '*' } }));
  write('packages/tools/case-runner/src/run.ts', "import { tools0 } from '@t/tools-0';\nexport const run = tools0;\n");
  symlinkSync('../../packages/tools/case-runner', join(root, 'node_modules/@t/case-runner'));
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

/**
 * A workspace in `app/` whose `@t/b` imports `@t/a` beside it and `@t/shared`
 * outside its directory, so its graph is read from the repository's root.
 */
function nested(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-classify-nested-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('.gitignore', 'node_modules\n');
  write('app/package.json', JSON.stringify({ private: true, workspaces: ['packages/*', '../shared'] }));
  write('shared/package.json', JSON.stringify({ name: '@t/shared', exports: { '.': './src/index.ts' } }));
  write('shared/src/index.ts', 'export const shared = 1;\n');
  write('app/packages/a/package.json', JSON.stringify({ name: '@t/a', exports: { '.': './src/index.ts' } }));
  write('app/packages/a/src/ledger.ts', 'function reconcileLedger(): number { return 1; }\nexport const ledger = reconcileLedger();\n');
  write('app/packages/a/src/index.ts', "import { ledger } from './ledger.js';\nexport const a = ledger;\n");
  write('app/packages/b/package.json', JSON.stringify({ name: '@t/b', exports: { '.': './src/index.ts' }, dependencies: { '@t/a': '*' } }));
  write('app/packages/b/src/index.ts', "import { shared } from '@t/shared';\nimport { a } from '@t/a';\nexport const b = a + shared;\n");
  mkdirSync(join(root, 'app/node_modules/@t'), { recursive: true });
  symlinkSync('../../../shared', join(root, 'app/node_modules/@t/shared'));
  symlinkSync('../../packages/a', join(root, 'app/node_modules/@t/a'));
  symlinkSync('../../packages/b', join(root, 'app/node_modules/@t/b'));
  for (const args of [['init', '--quiet', '--initial-branch', 'main'], ['config', 'user.email', 'fixture@example.test'], ['config', 'user.name', 'Fixture'], ['add', '-A'], ['commit', '--quiet', '-m', 'the checkout']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  process.chdir(join(root, 'app'));
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask classify', () => {
  it('places each named package and export in the area that lists its package, at its dependency layer', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'why does shop-2 call data1?']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^shop-2 — package @t\/shop-2 · area 4 packages\/shop\/ shop · layer 3$/m);
    expect(asked.out).toMatch(/^data1 — export @t\/data-1 · area 3 packages\/data\/ data · layer 2$/m);
    expect(asked.out).toMatch(/^Not entities: why does call$/m);
    expect(asked.out).toContain('variance ask symbol --name data1');
  });

  it('names a private package that publishes nothing, as the map holds it', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'what does case-runner run?']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^case-runner — package @t\/case-runner · (area \S+ .+|in no area) · layer 2$/m);
    expect(asked.out).not.toContain('variance ask entrypoint --package @t/case-runner');
  });

  it('ranks only the files a start point reaches along the imports, and says which', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'shop admin', '--from', 'packages/shop/shop-4/src/index.ts']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toContain('In 5 file(s) reachable from `packages/shop/shop-4/src/index.ts` along the imports');
    expect(asked.out).toMatch(/^ {2}\. — 5 files · holds shop$/m);
    expect(asked.out).toContain("variance ask search --query shop --from packages/shop/shop-4/src/index.ts\n");
  });

  it('reads the names a file keeps to itself as its area\'s words, as it reads the exported ones', async () => {
    const root = families();
    writeFileSync(join(root, 'packages/admin/admin-0/src/ledger.ts'), 'function reconcileLedger(): void {}\nreconcileLedger();\n');
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'a ledger'], { cwd: root, stdio: 'pipe' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'reconcile']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^ {2}\. — \d+ files · holds reconcile$/m);
  });

  it('ranks the reached files of a nested workspace whose members reach beside it, named from the workspace', async () => {
    nested();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'reconcile', '--from', 'packages/b/src/index.ts']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^ {2}\S+ — \d+ files · holds reconcile$/m);
  });
});
