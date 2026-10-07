import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectSuite } from './select-command.js';

/**
 * Where `since` names the base, and where the record's own commit does.
 *
 * A record's line ranges are coordinates in the text of the commit it names, so
 * that commit is the base whenever there is one. `since` names the base only
 * for a record that carries no commit.
 */
describe('the base a selection reads its diff from', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-since-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('reads the diff from `since` for a record that names no commit', async () => {
    const { root } = checkout();
    const { commit: _, ...uncommitted } = snapshot('unused');
    await writeTestCoverage(testCoverageFile(root), uncommitted);
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const { skip } = await selectSuite({ root, since: 'HEAD' });

    // No commit means no text to check the line ranges against, so the changed
    // module is charged whole: both tests that entered it run, and only the one
    // that entered nothing is skipped.
    expect([...skip]).toEqual(['test/gamma.test.ts']);
  });

  it('reads the diff from the record\'s commit, not from a later `since`', async () => {
    const { root, head, git } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));
    // Committed, so a diff from `HEAD` holds nothing and would skip all three.
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    git(['commit', '--quiet', '-am', 'a change after the recorded run']);
    process.chdir(root);
    await indexOutput({ cwd: root });

    const { skip } = await selectSuite({ root, since: 'HEAD' });

    expect([...skip]).toEqual(['test/alpha.test.ts', 'test/gamma.test.ts']);
  });
});

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

function checkout(): { root: string; head: string; git: (args: readonly string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-since-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']), git };
}

/** `widget` entered by alpha, `other` by beta, and gamma entering nothing. */
function snapshot(commit: string): TestCoverage {
  const region = (ordinal: number, name: string, startLine: number, endLine: number, testFiles: string[]) => ({
    ordinal,
    kind: 'function' as const,
    owner: 0,
    digest: digestString(name),
    name,
    path: name,
    startLine,
    endLine,
    source: true,
    testFiles,
  });
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: ['alpha', 'beta', 'gamma'].map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: [
      {
        file: 'src/widget.ts',
        sourceDigest: digestString(SOURCE),
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: digestString('module'),
            name: 'widget.ts',
            path: 'module',
            startLine: 1,
            endLine: 8,
            source: true,
            testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
          },
          region(1, 'widget', 1, 3, ['test/alpha.test.ts']),
          region(2, 'other', 5, 7, ['test/beta.test.ts']),
        ],
      },
    ],
  };
}
