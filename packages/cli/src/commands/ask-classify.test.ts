import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  write('shared/src/index.ts', 'function reconcileShared(): number { return 1; }\nexport const shared = reconcileShared();\n');
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

/** Equal declaration vocabularies, one private, beside a focused package. */
function declarationAreas({ privateArea = 'beta', merged = false }: { privateArea?: string; merged?: boolean } = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-classify-vocabulary-')));
  const names = ['alpha', 'beta', 'gamma'];
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: names }));
  const unrelated = Array.from({ length: 100 }, (_, at) => `function unrelatedName${at}() { return ${at}; }`).join('\n');
  for (const name of names) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'package.json'), JSON.stringify({ name: `@t/${name}`, exports: './index.ts' }));
    const source = `function restartWorker() {}\n${merged ? 'interface restartWorker {}\n' : ''}${name === 'gamma' ? '' : unrelated}`;
    writeFileSync(join(root, name, 'index.ts'), name === privateArea ? `export {};\n${source}` : source.replaceAll('function ', 'export function ').replaceAll('interface ', 'export interface '));
  }
  // Classification splits directories above 500 tracked files into separate areas.
  mkdirSync(join(root, 'padding'));
  for (let at = 0; at < 501; at += 1) writeFileSync(join(root, 'padding', `${at}.txt`), 'padding\n');
  for (const args of [['init', '--quiet', '--initial-branch', 'main'], ['config', 'user.email', 'fixture@example.test'], ['config', 'user.name', 'Fixture'], ['add', '-A'], ['commit', '--quiet', '-m', 'declaration vocabulary']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  process.chdir(root);
  return root;
}


/**
 * A checkout with no manifest at all, as node's is at its root: its names are
 * declared in plain files under `lib/`, and a test file declares one of them too.
 */
function unpackaged(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-classify-unpackaged-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('test/loader.test.js', "'use strict';\n\nclass ModuleLoader {}\n\nnew ModuleLoader();\n");
  write('lib/loader.js', "'use strict';\n\nclass ModuleLoader {\n  load() { return 1; }\n}\n\nmodule.exports = { ModuleLoader };\n");
  write('lib/child_process.js', "'use strict';\n\nfunction spawn() { return 0; }\n\nmodule.exports = { spawn };\n");
  write('lib/checkout.js', "'use strict';\n\nfunction checkoutPath() { return '.'; }\n\nmodule.exports = { checkoutPath };\n");
  write('lib/main.js', "'use strict';\n\nconst { ModuleLoader } = require('./loader');\nconst { spawn } = require('./child_process');\nconst { checkoutPath } = require('./checkout');\n\nmodule.exports = () => [new ModuleLoader(), spawn(), checkoutPath()];\n");
  for (const args of [['init', '--quiet', '--initial-branch', 'main'], ['config', 'user.email', 'fixture@example.test'], ['config', 'user.name', 'Fixture'], ['add', '-A'], ['commit', '--quiet', '-m', 'the checkout']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  process.chdir(root);
  return root;
}

describe('variance ask classify', () => {
  it.each(['alpha', 'beta'])('counts a merged type and value name once regardless of export visibility (%s)', async (privateArea) => {
    const root = declarationAreas({ privateArea, merged: true });
    expect((await run(['index', '--wait'])).code).toBe(EXIT_CLEAN);
    const privateNames = await run(['ask', 'classify', '--query', 'restart worker']);
    expect(privateNames.code).toBe(EXIT_CLEAN);
    const areas = (text: string): string[] => [...text.matchAll(/^ {2}(\S+) — /gm)].map((match) => match[1] ?? '');
    expect(areas(privateNames.out)).toEqual(['gamma', 'alpha', 'beta']);

    const exported = ['export function restartWorker() {}', 'export interface restartWorker {}', ...Array.from({ length: 100 }, (_, at) => `export function unrelatedName${at}() { return ${at}; }`)].join('\n');
    writeFileSync(join(root, privateArea, 'index.ts'), exported);
    expect((await run(['index', '--wait'])).code).toBe(EXIT_CLEAN);
    const exportedNames = await run(['ask', 'classify', '--query', 'restart worker']);
    expect(exportedNames.code).toBe(EXIT_CLEAN);
    expect(areas(exportedNames.out)).toEqual(areas(privateNames.out));
  });

  it('normalizes private and exported declaration vocabularies equally, including names outside the query', async () => {
    const root = declarationAreas();
    expect((await run(['index', '--wait'])).code).toBe(EXIT_CLEAN);
    const privateNames = await run(['ask', 'classify', '--query', 'restart worker']);
    expect(privateNames.code).toBe(EXIT_CLEAN);
    const areas = (text: string): string[] => [...text.matchAll(/^ {2}(\S+) — /gm)].map((match) => match[1] ?? '');

    expect(areas(privateNames.out)).toEqual(['gamma', 'alpha', 'beta']);

    const exported = ['export function restartWorker() {}', ...Array.from({ length: 100 }, (_, at) => `export function unrelatedName${at}() { return ${at}; }`)].join('\n');
    writeFileSync(join(root, 'beta', 'index.ts'), exported);
    expect((await run(['index', '--wait'])).code).toBe(EXIT_CLEAN);
    const exportedNames = await run(['ask', 'classify', '--query', 'restart worker']);
    expect(exportedNames.code).toBe(EXIT_CLEAN);
    expect(areas(exportedNames.out)).toEqual(areas(privateNames.out));
  });

  it('ranks an area by feature words found only in its nested directories', async () => {
    const root = families();
    const feature = join(root, 'packages/tools/tools-0/src/migrations/alpha-to-beta');
    mkdirSync(feature, { recursive: true });
    writeFileSync(join(feature, 'index.ts'), 'export function run(): number { return 1; }\n');
    writeFileSync(join(feature, 'transform.ts'), 'export function rewrite(): number { return 2; }\n');
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'a nested feature'], { cwd: root, stdio: 'pipe' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'alpha beta']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^ {2}\. — \d+ files · holds alpha beta$/m);
  });

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

  it('answers known names with their direct questions and no lexical area fallback', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [query, followup] of [['@t/shop-2', 'entrypoint --package @t/shop-2'], ['data1', 'symbol --name data1']] as const) {
      const asked = await run(['ask', 'classify', '--query', query]);

      expect(asked.code).toBe(EXIT_CLEAN);
      expect(asked.out).toContain(`variance ask ${followup}`);
      expect(asked.out).not.toContain('Areas its words point to');
      expect(asked.out).not.toContain('variance ask search');
    }
  });

  it('ranks only the files a start point reaches along the imports, and says which', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'shop admin', '--from', 'packages/shop/shop-4/src/index.ts']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toContain('In 5 file(s) reachable from `packages/shop/shop-4/src/index.ts` along the imports');
    expect(asked.out).toMatch(/^ {2}\. — 5 files · holds shop$/m);
    expect(asked.out).toContain("variance ask search --query shop --from packages/shop/shop-4/src/index.ts\n");

    for (const direction of ['--from', '--to']) {
      const exact = await run(['ask', 'classify', '--query', 'shop-2', direction, 'packages/shop/shop-2/src/index.ts']);

      expect(exact.code).toBe(EXIT_CLEAN);
      expect(exact.out).toContain('Areas its words point to');
      expect(exact.out).toContain('variance ask search');
      expect(exact.out).toContain(direction === '--from' ? 'reachable from' : 'reaching');
    }
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
    // The shared package the start point reaches declares a name that holds the
    // word too, but it is no tracked path of the workspace, so it ranks nowhere.
    expect(asked.out).not.toMatch(/^ {2}\S*shared\S* — /m);
  });

  it('reads a nested workspace\'s own names from the index its graph was read into, with no start point said', async () => {
    nested();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'reconcile']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^ {2}\S+ — \d+ files · holds reconcile$/m);
  });

  it('ranks nothing and says why when the start point names no file the graph holds', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'shop-2', '--from', 'packages/nowhere/src/index.ts']);

    expect(asked.code).not.toBe(EXIT_CLEAN);
    expect(asked.err + asked.out).toContain('`classify` ranked nothing');
  });

  it('names a declared name of a checkout with no package at the line that declares it, before a test that declares it too', async () => {
    unpackaged();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'ModuleLoader loader']);

    expect(asked.code).toBe(EXIT_CLEAN);
    // `symbol --name ModuleLoader` names the same lines: the binding `lib/main.js` destructures is one of them.
    expect(asked.out).toContain(
      [
        'ModuleLoader — declared lib/loader.js:3 · in no package',
        '             — declared lib/main.js:3 · in no package',
        '             — declared test/loader.test.js:3 · in no package',
      ].join('\n'),
    );
    expect(asked.out).toContain('variance ask symbol --name ModuleLoader');
  });

  it('names a word that is a tracked file\'s base name as that file', async () => {
    unpackaged();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'who spawns child_process']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^child_process — file lib\/child_process\.js · in no package$/m);
    expect(asked.out).toContain('variance ask orient --files lib/child_process.js');
  });

  it('keeps a plain word that is only part of a declared name plain', async () => {
    unpackaged();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const asked = await run(['ask', 'classify', '--query', 'check the checkout']);

    expect(asked.code).toBe(EXIT_CLEAN);
    expect(asked.out).toMatch(/^Not entities: check the checkout$/m);
  });

  it('names the entities and says why no area is ranked when git cannot list the files HEAD holds', async () => {
    const root = families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    rmSync(join(root, '.git'), { recursive: true, force: true });

    const asked = await run(['ask', 'classify', '--query', 'why does shop-2 call data1?']);

    expect(asked.out).toMatch(/^shop-2 — package @t\/shop-2 /m);
    expect(asked.out).toContain('No area is ranked: git could not list the files HEAD holds');
  });
});
