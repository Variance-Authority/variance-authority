import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';

/**
 * `variance select --at-distance` across a workspace package whose manifest
 * points its entry into `dist`.
 *
 * The test imports the package by name, so the resolver lands on the
 * library's built `index.js` in `dist`, which no build wrote, and the record
 * holds the library's `src`, the name the recorder gives a built module. The
 * graph reads that landing as its source, so the hops are counted in source
 * names on both sides, the import is one hop like any other, and nothing has to
 * fold `dist` onto `src` for `select`. Without the package's `outDir` and
 * `rootDir`, the test reads as unmeasured and runs in the end leg.
 */

const VIA_PACKAGE = 'packages/app/test/via-package.test.ts';
const VIA_PATH = 'packages/app/test/via-path.test.ts';
const WIDGET = ['export function widget(): string {', "  return 'a';", '}', ''].join('\n');
const INDEX = "export { widget } from './widget';\n";

describe('a leg through a package whose manifest exports its built output', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-built-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('counts the import of the package by name as a hop onto its source', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));
    writeFileSync(join(root, 'packages/lib/src/widget.ts'), WIDGET.replace("return 'a';", "return 'z';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const near = JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance: { from: 0, to: 1 } })).out);
    const far = JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance: { from: 2, to: Number.MAX_SAFE_INTEGER } })).out);

    // One hop by the path, two by the package: the package's index re-exports the widget.
    expect(near.distances).toMatchObject([
      { test: VIA_PACKAGE, bearing: 'transitive', hops: 2 },
      { test: VIA_PATH, bearing: 'direct', hops: 1 },
    ]);
    expect(near.skip).toEqual([VIA_PACKAGE]);
    expect(far.skip).toEqual([VIA_PATH]);
  });
});

/** A library package entered through `dist`, and an app whose tests reach it by name and by path. */
function checkout(): { root: string; head: string } {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-select-built-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    'packages/lib/package.json': JSON.stringify({ name: '@t/lib', exports: { '.': './dist/index.js' } }),
    'packages/lib/tsconfig.json': JSON.stringify({ compilerOptions: { outDir: './dist', rootDir: './src' } }),
    'packages/lib/src/index.ts': INDEX,
    'packages/lib/src/widget.ts': WIDGET,
    'packages/app/package.json': JSON.stringify({ name: '@t/app', dependencies: { '@t/lib': '*' } }),
    [VIA_PACKAGE]: "import { widget } from '@t/lib';\nwidget();\n",
    [VIA_PATH]: "import { widget } from '../../lib/src/widget';\nwidget();\n",
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

/** One module whose every region ran under `testFiles`; `named` is a function spanning the whole text. */
function moduleOf(file: string, text: string, lines: number, testFiles: readonly string[], named?: string): TestCoverage['modules'][number] {
  const region = { source: true, startLine: 1, endLine: lines, testFiles: [...testFiles] };
  return {
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [
      { ...region, ordinal: 0, kind: 'module', digest: digestString(file), name: file, path: 'module' },
      ...(named === undefined
        ? []
        : [{ ...region, ordinal: 1, kind: 'function' as const, owner: 0, digest: digestString(named), name: named, path: named }]),
    ],
  };
}

/** The record names the built module by its source, as the recorder does through the source map. */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [VIA_PACKAGE, VIA_PATH].map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      moduleOf('packages/lib/src/index.ts', INDEX, 1, [VIA_PACKAGE]),
      moduleOf('packages/lib/src/widget.ts', WIDGET, 3, [VIA_PACKAGE, VIA_PATH], 'widget'),
    ],
  };
}
