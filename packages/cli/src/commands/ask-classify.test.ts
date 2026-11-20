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
    expect(asked.out).toMatch(/^shop-2 — package @t\/shop-2 · area 3 packages\/shop\/ shop · layer 3$/m);
    expect(asked.out).toMatch(/^data1 — export @t\/data-1 · area 2 packages\/data\/ data · layer 2$/m);
    expect(asked.out).toMatch(/^Not entities: why does call$/m);
    expect(asked.out).toContain('variance ask symbol --name data1');
  });
});
