import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * `variance select` over a diff that moved the install and no source line.
 *
 * A bumped package changes no line a test covered, so a journal read over the
 * diff alone reaches nobody and hands the runner every test it recorded as a
 * skip. The install is compared at the diff's base, and the moved names are
 * answered by the measured modules that import them; a lockfile that cannot be
 * compared skips nothing.
 */
describe('a diff that moved the install', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    // Every journal these cases write is addressed through this, so none of them
    // can read or overwrite the recording this repository keeps for itself.
    process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-select-install-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['XDG_CACHE_HOME'];
  });

  it('runs the tests that entered a module importing the bumped package', async () => {
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0') });
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    // `beta` entered `src/pad.ts`, which imports `left-pad`; the other two never
    // did, and the lockfile the comparison already answered is named nowhere.
    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).not.toContain('package-lock.json');
  });

  it('skips nothing when the install cannot be compared', async () => {
    // No lockfile at the base, one in the tree: any package in it may have
    // moved, and nothing here can say which.
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('package-lock.json is not in the tree at the base of this diff');
  });
});

const PAD = [
  "import leftPad from 'left-pad';",
  '',
  'export function pad(text: string): string {',
  '  return leftPad(text, 4);',
  '}',
  '',
].join('\n');

function npmLock(version: string): string {
  return JSON.stringify(
    {
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
    },
    null,
    2,
  );
}

/** A checkout holding exactly the text the snapshot below is recorded against. */
function checkout(files: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-install-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/pad.ts'), PAD);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);

  return { root, head: git(['rev-parse', 'HEAD']) };
}

/** One module importing one package, entered by one of three tests. */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/alpha.test.ts', complete: true, preconditions: [] },
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
      { file: 'test/gamma.test.ts', complete: true, preconditions: [] },
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
            endLine: 6,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
        ],
      },
    ],
  };
}
