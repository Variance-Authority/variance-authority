import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { indexOutput } from './index-command.js';
import { selectOutput, selectSuite } from './select-command.js';
import { explainedOutput, explainOf } from './select-explain.js';
import { parseAtDistance } from './select-leg.js';
import type { SuiteRequest } from './select-suite.js';

// A workstation's selection brings the index up to the checkout; CI's does not.
vi.mock('ci-info', () => ({ isCI: false }));

/**
 * `variance select --format explain`: the selection `plain` makes, read for
 * the agent deciding how far to test, one block per hop count with its cost
 * and the command that runs it.
 */

const SELF = 'test/self.test.ts';
const NEAR = 'test/near.test.ts';
const MID = 'test/mid.test.ts';
const IDLE = 'test/idle.test.ts';
const WHOLE = [IDLE, MID, NEAR, SELF];
const TIMES: Readonly<Record<string, number>> = { [SELF]: 1_000, [NEAR]: 2_000, [MID]: 3_000, [IDLE]: 4_000 };

describe('select --format explain', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-explain-cache-')));
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
  });

  it('prints one block per hop count, nearest first, each with its count, its seconds and a command that runs exactly it', async () => {
    const root = await changed();

    const { out } = await selectOutput({ cwd: root, format: 'explain' });
    const blocks = blocksOf(out);

    expect(blocks.map(({ head }) => head)).toEqual([
      '0 hops: 1 test file, 1.0 s recorded',
      '1 hop: 1 test file, 2.0 s recorded',
      '2 hops: 1 test file, 3.0 s recorded',
    ]);
    for (const block of blocks) {
      const range = /--at-distance (\S+)$/.exec(block.command)?.[1];
      const atDistance = parseAtDistance(range);
      const { skip } = JSON.parse((await selectOutput({ cwd: root, format: 'json', ...(atDistance === undefined ? {} : { atDistance }) })).out);
      expect(WHOLE.filter((test) => !skip.includes(test))).toEqual(block.tests);
    }
  });

  it('under a closed leg, lays out no left block a selection of every hop skips, as `--ran-at` skips a test one side of a merge reaches', async () => {
    const root = await changed();
    // The merge's reconciliation skips what the leg selects: MID, when a leg selects it.
    const select = async (request: SuiteRequest) => {
      const read = await selectSuite(request);
      return { ...read, reading: { ...read.reading, skip: [...new Set([...read.reading.skip, MID])].sort() } };
    };

    const { out } = await explainedOutput({ root, atDistance: { from: 0, to: 1 } }, select);

    expect(out).toContain('the change selects 2 of 4 recorded test files, 3.0 s recorded.');
    expect(out).not.toContain(MID);
  });

  it('under a closed leg, lays out what the leg left as its own marked blocks, every block closed on a range that runs exactly it', async () => {
    const root = await changed();

    const { out } = await selectOutput({ cwd: root, format: 'explain', atDistance: { from: 0, to: 1 } });
    const blocks = blocksOf(out);

    expect(out).toContain('the change selects 2 of 4 recorded test files, 3.0 s recorded.');
    expect(blocks.map(({ head }) => head)).toEqual([
      '0 hops: 1 test file, 1.0 s recorded',
      '1 hop: 1 test file, 2.0 s recorded',
      '2 hops, left by the leg asked: 1 test file, 3.0 s recorded',
    ]);
    expect(blocks.map(({ command }) => /--at-distance (\S+)$/.exec(command)?.[1])).toEqual(['0', '1', '2']);
    for (const block of blocks) {
      const atDistance = parseAtDistance(/--at-distance (\S+)$/.exec(block.command)?.[1]);
      const { skip } = JSON.parse((await selectOutput({ cwd: root, format: 'json', ...(atDistance === undefined ? {} : { atDistance }) })).out);
      expect(WHOLE.filter((test) => !skip.includes(test))).toEqual(block.tests);
    }
  });

  it('says a test file the record never saw runs in every block', async () => {
    const root = await changed({ 'src/widget.ts': WIDGET.replace("return 'a';", "return 'z';"), 'test/fresh.test.ts': SELF_TEXT });

    const { out } = await selectOutput({ cwd: root, format: 'explain' });

    expect(out).toContain('a test file the record never saw, such as one the change adds, is in no skip list, and runs in every block');
    expect(out).not.toContain('also runs any nearer test file');
  });

  it('says a test file the record never saw runs under the command, when no recorded test does', async () => {
    const root = await changed({ 'test/fresh.test.ts': SELF_TEXT });

    const { out } = await selectOutput({ cwd: root, format: 'explain' });

    expect(out).toContain('the change selects 0 of 4 recorded test files');
    expect(out).toContain('a test file the record never saw, such as one the change adds, is in no skip list, and runs under `variance select`');
  });

  it('lays a snapshot `--execution` names out by hop, priced by that snapshot', async () => {
    const root = await changed();
    const named = join(mkdtempSync(join(tmpdir(), 'va-select-explain-snapshot-')), 'coverage.va');
    renameSync(testCoverageFile(root, {}), named);

    const { out } = await selectOutput({ cwd: root, format: 'explain', execution: named });

    expect(blocksOf(out).map(({ head, command }) => `${head} — ${command}`)).toEqual([0, 1, 2].map((hop) =>
      `${hop} hop${hop === 1 ? '' : 's'}: 1 test file, ${hop + 1}.0 s recorded — variance select --execution ${named} --at-distance ${hop}`));
  });

  it('prices the blocks by the record a caller already answered from, not the checkout record', async () => {
    const root = await changed();
    const record = join(mkdtempSync(join(tmpdir(), 'va-select-explain-record-')), 'coverage.va');
    const held = snapshot(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
    await writeTestCoverage(record, { ...held, tests: held.tests.map((test) => ({ ...test, duration: (test.duration ?? 0) * 10 })) });

    const { out } = await explainedOutput({ root, record }, selectSuite);

    expect(out).toContain('0 hops: 1 test file, 10.0 s recorded');
  });

  it('gives a selection with no measured hops the command that runs it whole, with no leg a journey would refuse', () => {
    const selection = {
      ground: 'read', skip: [IDLE], because: 'b', notes: [], at: 'a', unread: [], stale: [], recorded: { whole: 4, entered: 3 },
    } as const;

    const out = explainOf(selection, new Set(WHOLE), { recording: 'r', times: new Map(Object.entries(TIMES)) }, 'variance select --execution j.bin');

    expect(out).toContain('no measured distance: 3 test files, 6.0 s recorded — variance select --execution j.bin\n');
    expect(out).not.toContain('--at-distance');
  });

  it('gives a recorded test never seen whole that no hop placed a block past the furthest hop, which only the open leg runs', () => {
    const selection = {
      ground: 'read', skip: [IDLE], because: 'b', notes: [], at: 'a', unread: [], stale: [], recorded: { whole: 3, entered: 2 },
      incomplete: [MID], distances: [{ test: SELF, bearing: 'direct', hops: 0 }, { test: NEAR, bearing: 'direct', hops: 1 }],
    } as const;

    const out = explainOf(selection, new Set([IDLE, NEAR, SELF]), { recording: 'r', times: new Map(Object.entries(TIMES)) }, 'variance select');

    expect(out).toContain(`no measured distance: 1 test file, 3.0 s recorded — variance select --at-distance 2-\n  ${MID}, `);
  });

  it('lists and prices in a block past 0 hops the nearer test files the run landed at HEAD left unrun, which its command also runs', () => {
    const selection = {
      ground: 'read', skip: [IDLE], because: 'b', notes: [], at: 'a', unread: [], stale: [], recorded: { whole: 4, entered: 3 }, unrunAtHead: [SELF, IDLE],
      distances: [{ test: SELF, bearing: 'direct', hops: 0 }, { test: NEAR, bearing: 'direct', hops: 1 }, { test: MID, bearing: 'direct', hops: 2 }],
    } as const;

    const out = explainOf(selection, new Set(WHOLE), { recording: 'r', times: new Map(Object.entries(TIMES)) }, 'variance select');

    expect(out).toContain(`the change selects 3 of 4 recorded test files, 6.0 s recorded.\n`);
    expect(out).toContain(`0 hops: 1 test file, 1.0 s recorded — variance select --at-distance 0\n  ${SELF}, 1.0 s: `);
    expect(out).toContain(`1 hop: 2 test files, 3.0 s recorded — variance select --at-distance 1\n  ${NEAR}, 2.0 s: `);
    expect(out).toContain(`\n  ${SELF}, 1.0 s: nearer, and the run that landed at HEAD left it unrun\n\n2 hops: 2 test files, 4.0 s recorded`);
    expect(out).not.toContain(IDLE);
    expect(out).not.toContain('also runs any nearer test file');
  });

  it('names on each test line the changed file and the trail `--format json` measured', async () => {
    const root = await changed();

    const { out } = await selectOutput({ cwd: root, format: 'explain' });
    const { distances } = JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance: { from: 0, to: Number.MAX_SAFE_INTEGER } })).out);

    expect(distances.length).toBe(3);
    for (const { test, trail } of distances) expect(out).toContain(`  ${test}, ${TIMES[test] / 1000}.0 s: ${trail.join(' → ')}\n`);
    expect(out).toContain(`src/widget.ts → src/caller.ts → ${MID}`);
  });

  it('selects the test files `plain` selects', async () => {
    const root = await changed();

    const plain = (await selectOutput({ cwd: root, format: 'plain' })).out.split('\n').filter(Boolean);
    const explained = blocksOf((await selectOutput({ cwd: root, format: 'explain' })).out).flatMap(({ tests }) => tests);

    expect(explained.sort()).toEqual(WHOLE.filter((test) => !plain.includes(test)));
  });

  it('names a changed file the record and the graph know nothing of, with what brings it into reach', async () => {
    const root = await changed({ 'data/table.txt': 'two\n' });

    const { out } = await selectOutput({ cwd: root, format: 'explain' });

    expect(out).toContain('1 changed file the record and the graph know nothing of:\n  data/table.txt');
    expect(out).toContain('`/// <depends>`');
    expect(out).toContain('`before`');
  });

  it('names the changed file, the `before` entry it matched, and the whole suite a `before` change runs', async () => {
    const root = await changed({ 'test/setup.ts': 'export const ready = 2;\n' }, {
      suites: { unit: { kind: 'unit', before: ['vitest.config.ts', 'test/setup.ts'] } },
    });

    const { out } = await selectOutput({ cwd: root, format: 'explain', suite: 'unit' });

    expect(out).toContain('the whole suite runs: the suite unit rests on test/setup.ts before any test imports it, through its `before` entry `test/setup.ts`');
    expect(out).toContain('the record times 4 test files, 10.0 s');
  });

  it('counts the whole suite a `before` change runs, those the record does not time among it', async () => {
    const root = await changed({ 'test/setup.ts': 'export const ready = 2;\n' }, {
      suites: { unit: { kind: 'unit', before: ['vitest.config.ts', 'test/setup.ts'] } },
    });
    const held = snapshot(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
    const tests = held.tests.map((test) => (test.file === IDLE ? { ...test, duration: undefined } : test));
    await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), { ...held, tests });

    const { out } = await selectOutput({ cwd: root, format: 'explain', suite: 'unit' });

    expect(out).toContain('the record times 3 of 4 test files, 6.0 s; 1 has no recorded time\n');
  });

  it('under `--local`, says why the selection fell to a rung, and lays out what the rung runs', async () => {
    const root = await changed({ 'src/widget.ts': WIDGET.replace("return 'a';", "return 'z';") }, { suites: { unit: { kind: 'unit' } } });
    rmSync(testCoverageFile(root, { suite: 'unit' }));

    const { out } = await selectOutput({ cwd: root, format: 'explain', suite: 'unit', local: true });

    expect(out).toContain('the change selects 3 test files, 0 ms recorded, 3 with no recorded time.\n');
    expect(out).toContain('so `--local` selected the test files that import the changed files, by the source index: 3 of 5 test files.');
    expect(out).toContain(`no measured distance: 3 test files, 0 ms recorded, 3 with no recorded time — variance select --suite unit --local\n`);
    for (const test of [MID, NEAR, SELF]) expect(out).toContain(`  ${test}, no recorded time: the importers rung \`--local\` fell to\n`);
    expect(out).not.toContain('src/widget.ts,');
  });

  it('under `--local` with no record, lays out the test files the rung chose by the source index', () => {
    const selection = {
      ground: 'read', skip: [], because: 'w, so `--local` selected', notes: [], at: 'a', unread: [], stale: [],
      only: [NEAR, 'src/widget.ts'], fell: { rung: 'importers', from: 'w', left: [], selected: [NEAR] },
    } as const;

    const out = explainOf(selection, new Set(), { unread: 'no record' }, 'variance select --local');

    expect(out).toContain('the change selects 1 test file, 0 ms recorded, 1 with no recorded time.');
    expect(out).toContain(`no measured distance: 1 test file, 0 ms recorded, 1 with no recorded time — variance select --local\n  ${NEAR}, `);
    // `only` runs what the rung chose: a test file the record never saw runs only when the rung chose it.
    expect(out).not.toContain('the record never saw');
  });

  it('is a format `select` takes', () => {
    expect(parseArgs(['select', '--format', 'explain'])).toMatchObject({ command: 'select', format: 'explain' });
  });
});

/** Each block of `out`: its head, the command that closes it, and its test files. */
function blocksOf(out: string): readonly { readonly head: string; readonly command: string; readonly tests: readonly string[] }[] {
  return out.split('\n\n').flatMap((part) => {
    const [first = '', ...lines] = part.split('\n').filter(Boolean);
    const matched = /^(\d+ hops?[^:]*: [^—]+) — (variance select .*)$/.exec(first);
    if (matched === null) return [];
    return [{ head: matched[1]!.trim(), command: matched[2]!, tests: lines.map((line) => line.trim().split(',')[0]!) }];
  });
}

const WIDGET = ['export function widget(): string {', "  return 'a';", '}', ''].join('\n');
const CALLER = ["import { widget } from './widget';", 'export const caller = (): string => widget();', ''].join('\n');
const SELF_TEXT = "import { widget } from '../src/widget';\nwidget();\n";

/**
 * A widget and a caller of it, tests at 0, 1 and 2 hops from a change to the
 * widget and to the first test, one test nothing reaches, and the record of a
 * run at the head. `edits` are made after the commit, beside that change;
 * `config` is the root `variance.config.json`, whose record is the suite `unit`'s.
 */
async function changed(edits: Readonly<Record<string, string>> = {}, config?: unknown): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-explain-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const files: Record<string, string> = {
    'src/widget.ts': WIDGET,
    'src/caller.ts': CALLER,
    [SELF]: SELF_TEXT,
    [NEAR]: "import { widget } from '../src/widget';\nwidget();\n",
    [MID]: "import { caller } from '../src/caller';\ncaller();\n",
    [IDLE]: 'export {};\n',
    'data/table.txt': 'one\n',
    'vitest.config.ts': "export default { test: { setupFiles: ['./test/setup.ts'] } };\n",
    'test/setup.ts': 'export const ready = 1;\n',
    ...(config === undefined ? {} : { 'variance.config.json': JSON.stringify(config) }),
  };
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  await writeTestCoverage(testCoverageFile(root, config === undefined ? {} : { suite: 'unit' }), snapshot(git(['rev-parse', 'HEAD'])));
  if (Object.keys(edits).length === 0) {
    write(root, 'src/widget.ts', WIDGET.replace("return 'a';", "return 'z';"));
    write(root, SELF, `${SELF_TEXT}// the edit\n`);
  }
  for (const [file, text] of Object.entries(edits)) write(root, file, text);
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** One module whose every region ran under `testFiles`; `named` is a function spanning the whole text. */
function moduleOf(file: string, text: string, lines: number, testFiles: readonly string[], named?: string): TestCoverage['modules'][number] {
  const region = { source: true, startLine: 1, endLine: lines, testFiles: [...testFiles] };
  return {
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [
      { ...region, ordinal: 0, kind: 'module', digest: digestString(file), name: file, path: 'module' },
      ...(named === undefined
        ? []
        : [{ ...region, ordinal: 1, kind: 'function' as const, owner: 0, digest: digestString(named), name: named, path: named }]),
    ],
  };
}

function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: WHOLE.map((file) => ({ file, complete: true, preconditions: [], duration: TIMES[file] })),
    modules: [moduleOf('src/widget.ts', WIDGET, 3, [MID, NEAR, SELF], 'widget'), moduleOf('src/caller.ts', CALLER, 2, [MID])],
  };
}
