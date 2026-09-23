import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';

/**
 * `variance select --execution` over a change handed in, not read from history.
 *
 * `branch.test.ts` and `other.test.ts` both import `src/decide.ts`; only
 * `branch.test.ts` entered `second`. A patch on a line of `second` skips
 * `other.test.ts`, and the same file named without lines is answered by the
 * import graph, which runs both.
 *
 * `format.ts` has no row and imports the package `left`, which rests on
 * `deep`; only `other.test.ts` imports it. A bump of `deep` in the lockfile is
 * read off the patch's own blobs and walked back through the install.
 *
 * The fixture is the row-per-crossing spelling, which is the one a caller can
 * write, so this reads through `narrowByJourneys`; the addon's reading of the
 * set spelling is held to the same answers in `journey-native.test.ts`.
 */
describe('selecting from a journey file', () => {
  const cwd = process.cwd();
  let root: string;

  beforeEach(() => {
    process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-select-journeys-cache-'));
    root = project();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['XDG_CACHE_HOME'];
  });

  it('skips the test file that never entered the changed function', async () => {
    writeFileSync(join(root, 'change.patch'), patch(6));
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'change.patch', noGit: true });
    expect(said.out).toBe('test/other.test.ts\n');
  });

  it('refuses a list of paths, which carries no line to select by', async () => {
    writeFileSync(join(root, 'names.txt'), 'src/decide.ts\n');
    await expect(selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'names.txt', noGit: true }))
      .rejects.toThrow(/list of paths.*`variance reach`/su);
  });

  it('names a path neither the journey nor the graph knows, and skips every test it does not reach', async () => {
    writeFileSync(join(root, 'change.patch'), added('nowhere.ts'));
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'change.patch', noGit: true });
    expect(said.out).toBe('test/branch.test.ts\ntest/other.test.ts\n');
    expect(said.err).toContain('nowhere.ts');
  });

  it('traces a package bumped deep in the lockfile to the one test file whose imports reach it', async () => {
    git('add', '.');
    git('commit', '-qm', 'before');
    writeFileSync(join(root, 'yarn.lock'), lockfile('1.1.0'));
    git('commit', '-qam', 'bump');
    writeFileSync(join(root, 'change.patch'), git('diff', 'HEAD~1', 'HEAD'));
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'change.patch', noGit: true });
    expect(said.out).toBe('test/branch.test.ts\n');
    expect(said.err).not.toContain('yarn.lock');
  });

  it('keeps every test when the patch changes the lockfile and names no blob to compare', async () => {
    writeFileSync(join(root, 'change.patch'), [
      'diff --git a/yarn.lock b/yarn.lock', '--- a/yarn.lock', '+++ b/yarn.lock', '@@ -1,1 +1,1 @@', '-a', '+b', '',
    ].join('\n'));
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'change.patch', noGit: true });
    expect(said.out).toBe('');
    expect(said.err).toContain('no install to compare');
  });

  function git(...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  }
});

const DECIDE = [
  'export function first(value: number): string {',
  "  return value > 0 ? 'up' : 'down';",
  '}',
  '',
  'export function second(value: number): string {',
  "  return value > 10 ? 'high' : 'low';",
  '}',
  '',
].join('\n');

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'va-select-journeys-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'journeys-fixture', type: 'module' }));
  writeFileSync(join(root, 'src/decide.ts'), DECIDE);
  writeFileSync(join(root, 'src/format.ts'), "import left from 'left';\nexport const format = left;\n");
  writeFileSync(join(root, 'yarn.lock'), lockfile('1.0.0'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'test/branch.test.ts'), "import { first, second } from '../src/decide';\nfirst(1);\nsecond(20);\n");
  writeFileSync(join(root, 'test/other.test.ts'), "import { first } from '../src/decide';\nimport { format } from '../src/format';\nfirst(1);\n");

  const tests = [
    { id: 'test/branch.test.ts > high', file: 'test/branch.test.ts', name: 'high' },
    { id: 'test/other.test.ts > up', file: 'test/other.test.ts', name: 'up' },
  ];
  const crossings = (...tests: number[]) => tests.map((test) => ({ test, distance: 0 }));
  const region = (name: string, startLine: number, endLine: number, entered: ReturnType<typeof crossings>) =>
    ({ kind: 'function', name, path: name, startLine, endLine, source: true, crossings: entered });
  writeFileSync(join(root, 'journeys.bin'), encodeExecutionIndex({
    tests,
    modules: [{
      file: 'src/decide.ts',
      blocks: [region('first', 1, 3, crossings(0, 1)), region('second', 5, 7, crossings(0))],
    }],
  }));
  return root;
}

function patch(line: number): string {
  return [
    'diff --git a/src/decide.ts b/src/decide.ts',
    '--- a/src/decide.ts',
    '+++ b/src/decide.ts',
    `@@ -${line},1 +${line},1 @@`,
    "-  return value > 10 ? 'high' : 'low';",
    "+  return value > 11 ? 'high' : 'low';",
    '',
  ].join('\n');
}

function added(file: string): string {
  return [`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`, '@@ -0,0 +1,1 @@', '+x', ''].join('\n');
}

function lockfile(deep: string): string {
  return [
    '# yarn lockfile v1', '', '',
    'left@^1.0.0:', '  version "1.0.0"', '  resolved "https://registry.yarnpkg.com/left/-/left-1.0.0.tgz#a"',
    '  dependencies:', '    deep "^1.0.0"', '',
    'deep@^1.0.0:', `  version "${deep}"`, `  resolved "https://registry.yarnpkg.com/deep/-/deep-${deep}.tgz#b"`, '',
  ].join('\n');
}
