import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { changedLines } from './diff-lines.js';
import { encodeTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';
import { backThrough, changeInRecord, hunksByFile, hunksOf, placeAcross, placeInText, placeInTexts, placeThrough } from './placed.js';
import { stateOf } from './range-state.js';
import type { CoveringTest, ExecutionTest } from './reverse.js';

// `git diff --no-index -U0` over a ten-line text: two lines inserted after 2,
// line 5 rewritten as two, lines 8-9 removed.
const DIFF = [
  'diff --git a/recorded b/held',
  '--- a/recorded',
  '+++ b/held',
  '@@ -2,0 +3,2 @@ one',
  '+a',
  '+b',
  '@@ -5 +7,2 @@ four',
  '-five',
  '+five',
  '+more',
  '@@ -8,2 +10,0 @@ seven',
  '-eight',
  '-nine',
  '',
].join('\n');
const hunks = hunksOf(DIFF);
const at = (startLine: number, endLine: number) => placeThrough(hunks, { startLine, endLine });

describe('a recorded range in the text an editor holds', () => {
  it('reads every hunk header, with a count of one where git leaves it out', () => {
    expect(hunks).toEqual([
      { oldStart: 2, oldCount: 0, newStart: 3, newCount: 2 },
      { oldStart: 5, oldCount: 1, newStart: 7, newCount: 2 },
      { oldStart: 8, oldCount: 2, newStart: 10, newCount: 0 },
    ]);
  });

  it('shifts a range no hunk touched by what came before it', () => {
    expect(at(1, 2)).toEqual({ lines: { startLine: 1, endLine: 2 }, moved: false });
    expect(at(3, 4)).toEqual({ lines: { startLine: 5, endLine: 6 }, moved: false });
    expect(at(10, 10)).toEqual({ lines: { startLine: 11, endLine: 11 }, moved: false });
  });

  it('marks a range an edit rewrote, spanning the lines it holds now', () => {
    expect(at(4, 6)).toEqual({ lines: { startLine: 6, endLine: 9 }, moved: true });
    expect(at(5, 5)).toEqual({ lines: { startLine: 7, endLine: 8 }, moved: true });
  });

  it('marks a range lines were inserted into', () => {
    expect(at(1, 3)).toEqual({ lines: { startLine: 1, endLine: 5 }, moved: true });
  });

  it('drops a range whose every line was removed', () => {
    expect(at(8, 9)).toBeUndefined();
  });

  it('finds the recorded line a held line was, and none for a line an edit wrote', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) => backThrough(hunks, line)))
      .toEqual([1, 2, undefined, undefined, 3, 4, undefined, undefined, 6, 7, 10]);
  });
});

const called = (id: string): CoveringTest => ({ id, file: 't.test.ts', name: id, distance: 0 });
const carried = (id: string): CoveringTest => ({ ...called(id), loaded: true });
const stopped: ExecutionTest = { id: 's', file: 't.test.ts', name: 's', stopped: true };
const range = (tests: readonly CoveringTest[], short?: readonly ExecutionTest[], loaded?: true) => ({
  startLine: 1,
  endLine: 2,
  tests,
  ...(short === undefined ? {} : { stopped: short }),
  ...(loaded === undefined ? {} : { loaded }),
});

describe('a change read in the numbers of the commit a record was made at', () => {
  const FILE = 'src/long.ts';
  const diffOf = (...body: readonly string[]): string => [`diff --git a/${FILE} b/${FILE}`, `--- a/${FILE}`, `+++ b/${FILE}`, ...body, ''].join('\n');
  const listed = (diff: string) => ({ lines: changedLines(diff), hunks: hunksByFile(diff) });
  const read = (record: string, change: string) => changeInRecord(record, listed(change)).get(FILE);

  it('carries a line the change wrote past what the tree put above it', () => {
    const change = diffOf('@@ -5 +7 @@', '-five', '+FIVE');
    const record = diffOf('@@ -0,0 +1,2 @@', '+new one', '+new two', '@@ -5 +7 @@', '-five', '+FIVE');

    expect(read(diffOf('@@ -0,0 +1,2 @@', '+new one', '+new two'), change)).toEqual([{ start: 5, end: 5 }]);
    expect(read(record, change)).toEqual([{ start: 5, end: 5 }]);
  });

  it('charges the lines around a removal the record still holds on neither side', () => {
    const change = diffOf('@@ -5 +4,0 @@', '-five');

    expect(read('', change)).toEqual([{ start: 4, end: 5 }]);
  });

  it('charges the first line for a removal above it', () => {
    expect(read('', diffOf('@@ -1 +0,0 @@', '-one'))).toEqual([{ start: 1, end: 1 }]);
  });

  it('keeps the text of a gap the record does not hold, on the lines that gap opened', () => {
    const inserted = diffOf('@@ -17,0 +18 @@', '+the change');

    expect(read(inserted, inserted)).toEqual([{ start: 17, end: 18, added: 'the change' }]);
  });

  it('reads a hunk both sides wrote by what each of its lines was charged, a hunk being the grain', () => {
    const record = diffOf('@@ -17,2 +17,2 @@', '-seventeen', '-eighteen', '+SEVENTEEN', '+the change');

    expect(read(record, diffOf('@@ -18 +18 @@', '-eighteen', '+the change'))).toEqual([{ start: 17, end: 17 }, { start: 18, end: 18 }]);
  });

  it('keeps a hunk of the record no line of the change met out of the answer', () => {
    const record = diffOf('@@ -2 +2 @@', '-two', '+TWO', '@@ -9 +9 @@', '-nine', '+NINE');

    expect(read(record, diffOf('@@ -9 +9 @@', '-nine', '+NINE'))).toEqual([{ start: 9, end: 9 }]);
  });

  it('reads a file the record diff shows no hunk of at the grain that diff gives it', () => {
    const binary = `diff --git a/${FILE} b/${FILE}\nBinary files differ\n`;

    expect(read(binary, diffOf('@@ -9 +9 @@', '-nine', '+NINE'))).toEqual([]);
  });

  it('keeps every file the change listed, however little of it the record diff shows', () => {
    const change = diffOf('@@ -9 +9 @@', '-nine', '+NINE');

    expect([...changeInRecord('', listed(change)).keys()]).toEqual([FILE]);
  });
});

describe('the one state a range is painted as', () => {
  it('is walked for two callers, whatever stopped', () => {
    expect(stateOf(range([called('a'), called('b')]))).toBe('walked');
  });

  it('is alone for one caller only when every case that could have reached it finished', () => {
    expect(stateOf(range([called('a')], []))).toBe('alone');
    expect(stateOf(range([called('a')], [stopped]))).toBe('walked');
    expect(stateOf(range([called('a')]))).toBeUndefined();
  });

  it('is loaded when the only entry was while the module evaluated', () => {
    expect(stateOf(range([carried('a')], []))).toBe('loaded');
    expect(stateOf(range([], undefined, true))).toBe('loaded');
  });

  it('tells a hole from an unwalked range, and says neither when it cannot', () => {
    expect(stateOf(range([], [stopped]))).toBe('hole');
    expect(stateOf(range([], []))).toBe('unwalked');
    expect(stateOf(range([]))).toBeUndefined();
  });
});

/**
 * Two texts of one file, read the way `covering` reads where a test ran over
 * another text than the one held: the held text's range is placed in the other
 * text, and a range no hunk touched is the same in both.
 */
const HELD = ['export function pay(amount) {', '  return amount;', '}', 'export function fee() {', '  return 2;', '}', ''].join('\n');
const RAN = ['export function pay(amount) {', '  return amount;', '}', 'export function fee() {', '  return 1;', '}', ''].join('\n');

describe('a range of one text placed in another', () => {
  it('is the same where no hunk touched it, and moved where one did', () => {
    const place = placeAcross(HELD, RAN);
    expect(place({ startLine: 1, endLine: 3 })).toEqual({ lines: { startLine: 1, endLine: 3 }, moved: false });
    expect(place({ startLine: 4, endLine: 6 })?.moved).toBe(true);
  });
});

/**
 * A repository holding `src/pay.ts` and `src/same.ts` at {@link RAN}, and a
 * snapshot at its commit with both instrumented over it, `src/env.ts` loaded
 * uninstrumented, and `src/two.ts` cut from two texts.
 */
async function recorded(run: (root: string, snapshot: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-placed-')));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/pay.ts'), RAN);
    await writeFile(join(root, 'src/same.ts'), RAN);
    const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'ran');
    const module = (file: string, sourceDigest: string, instrumented: boolean) => ({
      file,
      sourceDigest,
      instrumented,
      blocks: instrumented
        ? [{ ordinal: 0, kind: 'module' as const, digest: `block:${file}`, name: '', path: 'module', startLine: 1, endLine: 6, source: true, testFiles: ['src/pay.test.ts'] }]
        : [],
    });
    const coverage: TestCoverage = {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      commit: await git('rev-parse', 'HEAD'),
      tests: [{ file: 'src/pay.test.ts', complete: true, preconditions: [{ name: 'src/pay.test.ts', digest: 'source:test' }] }],
      modules: [
        module('src/pay.ts', digestString(RAN), true),
        module('src/same.ts', digestString(RAN), true),
        module('src/env.ts', 'source:env', false),
        module('src/two.ts', 'source:one', true),
        module('src/two.ts', 'source:two', true),
      ],
    };
    const snapshot = join(root, 'coverage.bin');
    await writeFile(snapshot, encodeTestCoverage(coverage));
    await run(root, snapshot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('the text a snapshot recorded each held file from', () => {
  it('is the held text where the record is its own, the commit\'s where the commit holds it, and none where nothing does', async () => {
    await recorded(async (root, snapshot) => {
      const held = new Map([['src/pay.ts', HELD], ['src/same.ts', RAN], ['src/env.ts', HELD], ['src/two.ts', RAN], ['src/gone.ts', HELD]]);
      const placed = placeInTexts(snapshot, root, held);
      expect(Object.fromEntries([...placed].map(([file, placement]) => [file, { frame: placement.frame, recorded: placement.recorded }]))).toEqual({
        'src/pay.ts': { frame: 'mapped', recorded: RAN },
        'src/same.ts': { frame: 'recorded', recorded: RAN },
        'src/two.ts': { frame: 'stale' },
      });
      expect(placed.get('src/two.ts')).not.toHaveProperty('recorded');
      // No held line is a recorded one where the numbering text is not found, so neither a range nor a line is placed.
      const stale = placed.get('src/two.ts')!;
      expect([stale.place({ startLine: 1, endLine: 2 }), stale.recordedLine(1)]).toEqual([undefined, undefined]);
      expect(placeInText(snapshot, root, 'src/pay.ts', HELD)?.recorded).toBe(RAN);
    });
  });
});
