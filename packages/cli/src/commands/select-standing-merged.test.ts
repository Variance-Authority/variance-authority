import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { landRun, readCommitRuns, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { checkout, NAMES, run, sources } from './select-standing.fixture.js';

/**
 * A branch that ran some tests at its own commit and then merged the commit
 * another test last ran at: that test is charged what changed from where it
 * ran to the tree, never through the journal's commit, which is no descendant
 * of it.
 */
describe('a test that last ran at a commit the branch merged after its own run', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-standing-cache-')));
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
  });

  it('charges nothing for a file HEAD holds as it was where a test last ran, after merging the stand that is no ancestor of the journal', async () => {
    // `far` last ran at M, on main, where `src/far.ts` changed after the branch
    // point B. The branch commits J off B and runs only `near` there, so the
    // journal's commit is J and M is no ancestor of it. HEAD then merges main,
    // so `src/far.ts` at HEAD is M's text: nothing changed for `far`.
    const repo = checkout();
    const B = repo.commit(sources(1, NAMES), 'B');
    const M = repo.commit({ 'src/far.ts': sources(2, NAMES)['src/far.ts']! }, 'M');
    await landRun(repo.file, run(repo.root, M, NAMES), repo.root);
    repo.git('checkout', '--quiet', '-b', 'side', B);
    const J = repo.commit({ 'notes.txt': 'unrelated\n' }, 'J');
    await landRun(repo.file, run(repo.root, J, ['near']), repo.root);
    repo.git('merge', '--quiet', '--no-edit', 'main');
    expect((await readCommitRuns(repo.file))?.standing).toMatchObject([{ commit: M, files: ['test/far.test.ts'] }]);
    expect(repo.git('merge-base', M, J)).toBe(B);
    expect(repo.git('diff', M, 'HEAD', '--', 'src/far.ts')).toBe('');

    await repo.select();
    const said = await selectOutput({ cwd: repo.root, format: 'json' });

    // `src/far.ts` changed from B to M and from J to HEAD, and is equal at M
    // and HEAD, so it is no change for `far`, the only test that loads it.
    // `far` still runs, held in part since the landing at J re-cut its module.
    const answer = JSON.parse(said.out) as { selected: unknown[]; incomplete: string[] };
    expect(answer.incomplete).toEqual(['test/far.test.ts']);
    expect(answer.selected).toEqual([]);
  });

  it('skips a test whose stand and HEAD hold alike a file it imports that the record has no line of, after merging the stand that is no ancestor of the journal', async () => {
    // `far` imports `src/extra.ts`, which no run recorded. Main changes it at M
    // and runs everything there; the branch commits J off B and runs `near`,
    // then merges main. `far` ran on M's `src/extra.ts`, which HEAD holds, and
    // `src/far.ts` is the same at B, M and J, so `far` is held whole and
    // nothing changed for it: it is skipped.
    const repo = checkout();
    const B = repo.commit({ ...sources(1, NAMES), 'src/far.ts': `import './extra.js';\n${sources(1, ['far'])['src/far.ts']!}`, 'src/extra.ts': 'globalThis.extra = 1;\n' }, 'B');
    const M = repo.commit({ 'src/extra.ts': 'globalThis.extra = 2;\n' }, 'M');
    await landRun(repo.file, run(repo.root, M, NAMES), repo.root);
    repo.git('checkout', '--quiet', '-b', 'side', B);
    const J = repo.commit({ 'notes.txt': 'unrelated\n' }, 'J');
    await landRun(repo.file, run(repo.root, J, ['near']), repo.root);
    repo.git('merge', '--quiet', '--no-edit', 'main');
    expect((await readCommitRuns(repo.file))?.standing).toMatchObject([{ commit: M, files: ['test/far.test.ts'] }]);
    expect(repo.git('diff', M, 'HEAD', '--', 'src')).toBe('');
    expect(repo.git('diff', '--name-only', M, J)).toContain('src/extra.ts');

    const said = await repo.select();

    expect(said.out).toBe('test/far.test.ts\ntest/near.test.ts\n');
  });

  it('runs only the tests whose own diff moves a file the suite rests on, after merging the stand that is no ancestor of the journal', async () => {
    // The repository rests on `vitest.config.ts`. Main changes it at M and runs
    // everything there; the branch commits J off B, runs `near`, then merges
    // main. HEAD holds M's config, so it moved for `near`, from J, and not for
    // `far`, from M: only `near` runs.
    const repo = checkout();
    const B = repo.commit({ ...sources(1, NAMES), 'vitest.config.ts': 'export default { a: 1 };\n', 'variance.config.json': '{ "before": ["vitest.config.ts"] }\n' }, 'B');
    const M = repo.commit({ 'vitest.config.ts': 'export default { a: 2 };\n' }, 'M');
    await landRun(repo.file, run(repo.root, M, NAMES), repo.root);
    repo.git('checkout', '--quiet', '-b', 'side', B);
    repo.commit({ 'notes.txt': 'unrelated\n' }, 'J');
    await landRun(repo.file, run(repo.root, repo.git('rev-parse', 'HEAD'), ['near']), repo.root);
    repo.git('merge', '--quiet', '--no-edit', 'main');
    expect((await readCommitRuns(repo.file))?.standing).toMatchObject([{ commit: M, files: ['test/far.test.ts'] }]);
    expect(repo.git('diff', M, 'HEAD', '--', 'vitest.config.ts')).toBe('');

    const said = await repo.select();

    expect(said.out).toBe('test/far.test.ts\n');
  });

  it('charges only what the branch changed since a test last ran, in a file it edits again after merging the stand that is no ancestor of the journal', async () => {
    // `alpha` and `beta` last ran at M, on main, where `alpha`'s function in
    // `src/far.ts` changed after the branch point B. The branch commits J off B
    // and runs only `near` there, then merges main and edits `beta`'s function.
    // From M to HEAD only `beta`'s function changed: `alpha` ran on M's text.
    const repo = checkout();
    const B = repo.commit({ ...sources(1, ['near']), ...twoFunctions(1, 1), 'test/alpha.test.ts': "import '../src/far.js';\n", 'test/beta.test.ts': "import '../src/far.js';\n" }, 'B');
    const M = repo.commit(twoFunctions(2, 1), 'M');
    await landRun(repo.file, twoFunctionsRun(repo.root, M), repo.root);
    repo.git('checkout', '--quiet', '-b', 'side', B);
    const J = repo.commit({ 'notes.txt': 'unrelated\n' }, 'J');
    await landRun(repo.file, run(repo.root, J, ['near']), repo.root);
    repo.git('merge', '--quiet', '--no-edit', 'main');
    repo.commit(twoFunctions(2, 3), 'edit beta');
    expect((await readCommitRuns(repo.file))?.standing).toMatchObject([{ commit: M, files: ['test/alpha.test.ts', 'test/beta.test.ts'] }]);
    expect(repo.git('merge-base', M, J)).toBe(B);

    await repo.select();
    const said = await selectOutput({ cwd: repo.root, format: 'json' });

    const answer = JSON.parse(said.out) as { selected: { test: string }[] };
    expect(answer.selected.map(({ test }) => test)).toEqual(['test/beta.test.ts']);
  });
});

/** `src/far.ts` as two functions, `alpha` returning `a` and `beta` returning `b`. */
function twoFunctions(a: number, b: number): Record<string, string> {
  return { 'src/far.ts': `export function alpha() {\n  return ${a};\n}\n\nexport function beta() {\n  return ${b};\n}\n` };
}

/** A run of `alpha`, `beta` and `near` at `commit`, each of the first two entering its own function of `src/far.ts`. */
function twoFunctionsRun(root: string, commit: string): TestCoverage {
  const near = run(root, commit, ['near']);
  return {
    ...near,
    tests: [...near.tests, ...['alpha', 'beta'].map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] }))],
    modules: [
      ...near.modules,
      {
        file: 'src/far.ts',
        sourceDigest: digestString(readFileSync(join(root, 'src/far.ts'), 'utf8')),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: digestString('module'), name: '', path: 'module', startLine: 1, endLine: 7, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
          { ordinal: 1, kind: 'function', owner: 0, digest: digestString('alpha'), name: 'alpha', path: 'entry', startLine: 1, endLine: 3, source: true, testFiles: ['test/alpha.test.ts'] },
          { ordinal: 2, kind: 'function', owner: 0, digest: digestString('beta'), name: 'beta', path: 'entry', startLine: 5, endLine: 7, source: true, testFiles: ['test/beta.test.ts'] },
        ],
      },
    ],
  };
}
