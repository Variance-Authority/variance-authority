import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';

/**
 * `vitest $(variance select --format vitest)` in a monorepo, asked of vitest.
 *
 * The record names a file from the top of the checkout. Vitest globs a
 * project's test files from the directory it runs in and matches each
 * `--exclude` against that directory, so in a package with a vitest of its own
 * the two count from different places. Only vitest can say whether an exclusion
 * matched, so these hand select's answer to the vitest this repository installs
 * and read back the files it would run.
 */
describe('select against a vitest run from a package of a monorepo', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-vitest-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('excludes the skipped files of a package whose vitest runs from the package', async () => {
    const top = monorepo({ 'packages/app/vitest.config.mjs': 'export default { test: {} };\n' });
    const app = join(top, 'packages/app');

    const said = await skipFrom(top, app);

    expect(listed(app, said)).toEqual(['test/beta.test.mjs']);
    expect(listed(app, '')).toEqual(['test/alpha.test.mjs', 'test/beta.test.mjs', 'test/gamma.test.mjs']);
  }, 60_000);

  it('excludes them when the config at the top sets the package as the root, and select runs there', async () => {
    const top = monorepo({ 'vitest.config.mjs': "export default { root: 'packages/app', test: {} };\n" });

    const said = await skipFrom(top, join(top, 'packages/app'));

    expect(listed(top, said)).toEqual(['test/beta.test.mjs']);
  }, 60_000);

  it('excludes them when vitest and select both run from the top of the checkout', async () => {
    const top = monorepo({ 'vitest.config.mjs': 'export default { test: {} };\n' });

    const said = await skipFrom(top, top);

    expect(listed(top, said)).toEqual(['test/beta.test.mjs']);
  }, 60_000);
});

const SOURCE = ['export function widget(): string {', "  return 'a';", '}', '', 'export function other(): string {', "  return 'b';", '}', ''].join('\n');
const TESTS = ['alpha', 'beta', 'gamma'].map((name) => `packages/app/test/${name}.test.mjs`);
const VITEST = resolve(fileURLToPath(new URL('../../../..', import.meta.url)), 'node_modules/vitest');

/** A checkout whose one package holds the module and the three tests the record names. */
function monorepo(files: Readonly<Record<string, string>>): string {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'va-select-vitest-')));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: top, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const all = {
    '.gitignore': 'node_modules\n',
    'packages/app/src/widget.ts': SOURCE,
    ...Object.fromEntries(TESTS.map((test) => [test, "import { it } from 'vitest';\nit('runs', () => {});\n"])),
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(join(top, file, '..'), { recursive: true });
    writeFileSync(join(top, file), text);
  }
  mkdirSync(join(top, 'node_modules'));
  symlinkSync(realpathSync(VITEST), join(top, 'node_modules/vitest'));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return top;
}

/** What select prints from `from` after `other` changes, which only beta entered. */
async function skipFrom(top: string, from: string): Promise<string> {
  await writeTestCoverage(testCoverageFile(top), recorded(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: top, encoding: 'utf8' }).trim()));
  writeFileSync(join(top, 'packages/app/src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
  process.chdir(top);
  await indexOutput({ cwd: top });
  const said = await selectOutput({ cwd: from, format: 'vitest' });
  expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
  return said.out;
}

/** The test files `vitest list --filesOnly` collects from `at`, handed `said` as select printed it. */
function listed(at: string, said: string): string[] {
  const out = execFileSync(process.execPath, [join(VITEST, 'vitest.mjs'), 'list', '--filesOnly', ...said.split('\n').filter(Boolean)], {
    cwd: at,
    encoding: 'utf8',
  });
  return out.split('\n').flatMap((line) => line.match(/test\/\w+\.test\.mjs/)?.[0] ?? []).sort();
}

/** One module, two functions, three tests: alpha entered `widget`, beta entered `other`, gamma entered nothing. */
function recorded(commit: string): TestCoverage {
  const block = (ordinal: number, name: string, startLine: number, endLine: number, testFiles: readonly string[]) => ({
    ordinal,
    kind: ordinal === 0 ? ('module' as const) : ('function' as const),
    ...(ordinal === 0 ? {} : { owner: 0 }),
    digest: digestString(name),
    name,
    path: ordinal === 0 ? 'module' : name,
    startLine,
    endLine,
    source: true,
    testFiles: [...testFiles],
  });
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: TESTS.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      {
        file: 'packages/app/src/widget.ts',
        sourceDigest: digestString(SOURCE),
        instrumented: true,
        blocks: [
          block(0, 'widget.ts', 1, 8, TESTS.slice(0, 2)),
          block(1, 'widget', 1, 3, TESTS.slice(0, 1)),
          block(2, 'other', 5, 7, TESTS.slice(1, 2)),
        ],
      },
    ],
  };
}
