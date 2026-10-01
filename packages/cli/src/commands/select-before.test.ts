import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * `variance select` over a diff that moved what a suite rests on.
 *
 * The runner config, the setup it loads and the packages those import run
 * before any test does, and no test's recording holds a line of them. Declared
 * as the suite's `before`, or the repository's, each is walked forward, and a
 * change anywhere in that closure runs the whole suite. Undeclared, nothing
 * says the suite rests on it, and the record answers as it would for any file.
 */
describe('a diff that moved what the suite rests on', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-before-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs every test when the setup the declared config loads changed', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit', before: ['vitest.config.ts'] } } });

    write(root, 'test/setup.ts', "import 'left-pad';\nexport const ready = 2;\n");
    const said = await select(root);

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('the suite unit rests on test/setup.ts before any test imports it');
  });

  it('runs every test when a package the setup imports was bumped', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit', before: ['vitest.config.ts'] } } });

    write(root, 'package-lock.json', npmLock('1.4.0'));
    const said = await select(root);

    expect(said.out).toBe('');
    expect(said.err).toContain('the suite unit rests on left-pad before any test imports it');
  });

  it('runs every test when a file the repository declares for every suite changed', async () => {
    const root = await recorded({ before: ['.nvmrc', '.github/workflows'], suites: { unit: { kind: 'unit' } } });

    write(root, '.github/workflows/test.yml', 'on: [push, pull_request]\n');
    const said = await select(root);

    expect(said.out).toBe('');
    expect(said.err).toContain('rests on .github/workflows/test.yml');
  });

  it('reads an undeclared setup like any other file, and says nothing is declared', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit' } } });

    write(root, 'test/setup.ts', "import 'left-pad';\nexport const ready = 2;\n");
    const said = await select(root);

    // No test entered the setup, and nothing says the suite rests on it.
    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\n');
    expect(said.err).toContain('the suite unit declares nothing before reach');
  });

  it('narrows as before when the diff moved nothing the suite rests on', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit', before: ['vitest.config.ts'] } } });

    write(root, 'src/pad.ts', PAD.replace('padStart(4', 'padStart(5'));
    const said = await select(root);

    expect(said.out).toBe('test/alpha.test.ts\n');
    expect(said.err).not.toContain('rests on');
  });
});

const PAD = ['export function pad(text: string): string {', "  return text.padStart(4, ' ');", '}', ''].join('\n');

const FILES: Readonly<Record<string, string>> = {
  'src/pad.ts': PAD,
  'vitest.config.ts': "export default { test: { setupFiles: ['./test/setup.ts'] } };\nimport './test/setup.ts';\n",
  'test/setup.ts': "import 'left-pad';\nexport const ready = 1;\n",
  'package.json': JSON.stringify({ name: 'fixture', dependencies: { 'left-pad': '^1.0.0' } }),
  '.nvmrc': '22\n',
};

/** A checkout with `config` at its root, its index built, and a record of two tests at its head. */
async function recorded(config: unknown): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-before-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  for (const [file, text] of Object.entries(FILES)) write(root, file, text);
  write(root, 'package-lock.json', npmLock('1.3.0'));
  write(root, 'variance.config.json', JSON.stringify(config));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), snapshot(git(['rev-parse', 'HEAD'])));
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}

async function select(root: string) {
  return await selectOutput({ cwd: root, format: 'plain', suite: 'unit' });
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

function npmLock(version: string): string {
  return JSON.stringify({
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture', dependencies: { 'left-pad': '^1.0.0' } },
      'node_modules/left-pad': {
        version,
        resolved: `https://registry.npmjs.org/left-pad/-/left-pad-${version}.tgz`,
        integrity: `sha512-${version}==`,
      },
    },
  });
}

/** One module, entered by one of two tests; the setup is entered by none. */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/alpha.test.ts', complete: true, preconditions: [] },
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
    ],
    modules: [
      {
        file: 'src/pad.ts',
        sourceDigest: digestString(PAD),
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: digestString('module'),
            name: 'pad.ts',
            path: 'module',
            startLine: 1,
            endLine: 4,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
          {
            ordinal: 1,
            kind: 'function',
            owner: 0,
            digest: digestString('pad'),
            name: 'pad',
            path: 'pad',
            startLine: 1,
            endLine: 3,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
        ],
      },
    ],
  };
}
