import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  atDistance,
  testCoverageFile,
  writeTestCoverage,
  type ExecutionNarrowing,
  type TestCoverage,
  type TestDistance,
} from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { answerConfigless, withoutConfig } from './configless.js';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';
import { inLeg } from './select-leg.js';
import { formatSelection, selectionNotes, skippableTests, type SelectInput } from './select.js';

/**
 * `variance select --at-distance`: one leg of the selection, as a skip list.
 *
 * The leg is the same one a seam runs under `VARIANCE_AUTHORITY_AT_DISTANCE`, so the
 * cases below hold the two together on the property that makes a loop of legs
 * safe: `0-2` and then `3-` run every selected file, and a selection that
 * declines to narrow skips nothing whichever leg was asked.
 */

const NEAR = 'test/near.test.ts';
const MID = 'test/mid.test.ts';
const FAR = 'test/far.test.ts';
const GHOST = 'test/ghost.test.ts';
const IDLE = 'test/idle.test.ts';
const WHOLE = [FAR, GHOST, IDLE, MID, NEAR];
const DISTANCES: readonly TestDistance[] = [
  { test: NEAR, bearing: 'direct', hops: 1 },
  { test: MID, bearing: 'transitive', hops: 2 },
  { test: FAR, bearing: 'transitive', hops: 3 },
  { test: GHOST, bearing: 'unexplained' },
];

function read(distances: readonly TestDistance[] = DISTANCES, incomplete?: readonly string[]): SelectInput {
  const narrowing: ExecutionNarrowing = {
    whole: WHOLE,
    ...(incomplete === undefined ? {} : { incomplete }),
    entered: [FAR, GHOST, MID, NEAR],
    unread: [],
    stale: [],
    because: [],
  };
  return { at: '/cache/coverage.bin', commit: 'c0ffee', ground: { kind: 'read', narrowing, distances } };
}

describe('--at-distance on the command line', () => {
  it('reads a range of hop counts', () => {
    expect(parseArgs(['select', '--at-distance', '0-2'])).toMatchObject({ atDistance: { from: 0, to: 2 } });
    expect(parseArgs(['select', '--at-distance', '3-'])).toMatchObject({ atDistance: { from: 3 } });
  });

  it('refuses what is not a range of hop counts', () => {
    expect(() => parseArgs(['select', '--at-distance', '0-e'])).toThrow(/--at-distance takes hop counts/);
  });
});

describe('one leg of the selection', () => {
  it('leaves the selection alone when no leg is asked', () => {
    const input = read();
    expect(inLeg(skippableTests(input), input, undefined)).toEqual(skippableTests(input));
  });

  it('skips the tests further out than the leg, and names them as left', () => {
    const input = read();
    const selection = inLeg(skippableTests(input), input, { from: 0, to: 2 });

    // The ghost has no measured distance, and rides with the leg that reaches the end.
    expect(selection.skip).toEqual([FAR, GHOST, IDLE]);
    expect(selection.left).toEqual([FAR, GHOST]);
    expect(selection.leg).toEqual({ from: 0, to: 2 });
    expect(selection.widened).toBeUndefined();
  });

  it('skips the tests nearer than an open leg, and runs the unplaced with it', () => {
    const input = read();
    const selection = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(selection.skip).toEqual([IDLE, MID, NEAR]);
    expect(selection.left).toEqual([MID, NEAR]);
    expect(selection.leg).toEqual({ from: 3 });
  });

  it('runs each selected file in one of `0-2` and `3-`', () => {
    const input = read();
    const runs = (from: number, to: number) => {
      const { skip } = inLeg(skippableTests(input), input, { from, to });
      return WHOLE.filter((test) => !skip.includes(test));
    };

    expect([...runs(0, 2), ...runs(3, Number.MAX_SAFE_INTEGER)].sort()).toEqual([FAR, GHOST, MID, NEAR]);
    expect(runs(0, 2)).toEqual([...atDistance(DISTANCES, 0, 2)].sort());
  });

  it('runs an entered test with no distance in the end leg, as an unplaced one', () => {
    const input = read([]);
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual(WHOLE);
    expect(end.skip).toEqual([IDLE]);
  });

  it('cuts an entered test the record never saw whole, and counts it apart from the whole', () => {
    const PARTIAL = 'test/partial.test.ts';
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: {
        kind: 'read',
        narrowing: { whole: WHOLE, entered: [FAR, GHOST, MID, NEAR, PARTIAL], unread: [], stale: [], because: [] },
        distances: [...DISTANCES, { test: PARTIAL, bearing: 'direct', hops: 1 }],
      },
    };
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(end.skip).toEqual([IDLE, MID, NEAR, PARTIAL]);
    expect(selectionNotes(end)).toContain('skipping 4 test files: 1 of 5 recorded whole covered no changed line, and 3 are outside');
  });

  it('runs a test the record holds incomplete, with no path to the change, only in the end leg', () => {
    const SKIPPED = 'test/skipped.test.ts';
    const input = read(DISTANCES, [GHOST, SKIPPED]);
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual([FAR, GHOST, IDLE, SKIPPED]);
    expect(near.left).toEqual([FAR, GHOST, SKIPPED]);
    expect(end.skip).toEqual([IDLE, MID, NEAR]);
    expect(selectionNotes(near)).toContain(
      '1 test file the record never saw whole and the change did not enter is left for the leg that reaches the end',
    );
  });

  // A placed incomplete test is measured like an entered one, so it can be the
  // furthest test of the reading: a closed leg short of it does not reach the
  // end, and an entered test with no distance waits for the leg that does.
  it('runs an unplaced entered test only in the leg past a placed incomplete test', () => {
    const PARTIAL = 'test/partial.test.ts';
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: {
        kind: 'read',
        narrowing: { whole: WHOLE, incomplete: [PARTIAL], entered: [GHOST, NEAR], unread: [], stale: [], because: [] },
        distances: [
          { test: NEAR, bearing: 'direct', hops: 1 },
          { test: GHOST, bearing: 'unexplained' },
          { test: PARTIAL, bearing: 'transitive', hops: 3 },
        ],
      },
    };
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual([FAR, GHOST, IDLE, MID, PARTIAL]);
    expect(end.skip).toEqual([FAR, IDLE, MID, NEAR]);
  });

  it('names what the leg left and the leg that runs it, on stderr', () => {
    const input = read();
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 0, to: 2 }));

    expect(err).toContain('skipping 3 test files: 1 of 5 recorded whole covered no changed line, and 2 are outside `--at-distance 0-2`');
    expect(err).toContain('2 selected test files are left for a later leg');
    expect(err).toContain('`--at-distance 3-`');
  });

  it('names the nearer leg when an open leg leaves the near tests', () => {
    const input = read();
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER }));

    expect(err).toContain('2 selected test files are left for an earlier leg, nearer than 3 hops');
    expect(err).toContain('`--at-distance 0-2`');
  });

  it('names both legs, each spelled as typed, when a middle leg leaves tests on either side', () => {
    const input = read([
      { test: NEAR, bearing: 'direct', hops: 0 },
      { test: MID, bearing: 'transitive', hops: 1 },
      { test: FAR, bearing: 'transitive', hops: 2 },
      { test: GHOST, bearing: 'unexplained' },
    ]);
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 1, to: 1 }));

    expect(err).toContain('outside `--at-distance 1`;');
    expect(err).toContain('2 selected test files are left for a later leg: the same command with `--at-distance 2-` runs them');
    expect(err).toContain(
      '1 selected test file is left for an earlier leg, nearer than 1 hop: the same command with `--at-distance 0` runs it',
    );
  });

  it('writes the leg and what it left into json', () => {
    const input = read();
    const json = JSON.parse(formatSelection(inLeg(skippableTests(input), input, { from: 0, to: 2 }), 'json', '/repo'));

    expect(json.leg).toEqual({ from: 0, to: 2 });
    expect(json.left).toEqual([FAR, GHOST]);
  });

  it('writes how far the change travelled to each test it entered into json, beside the leg', () => {
    const input = read();
    const json = JSON.parse(formatSelection(inLeg(skippableTests(input), input, { from: 0, to: 2 }), 'json', '/repo'));

    expect(json.distances).toEqual([
      { test: FAR, bearing: 'transitive', hops: 3 },
      { test: GHOST, bearing: 'unexplained' },
      { test: MID, bearing: 'transitive', hops: 2 },
      { test: NEAR, bearing: 'direct', hops: 1 },
    ]);
  });

  it('counts the selection by hops on stderr, so the next leg can be chosen from it', () => {
    const input = read();
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 0, to: 2 }));

    expect(err).toContain(
      'the change entered 4 test files: 1 at 1 hop, 1 at 2 hops, 1 at 3 hops, ' +
        'and 1 at no measured distance, which runs with the furthest leg',
    );
  });

  it('counts no distances when the change entered no test', () => {
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: { kind: 'read', narrowing: { whole: WHOLE, entered: [], unread: [], stale: [], because: [] }, distances: [] },
    };
    const selection = inLeg(skippableTests(input), input, { from: 0, to: 2 });

    expect(selection.left).toEqual([]);
    expect(selectionNotes(selection)).not.toContain('the change entered');
  });

  it('writes no leg into json when none was asked', () => {
    const input = read();
    const json = JSON.parse(formatSelection(inLeg(skippableTests(input), input, undefined), 'json', '/repo'));

    expect(json).not.toHaveProperty('leg');
    expect(json).not.toHaveProperty('left');
    expect(json).not.toHaveProperty('distances');
  });

  it.each([
    ['no-journal', { kind: 'no-journal' }],
    ['no-coverage', { kind: 'no-coverage' }],
    ['no-diff', { kind: 'no-diff', from: 'origin/main' }],
    ['no-install', { kind: 'no-install', whole: 'the lockfile at origin/main could not be read' }],
    ['before', { kind: 'before', whole: 'vitest.setup.ts changed' }],
  ] as const)('skips nothing in any leg when the ground is %s', (_, ground) => {
    const input: SelectInput = { at: '/cache/coverage.bin', ground };
    for (const leg of [{ from: 0, to: 2 }, { from: 3, to: Number.MAX_SAFE_INTEGER }]) {
      const selection = inLeg(skippableTests(input), input, leg);
      expect(selection.skip).toEqual([]);
      expect(selection.left).toEqual([]);
      expect(selectionNotes(selection)).toContain('skipping nothing');
    }
  });

  it('skips nothing in any leg when nothing was recorded whole', () => {
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: { kind: 'read', narrowing: { whole: [], entered: [], unread: [], stale: [], because: [] }, distances: [] },
    };
    const selection = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(selection.skip).toEqual([]);
    expect(selection.left).toEqual([]);
  });

  it('refuses a leg over a journey file, which measures no hops', () => {
    const input: SelectInput = { ...read(), given: true };
    expect(() => inLeg(skippableTests(input), input, { from: 0, to: 2 })).toThrow(/journey file/);
  });
});

describe('a leg read from a real record and a real graph', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-leg-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('cuts the selection by the hops the change travelled, as test:since does', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), WIDGET.replace("return 'a';", "return 'z';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const skipOf = async (atDistance?: { from: number; to: number }) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', ...(atDistance === undefined ? {} : { atDistance }) })).out);
    const all = await skipOf();
    const near = await skipOf({ from: 0, to: 2 });
    const end = await skipOf({ from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(all.skip).toEqual([IDLE]);
    expect(near.skip).toEqual([FAR, GHOST, IDLE]);
    expect(near.left).toEqual([FAR, GHOST]);
    expect(end.skip).toEqual([IDLE, MID, NEAR]);
    expect(end.left).toEqual([MID, NEAR]);
  });

  it('carries `--at-distance` from the command line to the leg it cuts', async () => {
    const { root, head } = checkout();
    // The command line answers from the working directory, which the system
    // reports by its real path, so the record is kept under that path.
    await writeTestCoverage(testCoverageFile(realpathSync(root)), snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), WIDGET.replace("return 'a';", "return 'z';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const parsed = parseArgs(['select', '--at-distance', '0-2', '--format', 'json']);
    if (!withoutConfig(parsed)) throw new Error('`select` answers without a config');
    let out = '';
    await answerConfigless(parsed, { out: (text) => (out += text), err: () => {} });

    expect(JSON.parse(out)).toMatchObject({ leg: { from: 0, to: 2 }, skip: [FAR, GHOST, IDLE], left: [FAR, GHOST] });
  });

  // A test the record holds incomplete ran cases the record did not see, and
  // one of them may call what changed. The change entered nobody here, so the
  // test is selected by being incomplete, and it is one import from the change.
  it('runs a test the record never saw whole in the leg its hops from the change put it in', async () => {
    const { root, head } = checkout({ 'src/spare.ts': SPARE, [PARTIAL]: "import { untouched } from '../src/spare';\nuntouched();\n" });
    const recorded = snapshot(head);
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      tests: [...recorded.tests, { file: PARTIAL, complete: false, preconditions: [] }],
      modules: [...recorded.modules, spareModule()],
    });
    writeFileSync(join(root, 'src/spare.ts'), SPARE.replace("return 'b';", "return 'y';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const skipOf = async (atDistance: { from: number; to: number }) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance })).out);
    const near = await skipOf({ from: 0, to: 2 });
    const end = await skipOf({ from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).not.toContain(PARTIAL);
    expect(near.distances).toContainEqual(expect.objectContaining({ test: PARTIAL, hops: 1 }));
    expect(end.left).toContain(PARTIAL);
    // Said by the leg that runs it, and by no other.
    const placedIn = /never saw whole and the change did not enter (is|are) placed in this leg/;
    expect(near.notes).toContain('1 test file the record never saw whole and the change did not enter is placed in this leg by the hops it ran to a changed file');
    expect(end.notes.filter((note: string) => placedIn.test(note))).toEqual([]);
  });

  // A file whose every case skipped, such as a browser file with no page built,
  // is recorded incomplete with only the modules it loaded. When an edit lands
  // in one of those, it runs at its hops.
  it('runs a file whose every case skipped in the leg of its hops to a changed file it loaded', async () => {
    const LOADED = 'test/loaded.chromium.test.ts';
    const { root, head } = checkout({
      'src/spare.ts': SPARE,
      [LOADED]: "import { spare } from '../src/spare';\nit.skip('spare', () => spare());\n",
    });
    const recorded = snapshot(head);
    const spare = spareModule();
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      tests: [...recorded.tests, { file: LOADED, complete: false, preconditions: [] }],
      modules: [...recorded.modules, { ...spare, blocks: spare.blocks.map((block) => ({ ...block, testFiles: [], loadedBy: [LOADED] })) }],
    });
    writeFileSync(join(root, 'src/spare.ts'), SPARE.replace("return 'b';", "return 'y';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const skipOf = async (atDistance: { from: number; to: number }) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance })).out);
    const near = await skipOf({ from: 0, to: 2 });
    const end = await skipOf({ from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.distances).toContainEqual(expect.objectContaining({ test: LOADED, hops: 1 }));
    expect(near.skip).not.toContain(LOADED);
    expect(end.left).toContain(LOADED);
  });
});

const WIDGET = ['export function widget(): string {', "  return 'a';", '}', ''].join('\n');
const CALLER = ["import { widget } from './widget';", 'export const caller = (): string => widget();', ''].join('\n');
/** Two functions: a test that did not run whole entered the first, and nothing entered the second. */
const SPARE = ['export function untouched(): string {', "  return 'a';", '}', 'export function spare(): string {', "  return 'b';", '}', ''].join('\n');
const PARTIAL = 'test/partial.test.ts';
const OUTER = ["import { caller } from './caller';", 'export const outer = (): string => caller();', ''].join('\n');

/** A widget, a caller of it and a caller of that, with one test at each distance and two more. */
function checkout(extra: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-leg-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const files: Record<string, string> = {
    'src/widget.ts': WIDGET,
    'src/caller.ts': CALLER,
    'src/outer.ts': OUTER,
    [NEAR]: "import { widget } from '../src/widget';\nwidget();\n",
    [MID]: "import { caller } from '../src/caller';\ncaller();\n",
    [FAR]: "import { outer } from '../src/outer';\nouter();\n",
    // Loads the widget by a path no import names, so no executed path is measured.
    [GHOST]: "await import(['..', 'src', 'widget'].join('/'));\n",
    [IDLE]: 'export {};\n',
    ...extra,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']) };
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
    tests: WHOLE.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      moduleOf('src/widget.ts', WIDGET, 3, [FAR, GHOST, MID, NEAR], 'widget'),
      moduleOf('src/caller.ts', CALLER, 2, [FAR, MID]),
      moduleOf('src/outer.ts', OUTER, 2, [FAR]),
    ],
  };
}

/** `src/spare.ts`, as a run that skipped some of `PARTIAL`'s cases recorded it. */
function spareModule(): TestCoverage['modules'][number] {
  const block = { source: true, testFiles: [PARTIAL] };
  return {
    file: 'src/spare.ts',
    sourceDigest: digestString(SPARE),
    instrumented: true,
    blocks: [
      { ...block, ordinal: 0, kind: 'module', digest: digestString('src/spare.ts'), name: 'src/spare.ts', path: 'module', startLine: 1, endLine: 6 },
      { ...block, ordinal: 1, kind: 'function', owner: 0, digest: digestString('untouched'), name: 'untouched', path: 'untouched', startLine: 1, endLine: 3 },
      { ...block, ordinal: 2, kind: 'function', owner: 0, digest: digestString('spare'), name: 'spare', path: 'spare', startLine: 4, endLine: 6, testFiles: [] },
    ],
  };
}
