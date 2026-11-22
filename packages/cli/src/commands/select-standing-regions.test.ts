import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { landRun, sourceCut, testCoverageFile, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';
import { diffSince, diffToTree } from './since.js';

// Spied, not replaced: one case edits the tree after select's first diff of it, and every diff stays git's.
vi.mock('./since.js', async (original) => {
  const actual = await original<typeof import('./since.js')>();
  return { ...actual, diffSince: vi.fn(actual.diffSince), diffToTree: vi.fn(actual.diffToTree) };
});

/**
 * A test a partial run left out is charged what changed from the text it last
 * ran to the tree, region by region. Regions are recorded through `landRun`
 * and read through `variance select`.
 */
describe('what changed after a test last ran is read region by region', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-regions-cache-')));
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.mocked(diffSince).mockReset();
    vi.mocked(diffToTree).mockReset();
  });

  it('skips a test for an edit, committed after it ran, to a function only another test runs', async () => {
    // Both tests load `shared.ts`; `far` runs `forFar`, `near` runs `forNear`.
    // C edits `forNear` and runs `near` alone, a commit follows, and the tree edits it again.
    const repo = checkout();
    const P = repo.commit({ ...TESTS, 'src/shared.ts': shared('n + 1', 'n * 2') }, 'P');
    await landRun(repo.file, run(repo.root, P, ['far', 'near']), repo.root);
    const C = repo.commit({ 'src/shared.ts': shared('n + 1', 'n * 3') }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);
    repo.commit({ 'src/shared.ts': shared('n + 1', 'n * 4') }, 'D');
    writeFileSync(join(repo.root, 'src/shared.ts'), shared('n + 1', 'n * 5'));

    const said = await repo.select();

    expect(said.out).toBe('test/far.test.ts\n');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}, before the journal's commit ${C.slice(0, 12)}, so it is charged what changed from ${P.slice(0, 12)} to the tree, read in the journal's lines`);
  });

  it('runs a test for an edit, committed after it ran, to a function it ran in a file the run did not load', async () => {
    // `far` alone loads `shared.ts`, so the run at C re-cuts its rows onto C's
    // text and carries the crossing on `forFar` there.
    const repo = checkout();
    const P = repo.commit({ ...TESTS, 'src/shared.ts': shared('n + 1', 'n * 2'), 'src/near.ts': NEAR }, 'P');
    await landRun(repo.file, run(repo.root, P, ['far', 'near'], { near: 'src/near.ts' }), repo.root);
    repo.commit({ 'src/shared.ts': shared('n + 2', 'n * 2') }, 'C');
    await landRun(repo.file, run(repo.root, repo.git('rev-parse', 'HEAD'), ['near'], { near: 'src/near.ts' }), repo.root);

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
  });

  it('skips a test for an edit, committed after it ran, to a function nobody ran in a file the run did not load', async () => {
    const repo = checkout();
    const P = repo.commit({ ...TESTS, 'src/shared.ts': shared('n + 1', 'n * 2'), 'src/near.ts': NEAR }, 'P');
    await landRun(repo.file, run(repo.root, P, ['far', 'near'], { near: 'src/near.ts' }), repo.root);
    repo.commit({ 'src/shared.ts': shared('n + 1', 'n * 3') }, 'C');
    await landRun(repo.file, run(repo.root, repo.git('rev-parse', 'HEAD'), ['near'], { near: 'src/near.ts' }), repo.root);

    const said = await repo.select();

    expect(said.out).toBe('test/far.test.ts\ntest/near.test.ts\n');
  });

  it('skips a test for a comment the tree writes in a function it ran, in a file the run after it did not move', async () => {
    // `far` stands at P, and `shared.ts` is the same at P and at C, where `near` alone ran.
    const repo = checkout();
    const P = repo.commit({ ...TESTS, 'test/near.test.ts': "import '../src/near.js';\n", 'src/shared.ts': shared('n + 1', 'n * 2'), 'src/near.ts': NEAR }, 'P');
    await landRun(repo.file, run(repo.root, P, ['far', 'near'], { near: 'src/near.ts' }), repo.root);
    repo.commit({ 'src/near.ts': 'export const near = 2;\n' }, 'C');
    await landRun(repo.file, run(repo.root, repo.git('rev-parse', 'HEAD'), ['near'], { near: 'src/near.ts' }), repo.root);
    writeFileSync(join(repo.root, 'src/shared.ts'), shared('/* a comment */ n + 1', 'n * 2'));

    const said = await repo.select();

    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}`);
    expect(said.out).toBe('test/far.test.ts\ntest/near.test.ts\n');
  });

  it('runs a test for an edit to a function it ran, when the tree changes while select reads it', async () => {
    // `far` runs `forFar` and last ran at P; C runs `near` alone. The comments
    // above `forFar` go while select reads: either tree alone runs `far`, and
    // only two trees read as one could skip it.
    const nearFirst = (far: string): string => `export function forNear(n) {\n  return n * 2;\n}\n\nexport function forFar(n) {\n  return ${far};\n}\n`;
    const repo = checkout();
    const P = repo.commit({ ...TESTS, 'src/shared.ts': nearFirst('n + 1') }, 'P');
    await landRun(repo.file, run(repo.root, P, ['far', 'near']), repo.root);
    const C = repo.commit({ 'notes.txt': 'unrelated\n' }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);
    writeFileSync(join(repo.root, 'src/shared.ts'), `// a\n// b\n// c\n// d\n${nearFirst('n + 9')}`);
    const actual = await vi.importActual<typeof import('./since.js')>('./since.js');
    const settle = (): void => writeFileSync(join(repo.root, 'src/shared.ts'), nearFirst('n + 9'));
    vi.mocked(diffSince).mockImplementation(async (ref, roots, from, options) => {
      const read = await actual.diffSince(ref, roots, from, options);
      if (from === C) settle();
      return read;
    });
    vi.mocked(diffToTree).mockImplementation(async (from, tree, options) => {
      const read = await actual.diffToTree(from, tree, options);
      if (from === C) settle();
      return read;
    });

    const said = await repo.select();

    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}, before the journal's commit ${C.slice(0, 12)}`);
    expect(said.out).toBe('');
  });

  it('runs a test whose file the tree changes in mode alone since it ran', async () => {
    // `far` stands at P; C edits `forNear` and runs `near` alone. The tree puts
    // P's text back and makes the file executable: from P only the mode moved,
    // which no line of it says, so `far` is charged the whole file.
    const repo = checkout();
    const P = repo.commit({ ...TESTS, 'src/shared.ts': shared('n + 1', 'n * 2') }, 'P');
    await landRun(repo.file, run(repo.root, P, ['far', 'near']), repo.root);
    const C = repo.commit({ 'src/shared.ts': shared('n + 1', 'n * 3') }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);
    writeFileSync(join(repo.root, 'src/shared.ts'), shared('n + 1', 'n * 2'));
    chmodSync(join(repo.root, 'src/shared.ts'), 0o755);
    expect(repo.git('diff', P, '--', 'src/shared.ts')).toContain('new mode 100755');

    const said = await repo.select();

    expect(said.out).toBe('');
  });

  // The run at C lands over a tree holding `held` in `shared.ts`, which it did
  // not load, so the landing keeps that text for `far`'s carried rows, which
  // were never re-cut. The tree is then put back to C, which `far` never ran.
  it.each([
    ['the text it ran', shared('n + 1', 'n * 2')],
    ['a text that differs from it only in a function nobody ran', shared('n + 1', 'n * 9')],
  ])('runs a test whose file the run after it landed over %s, with the tree back at the commit', async (_, held) => {
    const repo = checkout();
    const S = repo.commit({ ...TESTS, 'src/shared.ts': shared('n + 1', 'n * 2'), 'src/near.ts': NEAR }, 'S');
    await landRun(repo.file, run(repo.root, S, ['far', 'near'], { near: 'src/near.ts' }), repo.root);
    const C = repo.commit({ 'src/shared.ts': shared('n + 2', 'n * 2') }, 'C');
    writeFileSync(join(repo.root, 'src/shared.ts'), held);
    await landRun(repo.file, run(repo.root, C, ['near'], { near: 'src/near.ts' }), repo.root);
    repo.git('checkout', '--', 'src/shared.ts');

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
  });
});

const TESTS = {
  'test/far.test.ts': "import '../src/shared.js';\n",
  'test/near.test.ts': "import '../src/shared.js';\n",
};

const NEAR = 'export const near = 1;\n';

/** Two functions, `forFar` and `forNear`, returning the expressions given. */
function shared(far: string, near: string): string {
  return `export function forFar(n) {\n  return ${far};\n}\n\nexport function forNear(n) {\n  return ${near};\n}\n`;
}

/** A repository with its journal, committing whatever is written into it. */
function checkout(root = mkdtempSync(join(tmpdir(), 'va-select-regions-'))) {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  return {
    root,
    git,
    file: testCoverageFile(root),
    commit(files: Readonly<Record<string, string>>, message: string): string {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      git('add', '-A');
      git('commit', '--quiet', '-m', message);
      return git('rev-parse', 'HEAD');
    },
    async select() {
      process.chdir(root);
      await indexOutput({ cwd: root });
      return await selectOutput({ cwd: root, format: 'plain' });
    },
  };
}

/**
 * What a run records: the tests it ran, and the regions of each module they
 * loaded as a seam cuts them from the text on disk (`sourceCut`). Every test that
 * loaded a module enters its root, and a test enters a function named for it:
 * `far` enters `forFar`. `loads` names the module a test loads instead of
 * `src/shared.ts`.
 */
function run(root: string, commit: string, names: readonly string[], loads: Readonly<Record<string, string>> = {}): TestCoverage {
  const files = [...new Set(names.map((name) => loads[name] ?? 'src/shared.ts'))].sort();
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: names.map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: files.map((file) => {
      const text = readFileSync(join(root, file), 'utf8');
      const cut = sourceCut(text, file, 'presence')!;
      const loaders = names.filter((name) => (loads[name] ?? 'src/shared.ts') === file);
      return {
        file,
        sourceDigest: cut.sourceDigest,
        instrumented: true,
        blocks: cut.rows.map((row) => ({
          ...row,
          testFiles: loaders
            .filter((name) => row.kind === 'module' || row.name === `for${name[0]!.toUpperCase()}${name.slice(1)}`)
            .map((name) => `test/${name}.test.ts`),
        })),
      };
    }),
  };
}
