import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { encodeExecutionIndex, recordOfCases, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { indexOutput } from './index-command.js';
import { selectOutput, selectSuite } from './select-command.js';
import type { SuiteRequest } from './select-suite.js';

// A workstation's selection brings the index up to the checkout; CI's does not.
vi.mock('ci-info', () => ({ isCI: false }));

/**
 * `variance select --local` over a checkout of two packages, each a module and
 * the test that imports it, for each reason the record cannot narrow. Without
 * `--local` each reason runs every test file; with it, the selection falls to
 * the changed files' importers, or to their packages, and names what it left.
 */

const A = 'packages/a/test/a.test.ts';
const B = 'packages/b/test/b.test.ts';
const HEALTH = 'packages/b/checks/health.ts';
const A_SOURCE = 'export const a = 1;\n';

it('reads `--local` off the command line, and nothing without it', () => {
  expect(parseArgs(['select', '--local'])).toMatchObject({ command: 'select', local: true });
  expect(parseArgs(['select'])).not.toHaveProperty('local');
});

describe('a selection that cannot narrow, asked `--local`', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-local-cache-')));
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
  });

  /** Asked with and without `--local`, after `change` and an index of the checkout. */
  async function both(root: string, change: () => void, asked: Omit<SuiteRequest, 'root'> = {}) {
    change();
    process.chdir(root);
    await indexOutput({ cwd: root });
    const local = await selectSuite({ root, ...asked, local: true });
    const gate = await selectSuite({ root, ...asked });
    return { local, gate };
  }

  const editA = (root: string) => () => write(root, 'packages/a/src/a.ts', 'export const a = 2;\n');

  it('falls to the importers when there is no journal', async () => {
    const { root } = checkout();
    const { local, gate } = await both(root, editA(root));

    expect(gate.reading.widened).toContain('no execution journal');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers', left: [B] });
    expect([...(local.left ?? [])]).toEqual([B]);
  });

  it('reads the change from the merge base with the mainline when the edit is committed and the tree clean', async () => {
    const { root } = checkout();
    const git = (args: readonly string[]) => execFileSync('git', args, { cwd: root });
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    const { local } = await both(root, () => {
      editA(root)();
      git(['commit', '--quiet', '-am', 'the edit, committed']);
    });

    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers', left: [B] });
  });

  it('falls to the importers when the record holds no coverage', async () => {
    const { root } = checkout();
    uncovered(root);
    const { local, gate } = await both(root, editA(root));

    expect(gate.reading.widened).toContain('holds no coverage');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers' });
  });

  it('falls to the importers of what changed since HEAD when the diff from the record cannot be read', async () => {
    const { root } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot('f'.repeat(40), true));
    const { local, gate } = await both(root, editA(root));

    expect(gate.reading.widened).toContain('cannot read what changed');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers' });
  });

  it('falls to the package whose manifest moved with a lockfile it cannot compare', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head, true));
    const { local, gate } = await both(root, () => {
      write(root, 'package-lock.json', JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' } } }));
      write(root, 'packages/a/package.json', JSON.stringify({ name: 'a', dependencies: { 'left-pad': '^1.0.0' } }));
    });

    expect(gate.reading.ground).toBe('no-install');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'package', left: [B] });
  });

  it('selects no test for a lockfile no manifest moved with, and names every test it left', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head, true));
    const { local, gate } = await both(root, () => {
      write(root, 'package-lock.json', JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' } } }));
    });

    expect(gate.reading.ground).toBe('no-install');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([A, B]);
    expect(local.reading.fell).toMatchObject({ rung: 'package', left: [A, B] });
  });

  it('falls to the package of a file the suite rests on', async () => {
    const { root, head } = checkout({ 'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit', before: ['packages/a/setup.ts'] } } }) });
    await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), snapshot(head, true));
    const { local, gate } = await both(root, () => write(root, 'packages/a/setup.ts', 'export const ready = 2;\n'), { suite: 'unit' });

    expect(gate.reading.ground).toBe('before');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'package' });
  });

  it('falls to the package of a file the suite rests on when there is no journal', async () => {
    const { root } = checkout({ 'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit', before: ['packages/a/setup.ts'] } } }) });
    const { local } = await both(root, () => write(root, 'packages/a/setup.ts', 'export const ready = 2;\n'), { suite: 'unit' });

    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'package', left: [B] });
  });

  it('falls to the importers when a journey file cannot read what changed', async () => {
    const { root } = checkout();
    const { local, gate } = await both(root, editA(root), { execution: join(root, 'journey.json'), since: 'no-such-ref' });

    expect(gate.reading.ground).toBe('no-diff');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers', left: [B] });
  });

  it('leaves a test file the record holds whose name does not say test', async () => {
    const { root } = checkout({ [HEALTH]: "import { b } from '../src/b';\nexport const seen = b;\n" });
    await writeTestCoverage(testCoverageFile(root), snapshot('f'.repeat(40), true, [HEALTH]));
    const { local } = await both(root, editA(root));

    expect([...local.skip]).toEqual([HEALTH, B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers', left: [HEALTH, B] });
  });

  it('falls to the importers when the record holds no test whole', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head, false));
    const { local, gate } = await both(root, editA(root));

    expect(gate.reading.widened).toContain('no whole observation');
    expect([...gate.skip]).toEqual([]);
    expect([...local.skip]).toEqual([B]);
    expect(local.reading.fell).toMatchObject({ rung: 'importers' });
  });

  it('names the rung and the tests it left, which stay on the skip list so the landing keeps their stands', async () => {
    const { root } = checkout();
    editA(root)();
    process.chdir(root);
    await indexOutput({ cwd: root });

    const plain = await selectOutput({ cwd: root, format: 'plain', local: true });
    const json = JSON.parse((await selectOutput({ cwd: root, format: 'json', local: true })).out) as Record<string, unknown>;

    expect(plain.out).toBe(`${B}\n`);
    expect(plain.err).toContain('so `--local` selected the test files that import the changed files, by the source index: 1 of 2 test files');
    expect(plain.err).toContain(`1 test file is left for a run without \`--local\`, and keeps its stand: ${B}`);
    expect(json).toMatchObject({ ground: 'no-journal', skip: [B], fell: { rung: 'importers', left: [B] } });
  });

  it('runs a leg over what the rung selected, which it does not cut by hops', async () => {
    const { root } = checkout();
    editA(root)();
    process.chdir(root);
    await indexOutput({ cwd: root });

    const { err } = await selectOutput({ cwd: root, format: 'plain', local: true, atDistance: { from: 0, to: 1 } });

    expect(err).toContain('runs every test file `--local` selected: hops are counted only on a record that narrowed');
    expect(err).not.toContain('nothing was narrowed');
  });
});

/** A checkout of two packages at a commit, with `extra` beside them. */
function checkout(extra: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-local-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/a/package.json': JSON.stringify({ name: 'a' }),
    'packages/a/src/a.ts': A_SOURCE,
    'packages/a/setup.ts': 'export const ready = 1;\n',
    [A]: "import { a } from '../src/a';\nexport const seen = a;\n",
    'packages/b/package.json': JSON.stringify({ name: 'b' }),
    'packages/b/src/b.ts': 'export const b = 1;\n',
    [B]: "import { b } from '../src/b';\nexport const seen = b;\n",
    ...extra,
  };
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** A record of the cases of both tests and no coverage, as a run that instrumented nothing writes it. */
function uncovered(root: string): void {
  const file = testCoverageFile(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, recordOfCases({
    index: encodeExecutionIndex({
      tests: [{ id: `${A} > one`, file: A, name: 'one', stopped: false }],
      modules: [{
        file: 'packages/a/src/a.ts',
        blocks: [{ kind: 'function', name: 'a', path: 'a', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0 }] }],
      }],
    }),
  }));
}

/** Both tests and `more`, `complete` or not, and the module of `a` entered by its own. */
function snapshot(commit: string, complete: boolean, more: readonly string[] = []): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: A, complete, preconditions: [] },
      { file: B, complete, preconditions: [] },
      ...more.map((file) => ({ file, complete, preconditions: [] })),
    ],
    modules: [
      {
        file: 'packages/a/src/a.ts',
        sourceDigest: digestString(A_SOURCE),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: digestString('module'), name: 'a.ts', path: 'module', startLine: 1, endLine: 1, source: true, testFiles: [A] },
        ],
      },
    ],
  };
}
