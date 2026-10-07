import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput, selectSuite } from './select-command.js';

/**
 * A module the record holds under its built name.
 *
 * The recorder names a built module by its source through the `.js.map` beside
 * it. A module that holds only types compiles to `export {};` with a map that
 * has no mappings, so the record keeps the `dist` name: in this repository,
 * `packages/core/dist/artifact.js`. A package's own tests load the source, so
 * the same file can be held under both names. An edit names the source, and a
 * test that loaded only the built copy is still one the edit can reach.
 */

const OWN = 'packages/lib/test/own.test.ts';
const VIA_BUILD = 'packages/app/test/via-build.test.ts';
const OTHER = 'packages/app/test/other.test.ts';
const KINDS = "export type Kind = 'a';\n";
const LOADED = "export type Kind = 'a';\nglobalThis.kinds = ['a'];\n";
const BUILT = 'export {};\n';
const OTHER_TEXT = 'export const other = 1;\n';

describe('a change to a source the record holds under its built name', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-built-name-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('selects the test that loaded only the built copy', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head, false));
    writeFileSync(join(root, 'packages/lib/src/kinds.ts'), LOADED);
    process.chdir(root);
    await indexOutput({ cwd: root });

    const { skip } = await selectSuite({ root });
    const printed = JSON.parse((await selectOutput({ cwd: root, format: 'json' })).out);

    expect([...skip]).toEqual([OTHER]);
    expect(printed.skip).toEqual([OTHER]);
  });

  it('selects it when the package\'s own test holds the source name too', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head, true));
    writeFileSync(join(root, 'packages/lib/src/kinds.ts'), LOADED);
    process.chdir(root);
    await indexOutput({ cwd: root });

    const { skip } = await selectSuite({ root });
    const printed = JSON.parse((await selectOutput({ cwd: root, format: 'json' })).out);

    expect([...skip]).toEqual([OTHER]);
    expect(printed.skip).toEqual([OTHER]);
  });
});

/** A library built into `dist`, its own test on the source, and an app whose test loads the build. */
function checkout(): { root: string; head: string } {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-select-built-name-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\ndist\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    'packages/lib/package.json': JSON.stringify({ name: '@t/lib', exports: { './kinds': './dist/kinds.js' } }),
    'packages/lib/tsconfig.json': JSON.stringify({ compilerOptions: { outDir: './dist', rootDir: './src' } }),
    'packages/lib/src/kinds.ts': KINDS,
    'packages/lib/dist/kinds.js': BUILT,
    'packages/app/package.json': JSON.stringify({ name: '@t/app', dependencies: { '@t/lib': '*' } }),
    'packages/app/src/other.ts': OTHER_TEXT,
    [OWN]: "import '../src/kinds';\n",
    [VIA_BUILD]: "import '@t/lib/kinds';\n",
    [OTHER]: "import '../src/other';\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
  symlinkSync('../../packages/lib', join(root, 'node_modules/@t/lib'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

/** One module loaded by `testFiles`, as a single module region. */
function moduleOf(file: string, text: string, testFiles: readonly string[]): TestCoverage['modules'][number] {
  return {
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [{
      ordinal: 0,
      kind: 'module',
      digest: digestString(file),
      name: '',
      path: 'module',
      startLine: 1,
      endLine: 1,
      source: true,
      testFiles: [...testFiles],
    }],
  };
}

/** The built copy under its own name; with `own`, the package's test on the source as well. */
function snapshot(commit: string, own: boolean): TestCoverage {
  const tests = own ? [OWN, VIA_BUILD, OTHER] : [VIA_BUILD, OTHER];
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: tests.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      ...(own ? [moduleOf('packages/lib/src/kinds.ts', KINDS, [OWN])] : []),
      moduleOf('packages/lib/dist/kinds.js', BUILT, [VIA_BUILD]),
      moduleOf('packages/app/src/other.ts', OTHER_TEXT, [OTHER]),
    ],
  };
}
