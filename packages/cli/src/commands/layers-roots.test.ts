import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

const cwd = process.cwd();
let root: string;
let cache: string;

async function run(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-layers-roots-')));
  cache = mkdtempSync(join(tmpdir(), 'va-layers-roots-cache-'));
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', cache);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write('.gitignore', 'node_modules\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['apps/*', 'platform/*'] }));
  const packages: [string, string[]][] = [
    ['platform/core', []], ['platform/shared', ['core']],
    ['apps/spa', ['shared']], ['apps/ssr', ['shared']], ['apps/tools', ['core']],
    ['apps/unrelated', ['shared']], ['apps/cycle-a', ['cycle-b', 'core']], ['apps/cycle-b', ['cycle-a']],
  ];
  for (const [directory, takes] of packages) {
    const name = directory.split('/')[1]!;
    write(`${directory}/package.json`, JSON.stringify({
      name: `@t/${name}`, exports: './index.ts',
      dependencies: Object.fromEntries(takes.map((take) => [`@t/${take}`, '*'])),
    }));
    write(`${directory}/index.ts`, `${takes.map((take) => `import '@t/${take}';`).join('\n')}\nexport const value = 1;\n`);
    mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
    symlinkSync(`../../${directory}`, join(root, `node_modules/@t/${name}`));
  }
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'the checkout'], { cwd: root });
  process.chdir(root);
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
});

afterAll(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

describe('variance layers from entry packages', () => {
  it('explains repeatable roots and the repository boundary in public help', async () => {
    const answer = await run(['layers', '--help']);
    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('Repeat --package');
    expect(answer.out).toContain('installed packages excluded');
  });

  it('includes a root with no dependencies', async () => {
    const answer = await run(['layers', '--package', '@t/core']);
    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('1 repository package in 1 dependency layer from @t/core');
    expect(answer.out).toContain('\n1 @t/core\n');
    expect(answer.out).not.toContain('@t/shared');
  });

  it('follows one root through shared dependencies outside its directory, excluding unrelated importers', async () => {
    const answer = await run(['layers', '--package', '@t/spa']);
    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.err).toBe('');
    expect(answer.out).toBe([
      '3 repository packages in 3 dependency layers from @t/spa (dependencies included; installed packages excluded).',
      '', '1 @t/core', '2 @t/shared', '3 @t/spa', '',
    ].join('\n'));
  });

  it('unions several entry roots and deduplicates both repeated roots and shared dependencies', async () => {
    const answer = await run(['layers', '--package', '@t/ssr', '--package', '@t/spa', '--package', '@t/tools', '--package', '@t/spa', '--format', 'json']);
    expect(answer.code).toBe(EXIT_CLEAN);
    expect(JSON.parse(answer.out)).toEqual({
      scope: { roots: ['@t/spa', '@t/ssr', '@t/tools'], packageCount: 5, layerCount: 3, boundary: 'repository' },
      packages: [
        { package: '@t/core', layer: 1 }, { package: '@t/shared', layer: 2 }, { package: '@t/tools', layer: 2 },
        { package: '@t/spa', layer: 3 }, { package: '@t/ssr', layer: 3 },
      ],
    });
  });

  it('terminates on a dependency cycle and keeps its existing layer in markdown', async () => {
    const answer = await run(['layers', '--package', '@t/cycle-a', '--format', 'markdown']);
    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toBe([
      '3 repository packages in 2 dependency layers from @t/cycle-a (dependencies included; installed packages excluded).',
      '', '- 1 @t/core', '- 2 @t/cycle-a', '- 2 @t/cycle-b', '',
    ].join('\n'));
  });

  it('refuses an unknown root even when another root exists', async () => {
    const answer = await run(['layers', '--package', '@t/spa', '--package', '@t/missing']);
    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.out).toBe('');
    expect(answer.err).toContain('No package named `@t/missing` in the code map.');
  });

  it('refuses an empty root and a root selection combined with a base comparison', async () => {
    const empty = await run(['layers', '--package', '']);
    expect(empty.code).toBe(EXIT_OPERATOR);
    expect(empty.err).toContain('--package takes a non-empty exact package name.');
    const compared = await run(['layers', '--package', '@t/spa', '--against', 'base.index']);
    expect(compared.code).toBe(EXIT_OPERATOR);
    expect(compared.err).toContain('--package cannot be combined with --against.');
  });
});
