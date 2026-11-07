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

function history(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-')));
  git(['init', '--quiet', '--initial-branch', 'main'], root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  for (const name of ['a', 'b']) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({ name: `@acme/${name}`, main: `src/${name}.ts` }));
  }
  change(root, 'seed', [A, A_TEST, B, B_TEST, TREE_TEST]); // two packages, own tests, a test-only tree
  change(root, 'a alone', [A]); // one package
  change(root, 'a with its test', [A, A_TEST]); // one package, own tests
  change(root, 'a edits a test of b', [A, B_TEST]); // one package, a test in another
  change(root, 'a and b', [A, B]); // two packages
  change(root, 'a and the tree', [A, TREE_TEST]); // one package, a test-only tree
  change(root, 'a, its test and a test of b', [A, A_TEST, B_TEST]); // one package, own tests, a test in another
  git(['checkout', '--quiet', '-b', 'side'], root);
  change(root, 'side: a', [A]);
  change(root, 'side: b', [B]);
  git(['checkout', '--quiet', 'main'], root);
  git(['merge', '--quiet', '--no-ff', '-m', 'merge side', 'side'], root); // two packages, one change
  change(root, 'words', ['README.md']); // left out: no source
  change(root, 'bump', [A], 'renovate[bot]'); // left out: a bot
  change(root, 'Revert "bump"', [A]); // left out: a revert
  change(root, 'generate', Array.from({ length: 301 }, (_, index) => `packages/a/src/generated-${String(index)}.ts`)); // left out: too wide
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
    expect(answered.out).toContain('8 commits since 2000-01-01');
    expect(answered.out).toContain('touched one package: 5 of 8 (62.5%)');
    expect(answered.out).toContain('edited a test in another package: 2 of 8 (25.0%)');
    expect(answered.out).toContain('edited a test outside the packages they changed, in a test-only tree: 2 of 8 (25.0%)');
  });

  it('gives a test in another package over those that edited their own tests, and over those that did not', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('of those that edited their own tests: 1 of 3 (33.3%)');
    expect(out).toContain('of those that did not: 1 of 5 (20.0%)');
  });

  it('counts what it left out by reason, a merge once, and calls the figures co-occurrence', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('12 first-parent commits read');
    expect(out).toContain('touched no source: 1');
    expect(out).toContain('by a bot: 1');
    expect(out).toContain('a revert: 1');
    expect(out).toContain('over 300 files: 1');
    expect(out).toContain('These count what commits touched together, not what caused it.');
  });

  it('holds every figure in the JSON format, and no field merges them', async () => {
    process.chdir(history());
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01', '--format', 'json']);
    expect(JSON.parse(out)).toMatchObject({
      after: '2000-01-01',
      read: 12,
      counted: 8,
      packages: 2,
      shallow: false,
      leftOut: { noSource: 1, bot: 1, revert: 1, wide: 1 },
      onePackage: { count: 5, of: 8 },
      testInAnotherPackage: { count: 2, of: 8 },
      testOnlyTree: { count: 2, of: 8 },
      anotherGivenOwnTests: { count: 1, of: 3 },
      anotherGivenNoOwnTests: { count: 1, of: 5 },
    });
  });

  it('names a shallow clone rather than reading it as a short history', async () => {
    const root = history();
    const shallow = realpathSync(mkdtempSync(join(tmpdir(), 'va-containment-shallow-')));
    git(['clone', '--quiet', '--depth', '2', `file://${root}`, shallow], root);
    process.chdir(shallow);
    const { out } = await run(['ask', 'containment', '--after', '2000-01-01']);
    expect(out).toContain('This is a shallow clone, so the log holds only the commits it was fetched with.');
  });

  it('refuses a window that is not a date, which git would read as now', async () => {
    process.chdir(history());
    const answered = await run(['ask', 'containment', '--after', 'lately']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('`--after` takes a date as YYYY-MM-DD, not `lately`');
  });
});
