import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { landRun, testCoverageFile, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * A partial run landed over an edit, then a selection on the same edit: the
 * agent's loop of edit, run one file, select again.
 *
 * The landing moves the record to the edited text, so the selection after it
 * reads no diff for the file, and every test the record carries from before the
 * edit is answered by whether the landing demoted it. The selection should
 * charge what the record before the landing would have charged for the same
 * edit, less the tests the partial run just ran over it: a body edit runs the
 * tests that entered the edited body, and not every test that loaded the file.
 *
 * Any edit to a module moves the digest of the module's own region, so each case
 * below moves it, as every real edit does.
 */
describe('selecting after a partial run over an edit', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-partial-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs every test that loaded a module whose load sequence a partial run recorded over', async () => {
    // A top-level call runs as the module loads, so `delta`, which only loaded
    // it, ran different code than it will now.
    const said = await afterPartialRun(`${SOURCE}widget();\n`, ['module']);

    expect(said.out).toBe('test/beta.test.ts\ntest/gamma.test.ts\n');
  });

  it('runs the tests that entered a body a partial run recorded over, and skips those that only loaded it', async () => {
    // `alpha` entered `widget`, which the edit changed. `delta` loaded the
    // module and entered nothing in it, so nothing it ran moved.
    const said = await afterPartialRun(SOURCE.replace("return 'a';", "return 'A';"), ['module', 'widget']);

    expect(said.out).toBe('test/beta.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });

  it('skips the tests that ran a module whose runtime text a partial run did not move', async () => {
    // A type annotation is not code: every test ran the program it would run now.
    const said = await afterPartialRun(SOURCE.replace('widget(): string', 'widget(): "a"'), ['module', 'widget']);

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });
});

/**
 * Land the full record at the commit, write `edited` over the module, land a
 * run of `beta` alone over it with the named regions' digests moved, and select.
 */
async function afterPartialRun(edited: string, moved: readonly string[]) {
  const { root, head } = checkout();
  await landRun(testCoverageFile(root), snapshot(head), root);

  writeFileSync(join(root, 'src/widget.ts'), edited);
  const recorded = snapshot(head);
  const [module] = recorded.modules;
  await landRun(testCoverageFile(root), {
    ...recorded,
    tests: recorded.tests.filter((test) => test.file === 'test/beta.test.ts'),
    modules: [{
      ...module!,
      sourceDigest: digestString(edited),
      blocks: module!.blocks.map((block) => ({
        ...block,
        digest: moved.includes(block.path) ? digestString(`${block.path}, edited`) : block.digest,
        testFiles: block.testFiles.filter((test) => test === 'test/beta.test.ts'),
      })),
    }],
  }, root);
  process.chdir(root);

  await indexOutput({ cwd: root });
  return selectOutput({ cwd: root, format: 'plain' });
}

const SOURCE = [
  'export function widget(): string {',
  "  return 'a';",
  '}',
  '',
  'export function other(): string {',
  "  return 'b';",
  '}',
  '',
].join('\n');

/** A checkout holding exactly the text the snapshot below is recorded against. */
function checkout(): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-partial-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

/**
 * One module, two functions, four tests: `alpha` entered `widget`, `beta`
 * entered `other`, `delta` loaded the module and entered neither, and `gamma`
 * entered nothing at all.
 */
function snapshot(commit: string): TestCoverage {
  const loaders = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/delta.test.ts'];
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: ['alpha', 'beta', 'delta', 'gamma'].map((name) => ({
      file: `test/${name}.test.ts`,
      complete: true,
      preconditions: [],
    })),
    modules: [
      {
        file: 'src/widget.ts',
        sourceDigest: digestString(SOURCE),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: digestString('module'), name: 'widget.ts', path: 'module', startLine: 1, endLine: 8, source: true, testFiles: loaders },
          { ordinal: 1, kind: 'function', owner: 0, digest: digestString('widget'), name: 'widget', path: 'widget', startLine: 1, endLine: 3, source: true, testFiles: ['test/alpha.test.ts'] },
          { ordinal: 2, kind: 'function', owner: 0, digest: digestString('other'), name: 'other', path: 'other', startLine: 5, endLine: 7, source: true, testFiles: ['test/beta.test.ts'] },
        ],
      },
    ],
  };
}
