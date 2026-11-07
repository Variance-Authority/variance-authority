import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../bin.fixture.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask containment`, through the command a person types, over a
 * history whose every commit is one case: what each touched is written beside
 * it, and the figures below are those lines counted by hand.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-containment-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

function git(args: readonly string[], root: string): void {
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@acme.test', ...args], { cwd: root, stdio: 'pipe' });
}

let edits = 0;

/** Each file changed and committed as `message`, by `author` when one is named. */
function change(root: string, message: string, files: readonly string[], author?: string): void {
  edits += 1;
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `export const edit = ${String(edits)};\n`);
  }
  git(['add', '-A'], root);
  git(['commit', '--quiet', '-m', message, ...(author === undefined ? [] : [`--author=${author} <bot@acme.test>`])], root);
}

const A = 'packages/a/src/a.ts';
const A_TEST = 'packages/a/src/a.test.ts';
const B = 'packages/b/src/b.ts';
const B_TEST = 'packages/b/src/b.test.ts';
const TREE_TEST = 'e2e/flow.test.ts';

/** A workspace at `root` listing `names`. */
function project(root: string, names: readonly string[]): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  for (const name of names) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({ name: `@acme/${name}`, main: `src/${name}.ts` }));
  }
}

function workspace(names: readonly string[]): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-')));
  git(['init', '--quiet', '--initial-branch', 'main'], root);
  project(root, names);
  return root;
}

function history(): string {
  const root = workspace(['a', 'b']);
  change(root, 'seed', [A, A_TEST, B, B_TEST, TREE_TEST]); // left out: no parent to compare with
  change(root, 'a alone', [A]); // one package
  change(root, 'a with its test', [A, A_TEST]); // one package, own tests
  change(root, 'a edits a test of b', [A, B_TEST]); // two packages, a test in another
  change(root, 'a and b', [A, B]); // two packages
  change(root, 'a and the tree', [A, TREE_TEST]); // one package, a test-only tree
  change(root, 'a, its test and a test of b', [A, A_TEST, B_TEST]); // two packages, own tests, a test in another
  git(['checkout', '--quiet', '-b', 'side'], root);
  change(root, 'side: a', [A]);
  change(root, 'side: b', [B]);
  git(['checkout', '--quiet', 'main'], root);
  git(['merge', '--quiet', '--no-ff', '-m', 'merge side', 'side'], root); // two packages, one change
  change(root, 'words', ['README.md']); // left out: no source
  change(root, 'a script', ['scripts/x.ts']); // left out: no source in a package
  change(root, 'bump', [A], 'renovate[bot]'); // left out: a bot
  change(root, 'Revert "bump"', [A]); // one package: a revert is a change
  change(root, 'generate', Array.from({ length: 301 }, (_, index) => `packages/a/src/generated-${String(index)}.ts`)); // one package: however many files
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask containment', () => {
  it('gives each share with its count and its denominator', async () => {
    process.chdir(history());
    const answered = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(answered.err).toBe('');
    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toContain('9 commits since 2000-01-01');
    expect(answered.out).toContain('touched one package: 5 of 9 (55.6%)');
    expect(answered.out).toContain('edited a test in another package: 2 of 9 (22.2%)');
    expect(answered.out).toContain('edited a test in a test-only tree: 1 of 9 (11.1%)');
  });

  it('gives a test in another package over those that edited their own tests, and over those that did not', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('of those that edited their own tests: 1 of 2 (50.0%)');
    expect(out).toContain('of those that did not: 1 of 7 (14.3%)');
  });

  it('counts what it left out by reason, a merge once, and calls the figures co-occurrence', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('13 first-parent commits read');
    expect(out).toContain('no parent to compare with: 1');
    expect(out).toContain('by a bot: 1');
    expect(out).toContain('touched no source: 1');
    expect(out).toContain('touched source in no package: 1');
    expect(out).toContain('These are co-occurrence: they count what commits touched together, not what caused it.');
  });

  it('holds every figure in the JSON format, and no field merges them', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({
      after: '2000-01-01',
      reading: 'co-occurrence',
      read: 13,
      counted: 9,
      packages: 2,
      shallow: false,
      leftOut: { noParent: 1, bot: 1, noSource: 1, noPackage: 1 },
      onePackage: { count: 5, of: 9 },
      testInAnotherPackage: { count: 2, of: 9 },
      testOnlyTree: { count: 1, of: 9 },
      anotherGivenOwnTests: { count: 1, of: 2 },
      anotherGivenNoOwnTests: { count: 1, of: 7 },
    });
  });

  it('names a shallow clone rather than reading it as a short history', async () => {
    const root = history();
    const shallow = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-shallow-')));
    git(['clone', '--quiet', '--depth', '2', `file://${root}`, shallow], root);
    process.chdir(shallow);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ shallow: true, read: 2, counted: 1, leftOut: { noParent: 1 } });
    const { out: text } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(text).toContain('This is a shallow clone, so the log holds only the commits it was fetched with.');
  });

  it('reads a package that holds source as a package though the window never changed its source', async () => {
    const root = workspace(['a', 'b']);
    vi.stubEnv('GIT_COMMITTER_DATE', '2001-01-01T00:00:00Z');
    change(root, 'seed', ['README.md']);
    change(root, 'long ago', [A, B]);
    vi.stubEnv('GIT_COMMITTER_DATE', '2010-01-01T00:00:00Z');
    change(root, 'a edits a test of b', [A, B_TEST]);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2005-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ testInAnotherPackage: { count: 1, of: 1 }, testOnlyTree: { count: 0, of: 1 } });
  });

  it('reads a package holding only tests as a test-only tree, not as a package a commit touched', async () => {
    const root = workspace(['a', 'e2e']);
    change(root, 'seed', ['README.md']);
    change(root, 'a and the suite', [A, 'packages/e2e/tests/flow.ts']);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ onePackage: { count: 1, of: 1 }, testOnlyTree: { count: 1, of: 1 } });
  });

  it('counts what a commit touched in a package whatever the file, so a stylesheet beside the source is a second package', async () => {
    const root = workspace(['a', 'b']);
    change(root, 'seed', [A, B]);
    change(root, 'a and b\'s styles', [A, 'packages/b/src/b.css']);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ onePackage: { count: 0, of: 1 } });
  });

  it('reads a path by what it is inside its package, whose own name says nothing', async () => {
    const root = workspace(['test', 'b']);
    change(root, 'seed', ['packages/test/src/index.mts', B]);
    change(root, 'module', ['packages/test/src/index.mts']);
    change(root, 'b and a story of test', [B, 'packages/test/src/index.stories.tsx']);
    change(root, 'b and a snapshot of test', [B, 'packages/test/src/__snapshots__/index.snap']);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ counted: 3, testInAnotherPackage: { count: 2, of: 3 }, testOnlyTree: { count: 0, of: 3 } });
  });

  it('gives no figures and says so when the workspace lists no package', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-')));
    git(['init', '--quiet', '--initial-branch', 'main'], root);
    change(root, 'seed', ['src/lib.rs']);
    change(root, 'one', ['src/lib.rs']);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('The workspace here lists no package, so there is no boundary to count across.');
    expect(out).not.toContain('touched one package');
  });

  it('reads a project below the root of its repository from where it stands', async () => {
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-')));
    git(['init', '--quiet', '--initial-branch', 'main'], top);
    const root = join(top, 'app');
    project(root, ['a', 'b']);
    change(top, 'seed', [`app/${A}`, `app/${B}`]);
    change(top, 'a', [`app/${A}`]);
    change(top, 'a and b', [`app/${A}`, `app/${B}`]);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ packages: 2, onePackage: { count: 1, of: 2 } });
  });

  it('reads the packages from the commit it reads the log of, whatever is staged', async () => {
    const root = workspace(['a', 'b']);
    change(root, 'seed', [A, B]);
    change(root, 'a', [A]);
    change(root, 'a and b', [A, B]);
    git(['rm', '--quiet', '--cached', A, B], root);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ onePackage: { count: 1, of: 2 } });
  });

  it('counts a test beside source outside every package as neither a package nor a test-only tree', async () => {
    const root = workspace(['a']);
    change(root, 'seed', [A, 'tools/x.ts']);
    change(root, 'a and a test of the tools', [A, 'tools/x.test.ts']);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ counted: 1, testOnlyTree: { count: 0, of: 1 } });
  });

  it('reads a package named for what a build makes as the source it holds', async () => {
    const root = workspace(['generated', 'b']);
    change(root, 'seed', ['packages/generated/src/g.ts', B]);
    change(root, 'g', ['packages/generated/src/g.ts']);
    change(root, 'g and b', ['packages/generated/src/g.ts', B]);
    process.chdir(root);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({ packages: 2, onePackage: { count: 1, of: 2 } });
  });

  it('reads a checkout that tracks a file named HEAD', async () => {
    const root = workspace(['a']);
    change(root, 'seed', [A, 'HEAD']);
    change(root, 'a', [A]);
    process.chdir(root);
    const answered = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(answered.err).toBe('');
    expect(JSON.parse(answered.out)).toMatchObject({ onePackage: { count: 1, of: 1 } });
  });

  it('says a clone is shallow when the workspace lists no package too', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-')));
    git(['init', '--quiet', '--initial-branch', 'main'], root);
    change(root, 'seed', ['src/lib.rs']);
    change(root, 'one', ['src/lib.rs']);
    const clone = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-')));
    git(['clone', '--quiet', '--depth', '1', `file://${root}`, clone], root);
    process.chdir(clone);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('lists no package');
    expect(out).toContain('This is a shallow clone');
  });

  it('says what another package is', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('Another package is one the commit changed no source in.');
  });

  it('refuses a window that is not a date, which git would read as now', async () => {
    process.chdir(history());
    const answered = await run(['ask', 'containment', '--after', 'lately']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('`--after` takes a date as YYYY-MM-DD, not `lately`');
  });
});
