import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '@variance-authority/sense/instrument';
import { landRun, testCoverageFile, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';

/**
 * A test a partial run left out stands on the text it last ran, and its rows
 * are carried onto the text the run recorded. What changed between the two is
 * read from both texts for it, as the change in the tree is: it is charged the
 * regions it entered that differ, and nothing else in a file it loaded. These
 * cases record real regions, a function each test runs, through `landRun`, the
 * way the seam does, and read them through `variance select`.
 */
describe('what changed after a test last ran is read region by region', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-regions-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
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
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}`);
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

/** The line `offset` falls on in `text`, counted from 1. */
const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/**
 * What a run records: the tests it ran, and the regions of each module they
 * loaded as the instrument cuts them from the text on disk. Every test that
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
      const cut = instrument(text, file, file, { mode: 'presence' })!;
      const loaders = names.filter((name) => (loads[name] ?? 'src/shared.ts') === file);
      return {
        file,
        sourceDigest: cut.sourceDigest,
        instrumented: true,
        blocks: cut.blocks.map((block) => ({
          ordinal: block.ordinal,
          kind: block.kind,
          ...(block.owner === undefined ? {} : { owner: block.owner }),
          digest: block.digest,
          name: block.name,
          path: block.path,
          startLine: lineAt(text, block.start),
          endLine: lineAt(text, block.end > block.start ? block.end - 1 : block.end),
          source: block.end > block.start,
          testFiles: loaders
            .filter((name) => block.kind === 'module' || block.name === `for${name[0]!.toUpperCase()}${name.slice(1)}`)
            .map((name) => `test/${name}.test.ts`),
        })),
      };
    }),
  };
}
