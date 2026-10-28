import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage, type Placement, type TestCoverage } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { OperatorError } from '../exit.js';
import { graphOnce, selectedFor } from './gap-selection.js';
import { indexOutput } from './index-command.js';

/**
 * The run a gap names is selection's answer for the asked file, and nothing
 * the gap works out on its own: a new file runs the recorded test files reach
 * walks to, a recorded one the test files that loaded it, each under the
 * suite's own `relations`, `before` and `ignore`. The gap words and counts what
 * selection named, never names an empty run, and a lookup that cannot be had
 * leaves the refusal standing.
 */

/** The frame the next question is read in; none unless a case sets one. */
let framed: Placement | undefined;
/** Whether selection's file graph refuses to read, as the operator's to fix. */
let unreadable = false;

vi.mock('./covering-frame.js', async (original) => ({
  ...await original<typeof import('./covering-frame.js')>(),
  placementFor: async () => framed,
}));

vi.mock('./source-graph.js', async (original) => {
  const real = await original<typeof import('./source-graph.js')>();
  return {
    ...real,
    relationsFor: async (...args: Parameters<typeof real.relationsFor>) => {
      if (unreadable) throw new OperatorError('the file graph does not read here');
      return await real.relationsFor(...args);
    },
  };
});

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-gap-selection-cache-'));
});

afterEach(() => {
  framed = undefined;
  unreadable = false;
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const RECORDED: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'gap-selection-fixture', private: true }),
  'src/pad.ts': 'export const pad = 1;\n',
  'src/other.ts': 'export const other = 1;\n',
  'test/beta.test.ts': "import { pad } from '../src/pad';\nexport const padded = pad;\n",
  'test/gamma.test.ts': "import { other } from '../src/other';\nexport const othered = other;\n",
};

/**
 * A checkout whose `unit` record was made before `src/extra.ts` existed. Since
 * then `src/pad.ts`, which only `beta.test.ts` loads, imports it, and so does
 * `src/setup.ts`, which no test imports. The record holds `pad.ts` only as a
 * module its one test loaded, and its case index credits no case with it.
 * `added` are more files the second commit adds, such as new test files.
 */
async function checkout(suites: unknown, added: Readonly<Record<string, string>> = {}): Promise<{ readonly root: string; readonly recordedAt: string }> {
  const root = mkdtempSync(join(tmpdir(), 'va-gap-selection-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  for (const [file, text] of Object.entries(RECORDED)) write(root, file, text);
  write(root, 'variance.config.json', JSON.stringify({ suites }));
  git('add', '-A');
  git('commit', '--quiet', '-m', 'recorded');
  const recordedAt = git('rev-parse', 'HEAD');
  await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), coverage(recordedAt), { index: encodeExecutionIndex(INDEX) });
  write(root, 'src/extra.ts', 'export const extra = 1;\n');
  write(root, 'src/pad.ts', "import { extra } from './extra';\nexport const pad = extra;\n");
  write(root, 'src/setup.ts', "import './extra';\n");
  for (const [file, text] of Object.entries(added)) write(root, file, text);
  git('add', '-A');
  git('commit', '--quiet', '-m', 'extra');
  process.chdir(root);
  await indexOutput({ cwd: root });
  return { root, recordedAt };
}

const INDEX = {
  tests: [
    { id: 'b', file: 'test/beta.test.ts', name: 'pads' },
    { id: 'g', file: 'test/gamma.test.ts', name: 'others' },
  ],
  modules: [
    { file: 'src/pad.ts', blocks: [{ kind: 'module', name: '', path: 'module', startLine: 1, endLine: 1, source: true, loaded: true as const, crossings: [] }] },
    { file: 'src/other.ts', blocks: [{ kind: 'module', name: '', path: 'module', startLine: 1, endLine: 1, source: true, crossings: [{ test: 1, distance: 0 }] }] },
  ],
} as Parameters<typeof encodeExecutionIndex>[0];

/** Each source file's module row, entered by the test that imports it, as selection reads the record. */
function coverage(commit: string): TestCoverage {
  const row = (file: string, test: string) => ({
    file,
    sourceDigest: digestString(RECORDED[file]!),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: digestString(`module ${file}`), name: file, path: 'module',
      startLine: 1, endLine: 1, source: true, testFiles: [test],
    }],
  });
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
      { file: 'test/gamma.test.ts', complete: true, preconditions: [] },
    ],
    modules: [row('src/pad.ts', 'test/beta.test.ts'), row('src/other.ts', 'test/gamma.test.ts')],
  };
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

async function run(argv: readonly string[]): Promise<{ readonly out: string; readonly err: string; readonly code: number }> {
  let out = '';
  let err = '';
  const code = await main([...argv], { out: (text) => (out += text), err: (text) => (err += text) });
  return { out, err, code };
}

/** The first suite's gap, from JSON, and the text a person reads. */
async function gapOf(root: string, ...argv: string[]): Promise<{ readonly gap: unknown; readonly text: string }> {
  const json = await run(['covering', ...argv, '--root', root, '--format', 'json']);
  const said = JSON.parse(json.out) as { gap?: unknown; suites?: readonly { gap?: unknown }[] };
  const text = await run(['covering', ...argv, '--root', root]);
  return { gap: said.gap ?? said.suites?.[0]?.gap, text: text.out + text.err };
}

describe('a file added after the commit its suite recorded at', () => {
  it('runs the recorded test files selection reaches from it, and leaves the files added since to reach', async () => {
    const { root, recordedAt } = await checkout({ unit: { kind: 'unit' } });
    const { gap, text } = await gapOf(root, '--file', 'src/extra.ts');

    expect(gap).toEqual({
      question: 'which tests run it',
      scope: 'src/extra.ts',
      known: 'the record predates the file; selection runs 1 recorded test file for it',
      reason: 'stale',
      remedy: 'record',
      run: { suite: 'unit', files: ['test/beta.test.ts'] },
      next: [`variance reach --since ${recordedAt.slice(0, 12)}`],
      cost: { files: 1, tests: 1 },
    });
    expect(text).toContain("Next, Record, 1 test in 1 test file:\n    Run with the runner of `unit`: test/beta.test.ts\n");
  });

  const NEW_TESTS = {
    'test/extra.test.ts': "import { extra } from '../src/extra';\nexport const extraed = extra;\n",
    'test/lone.test.ts': 'export const lone = 1;\n',
  };

  it('leaves a new test file that imports it to `variance reach --since`, which takes every file added since', async () => {
    const { root, recordedAt } = await checkout({ unit: { kind: 'unit' } }, NEW_TESTS);
    const { gap, text } = await gapOf(root, '--file', 'src/extra.ts');

    expect(gap).toMatchObject({ run: { suite: 'unit', files: ['test/beta.test.ts'] }, next: [`variance reach --since ${recordedAt.slice(0, 12)}`] });
    expect(gap).not.toHaveProperty('run.added');
    expect(text).not.toContain('Added since');
  });

  it('adds nothing for a suite that declines relations', async () => {
    const { root } = await checkout({ unit: { kind: 'unit', relations: false } }, NEW_TESTS);
    const { gap } = await gapOf(root, '--file', 'src/extra.ts');

    expect(gap).not.toHaveProperty('run');
  });

  it('walks no import for a suite that declines relations, and names no empty run', async () => {
    const { root } = await checkout({ unit: { kind: 'unit', relations: false } });
    const { gap } = await gapOf(root, '--file', 'src/extra.ts');

    expect(gap).toMatchObject({ known: 'the record predates the file, and selection runs no recorded test file for it' });
    expect(gap).not.toHaveProperty('run');
    expect(gap).not.toHaveProperty('cost');
  });

  it('runs the whole suite for a file only the suite\'s `before` entry imports', async () => {
    const { root } = await checkout({ unit: { kind: 'unit', before: ['src/setup.ts'] } });
    const { gap, text } = await gapOf(root, '--file', 'src/extra.ts');

    expect(gap).toMatchObject({
      known: 'the record predates the file; selection runs the whole suite for it',
      run: { suite: 'unit', whole: 'the suite unit rests on src/extra.ts before any test imports it, and this diff moves it' },
      cost: { files: 2, tests: 2 },
    });
    expect(text).toContain('Run the whole suite with the runner of `unit`: the suite unit rests on src/extra.ts before any test imports it, and this diff moves it.');
  });

  it('runs nothing for a file the suite ignores', async () => {
    const { root } = await checkout({ unit: { kind: 'unit', ignore: ['src/extra.ts'] } });
    const { gap } = await gapOf(root, '--file', 'src/extra.ts');

    expect(gap).toMatchObject({ known: 'the record predates the file, and selection runs no recorded test file for it' });
    expect(gap).not.toHaveProperty('run');
  });

  it('keeps the refusal when selection refuses, its gap saying why in selection\'s words and naming no command it guessed', async () => {
    const { root } = await checkout({ unit: { kind: 'unit' } });
    unreadable = true;
    const { gap, text } = await gapOf(root, '--file', 'src/extra.ts');

    expect(text).toContain('`src/extra.ts` did not exist at');
    expect(gap).toMatchObject({
      known: 'the record predates the file, and which test files selection runs for it could not be read: the file graph does not read here',
    });
    expect((gap as { next: readonly string[] }).next).toEqual([expect.stringMatching(/^variance reach --since /u)]);
    expect(gap).not.toHaveProperty('run');
  });
});

describe('a recorded file whose only test merely imports it', () => {
  const mapped = (written: readonly number[]): Placement => ({
    frame: 'mapped',
    place: (range) => ({ lines: range, moved: false }),
    recordedLine: (line) => (written.includes(line) ? undefined : line),
  });

  it('names that test for a line written since the recording', async () => {
    const { root } = await checkout({ unit: { kind: 'unit' } });
    framed = mapped([1]);
    const { gap } = await gapOf(root, '--file', 'src/pad.ts', '--line', '1');

    expect(gap).toMatchObject({
      question: 'which tests run it now',
      known: 'line 1 was written since the recording',
      run: { files: ['test/beta.test.ts'] },
      cost: { files: 1, tests: 1 },
    });
  });

  it('names that test for a file the record holds another text of', async () => {
    const { root } = await checkout({ unit: { kind: 'unit' } });
    framed = { frame: 'stale', place: () => undefined, recordedLine: () => undefined };
    const { gap } = await gapOf(root, '--file', 'src/pad.ts', '--line', '1');

    expect(gap).toMatchObject({ reason: 'stale', run: { files: ['test/beta.test.ts'] } });
  });

  it('names that test for a recorded range edited since, which no case called into', async () => {
    const { root } = await checkout({ unit: { kind: 'unit' } });
    framed = { frame: 'mapped', place: (range) => ({ lines: range, moved: true }), recordedLine: (line) => line };
    const { gap } = await gapOf(root, '--file', 'src/pad.ts');

    expect(gap).toMatchObject({ reason: 'stale', run: { files: ['test/beta.test.ts'] } });
  });

  it('says why selection refused for a line written since, and names no command it guessed', async () => {
    const { root } = await checkout({ unit: { kind: 'unit' } });
    framed = mapped([1]);
    unreadable = true;
    const { gap } = await gapOf(root, '--file', 'src/pad.ts', '--line', '1');

    expect(gap).toMatchObject({
      known: 'line 1 was written since the recording, and which test files selection runs for it could not be read: the file graph does not read here',
      next: [],
    });
  });
});

describe('a refused suite beside one that answered, under `--format refs`', () => {
  it('prints no gap on stdout, which a runner takes as a list, and says it on stderr', async () => {
    const { root } = await checkout({ unit: { kind: 'unit' }, journeys: { kind: 'e2e' } });
    const said = await run(['covering', '--file', 'src/other.ts', '--line', '1', '--root', root, '--format', 'refs']);

    expect(said.out).not.toContain('Gap');
    expect(said.out).not.toContain('Wire');
    expect(said.err).toContain('Gap (absent) on line 1 of src/other.ts');
  });
});

describe('the record a gap asks selection about', () => {
  it('is the one the answer was read from, handed by path, while the suite still names the configuration', async () => {
    const { root } = await checkout({ unit: { kind: 'unit', ignore: ['src/other.ts'] } });
    const landing = testCoverageFile(root, { suite: 'unit' });
    const held = join(mkdtempSync(join(tmpdir(), 'va-gap-selection-held-')), 'coverage.bin');
    renameSync(landing, held);
    const source = { root, suite: 'unit', record: held, graph: graphOnce(root) };

    expect(await selectedFor(source, 'src/pad.ts')).toEqual({ files: ['test/beta.test.ts'] });
    expect(await selectedFor(source, 'src/other.ts')).toEqual({ none: true });
  });
});
