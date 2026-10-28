import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import type { TestCoverage } from '@variance-authority/sense/test-selection';

/**
 * One checkout whose lockfile pins `left-pad`, one module importing it, and a
 * snapshot of three tests of which one entered that module: what the install
 * comparison of `variance select` is measured over, by every runs record that
 * can name an install.
 */

export const PAD = [
  "import leftPad from 'left-pad';",
  '',
  'export function pad(text: string): string {',
  '  return leftPad(text, 4);',
  '}',
  '',
].join('\n');

/** `left-pad` at `version`, and `pad-core` beneath it when `core` is given. */
export function npmLock(version: string, core?: string): string {
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
          ...(core === undefined ? {} : { dependencies: { 'pad-core': '^2.0.0' } }),
        },
        ...(core === undefined
          ? {}
          : {
              'node_modules/pad-core': {
                version: core,
                resolved: `https://registry.npmjs.org/pad-core/-/pad-core-${core}.tgz`,
                integrity: `sha512-${core}==`,
              },
            }),
      },
    },
    null,
    2,
  );
}

/** A checkout holding exactly the text the snapshot below is recorded against. */
export function checkout(files: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-install-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'src/pad.ts'), PAD);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);

  return { root, head: git(['rev-parse', 'HEAD']) };
}

/** One module importing one package, entered by one of three tests. */
export function snapshot(commit: string): TestCoverage {
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
