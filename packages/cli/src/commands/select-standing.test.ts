import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  testCoverageFile,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * A runner handed the skip list runs only what it was not told to skip, and
 * that run is laid into the journal and stamps it at `HEAD`. Every test it did
 * not run still stands on the text it last ran on, so a selection read from the
 * journal's commit alone finds nothing changed for it and skips it, however
 * much changed after it last ran. The runs recorded beside the journal say
 * where each test last ran, and these cases lay both down through `landRun`,
 * the way the seam does.
 */
describe('a test that did not run at the journal commit', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-standing-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs where a file it entered changed after it last ran', async () => {
    const { root, P } = await partialRun();

    const said = await selectOutput({ cwd: root, format: 'plain' });

    // `near` ran at the journal's commit, after both edits; `far` last ran at P.
    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain('skipping 1 of 2 test files recorded whole');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}, before the journal's commit`);
  });

  // The process stands in another checkout of the same history, clean: a
  // reading made there finds nothing changed and skips what `cwd` changed.
  it.each([
    ['a worktree', 'edited', ''],
    ['a worktree', 'clean', 'test/near.test.ts\n'],
    ['a clone', 'edited', ''],
    ['a clone', 'clean', 'test/near.test.ts\n'],
  ])('reads the checkout it was asked about, with the process in %s of it, when `cwd` is %s', async (other, tree, skipped) => {
    const { root } = await partialRun();
    // A side effect, so the edit is charged to the module's importers.
    if (tree === 'edited') writeFileSync(join(root, 'src/near.ts'), 'export const near = 2;\nglobalThis.touched = 1;\n');
    const elsewhere = join(mkdtempSync(join(tmpdir(), 'va-select-standing-other-')), 'other');
    if (other === 'a worktree') execFileSync('git', ['worktree', 'add', '--quiet', '--detach', elsewhere, 'HEAD'], { cwd: root });
    else execFileSync('git', ['clone', '--quiet', root, elsewhere]);
    process.chdir(elsewhere);

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe(skipped);
  });

  it('reads the change from the top of the checkout when `cwd` is a directory under it', async () => {
    const { root } = await partialRun();

    const said = await selectOutput({ cwd: join(root, 'test'), format: 'plain' });

    expect(said.out).toBe('test/near.test.ts\n');
  });

  it('reads the change from the top of the checkout when the process and `cwd` are both under it', async () => {
    const { root } = await partialRun();
    process.chdir(join(root, 'test'));

    const said = await selectOutput({ cwd: join(root, 'test'), format: 'plain' });

    expect(said.out).toBe('test/near.test.ts\n');
  });

  it('runs where the runs record does not say where it last ran, and says so', async () => {
    const { root, file } = await partialRun();
    // A record written without `standing`, as a worktree's first partial run
    // writes it: the record cannot say where `far` stood, so it is read from
    // where the runs at this commit started.
    const { standing: _, ...runs } = (await readCommitRuns(file))!;
    writeFileSync(commitRunsFile(file), `${JSON.stringify(runs, null, 2)}\n`);

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain('the runs record beside the snapshot does not say where 1 test(s) last ran');
  });

  it('runs a test that ran on a bump the tree has undone, compared from where it ran', async () => {
    // P installs left-pad 1.3.0 and runs everything; C bumps it to 1.4.0 and
    // runs `near`, which imports it; the tree goes back to 1.3.0. `far` stands
    // at P, on the install the tree has again, and `near` ran on one it has not.
    const repo = checkout();
    const files = { ...sources(1), 'src/near.ts': NEAR_PAD, 'package-lock.json': npmLock('1.3.0') };
    const P = repo.commit(files, 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const C = repo.commit({ 'package-lock.json': npmLock('1.4.0') }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);
    writeFileSync(join(repo.root, 'package-lock.json'), npmLock('1.3.0'));

    const said = await repo.select();

    expect(said.out).toBe('test/far.test.ts\n');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}`);
  });

  it('holds no stand for a test that is no longer on disk, and names it', async () => {
    // `gone` runs at P and is deleted at H, where everything left runs. The
    // journal keeps its row and every run carries it in `standing`.
    const repo = checkout();
    const P = repo.commit(sources(1), 'P');
    await landRun(repo.file, run(repo.root, P, [...NAMES, 'gone']), repo.root);
    rmSync(join(repo.root, 'test/gone.test.ts'));
    const H = repo.commit(sources(2, NAMES), 'H');
    await landRun(repo.file, run(repo.root, H, NAMES), repo.root);
    expect((await readCommitRuns(repo.file))?.standing).toEqual([{ commit: P, files: ['test/gone.test.ts'] }]);

    const said = await repo.select();

    expect(said.err).not.toContain('last ran at');
    expect(said.err).not.toContain(P.slice(0, 12));
    expect(said.err).toContain(`1 test file the runs record places before the journal's commit ${H.slice(0, 12)} is not on disk`);
    expect(said.err).toContain('test/gone.test.ts');
  });

  it('holds a stand for a test git does not list, because it is on disk', async () => {
    // `far` is ignored, as a generated test is: git lists nothing of it, and
    // it ran at P and entered `src/far.ts`, which changes at H.
    const repo = checkout();
    const P = repo.commit({ '.gitignore': 'test/far.test.ts\n', ...sources(1, NAMES) }, 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const H = repo.commit(sources(2, NAMES), 'H');
    await landRun(repo.file, run(repo.root, H, ['near']), repo.root);
    expect(repo.git('ls-files', 'test')).toBe('test/near.test.ts');

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}`);
  });

  it('holds a stand for a test nobody committed', async () => {
    const repo = checkout();
    const { 'test/far.test.ts': far, ...committed } = sources(1, NAMES);
    const P = repo.commit(committed, 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const H = repo.commit({ 'src/far.ts': sources(2, NAMES)['src/far.ts']!, 'src/near.ts': sources(2, NAMES)['src/near.ts']! }, 'H');
    await landRun(repo.file, run(repo.root, H, ['near']), repo.root);
    writeFileSync(join(repo.root, 'test/far.test.ts'), far!);

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
  });

  it('runs a test whose install moved since it ran, where the journal group moved nothing', async () => {
    // P installs left-pad 1.3.0 and runs everything; C installs 1.4.0 and runs
    // only `near`, which does not import it. The tree stays at 1.4.0, so the
    // bump is after `far` ran and before `near` did.
    const repo = checkout();
    const P = repo.commit({ ...sources(1), 'src/far.ts': FAR_PAD, 'package-lock.json': npmLock('1.3.0') }, 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const C = repo.commit({ 'package-lock.json': npmLock('1.4.0') }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}`);
  });

  it('charges a package only to the group whose install it moved', async () => {
    // Both import left-pad. The bump from P to C is behind `far`, which ran at
    // P, and not behind `near`, which ran on it at C.
    const repo = checkout();
    const P = repo.commit({ ...sources(1), 'src/far.ts': FAR_PAD, 'src/near.ts': NEAR_PAD, 'package-lock.json': npmLock('1.3.0') }, 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const C = repo.commit({ 'package-lock.json': npmLock('1.4.0') }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
  });

  it('compares the install at the commit a test ran at, on another line of history', async () => {
    // `far` last ran at S, on a branch off P that installed left-pad 1.4.0.
    // HEAD is back on P's line at 1.3.0, as is the merge base with S, so only S
    // itself holds the install `far` ran on.
    const repo = checkout();
    const P = repo.commit({ ...sources(1), 'src/far.ts': FAR_PAD, 'package-lock.json': npmLock('1.3.0') }, 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    repo.git('checkout', '--quiet', '-b', 'side');
    const S = repo.commit({ 'package-lock.json': npmLock('1.4.0') }, 'S');
    await landRun(repo.file, run(repo.root, S, ['far']), repo.root);
    repo.git('checkout', '--quiet', 'main');
    const H = repo.commit({ 'notes.txt': 'unrelated\n' }, 'H');
    await landRun(repo.file, run(repo.root, H, ['near']), repo.root);
    expect((await readCommitRuns(repo.file))?.standing).toEqual([{ commit: S, files: ['test/far.test.ts'] }]);
    expect(repo.git('merge-base', S, H)).toBe(P);

    const said = await repo.select();

    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain(`1 test file last ran at ${S.slice(0, 12)}`);
  });

  it('names the stand git cannot read, not the oldest one', async () => {
    const { root, file, P } = await partialRun();
    const gone = 'e'.repeat(40);
    const runs = (await readCommitRuns(file))!;
    const standing = [{ commit: P, files: ['test/far.test.ts'] }, { commit: gone, files: ['test/near.test.ts'] }];
    writeFileSync(commitRunsFile(file), `${JSON.stringify({ ...runs, files: [], standing }, null, 2)}\n`);

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain(`cannot read what changed since ${gone}`);
    expect(said.err).toContain(`git could not diff ${gone.slice(0, 12)}, where 1 test(s) last ran, against`);
  });

  it('refuses a runs record that is not JSON, by the file it read', async () => {
    const { root, file } = await partialRun();
    writeFileSync(commitRunsFile(file), '{');

    const refused = selectOutput({ cwd: root, format: 'plain' });

    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(`the runs record at ${commitRunsFile(file)} is not JSON`);
  });

  it('refuses a runs record that is there and cannot be read, rather than reading it as absent', async () => {
    const { root, file } = await partialRun();
    rmSync(commitRunsFile(file));
    mkdirSync(commitRunsFile(file));

    const refused = selectOutput({ cwd: root, format: 'plain' });

    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(`the runs record at ${commitRunsFile(file)} could not be read`);
    await expect(refused).rejects.toThrow('delete it first only if it is a directory');
  });

  it("runs, from a worktree that has not run, what the primary checkout's runs record says last ran before the journal's commit", async () => {
    // Spelled as git spells it, so the worktree finds the primary checkout's layer under the key it was written by.
    const { root, P } = await partialRun(realpathSync(mkdtempSync(join(tmpdir(), 'va-select-standing-'))));
    const worktree = join(mkdtempSync(join(tmpdir(), 'va-select-standing-worktree-')), 'worktree');
    execFileSync('git', ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD'], { cwd: root });
    process.chdir(worktree);
    await indexOutput({ cwd: worktree });

    const said = await selectOutput({ cwd: worktree, format: 'plain' });

    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}, before the journal's commit`);
  });

  it("refuses the primary checkout's unreadable runs record from a worktree without telling it to delete that record", async () => {
    // Spelled as git spells it, so the worktree finds the primary checkout's layer under the key it was written by.
    const { root, file } = await partialRun(realpathSync(mkdtempSync(join(tmpdir(), 'va-select-standing-'))));
    writeFileSync(commitRunsFile(file), '{');
    const worktree = join(mkdtempSync(join(tmpdir(), 'va-select-standing-worktree-')), 'worktree');
    execFileSync('git', ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD'], { cwd: root });
    process.chdir(worktree);

    const refused = selectOutput({ cwd: worktree, format: 'plain' });

    await expect(refused).rejects.toThrow(`the runs record at ${commitRunsFile(file)} is not JSON`);
    await expect(refused).rejects.toThrow("It is another checkout's record: run the suite here, which writes this checkout's own.");
  });

  it('says a runs record that is not JSON went unread under `--diff`, and does not refuse', async () => {
    const { root, file } = await partialRun();
    writeFileSync(commitRunsFile(file), '{');
    const patch = join(mkdtempSync(join(tmpdir(), 'va-select-standing-patch-')), 'change.diff');
    writeFileSync(patch, '');

    const said = await selectOutput({ cwd: root, format: 'plain', diff: patch });

    expect(said.err).toContain(`the runs record at ${commitRunsFile(file)} is not JSON`);
    expect(said.err).toContain("so whether a test file last ran before the journal's commit is not said");
  });

  it('says a patch handed in is not read against where each test last ran', async () => {
    const { root, P } = await partialRun();
    const patch = join(mkdtempSync(join(tmpdir(), 'va-select-standing-patch-')), 'change.diff');
    writeFileSync(patch, '');

    const said = await selectOutput({ cwd: root, format: 'plain', diff: patch });

    expect(said.err).not.toContain(`last ran at ${P.slice(0, 12)}`);
    expect(said.err).toContain('1 test file last ran before the journal\'s commit');
    expect(said.err).toContain('a patch handed in with `--diff` is read as the whole change');
  });

  /** Every test runs at P; `far.ts` and `near.ts` change in H; only `near` runs at H. */
  async function partialRun(at?: string): Promise<{ root: string; file: string; P: string }> {
    const repo = checkout(at);
    const P = repo.commit(sources(1), 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const H = repo.commit(sources(2), 'H');
    await landRun(repo.file, run(repo.root, H, ['near']), repo.root);
    expect(JSON.parse(readFileSync(commitRunsFile(repo.file), 'utf8'))).toMatchObject({
      commit: H,
      over: P,
      files: ['test/near.test.ts'],
      standing: [{ commit: P, files: ['test/far.test.ts'] }],
    });
    process.chdir(repo.root);
    await indexOutput({ cwd: repo.root });
    return { root: repo.root, file: repo.file, P };
  }
});

const NAMES = ['far', 'near'];

const NEAR_PAD = "import leftPad from 'left-pad';\n\nexport const near = leftPad('1', 2);\n";
const FAR_PAD = "import leftPad from 'left-pad';\n\nexport const far = leftPad('1', 2);\n";

/**
 * Each module at `value`, and a test file for each, as the tree holds them. The
 * module writes `value` where its importer can see it, so a change to it is
 * charged to the test that loads the module, from either side of a commit.
 */
function sources(value: number, names: readonly string[] = [...NAMES, 'gone']): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => [
      [`src/${name}.ts`, `export const ${name} = ${value};\nglobalThis.${name} = ${value};\n`],
      [`test/${name}.test.ts`, `import '../src/${name}.js';\n`],
    ]),
  );
}

/** A repository with its journal, committing whatever is written into it. */
function checkout(root = mkdtempSync(join(tmpdir(), 'va-select-standing-'))) {
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

function npmLock(version: string): string {
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
        },
      },
    },
    null,
    2,
  );
}

/**
 * What a run records: the tests it ran, and the module each loaded, with the
 * digest of the text on disk. Recorded under the recipe the seam records with,
 * so the landing re-cuts a carried module whose text moved and keeps its test
 * whole, as it does after a real partial run.
 */
function run(root: string, commit: string, names: readonly string[]): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: names.map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: names.map((name) => ({
      file: `src/${name}.ts`,
      sourceDigest: digestString(readFileSync(join(root, `src/${name}.ts`), 'utf8')),
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module' as const,
          digest: `block:${name}`,
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 1,
          source: true,
          testFiles: [`test/${name}.test.ts`],
        },
      ],
    })),
  };
}
