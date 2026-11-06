import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { caseSectionsAt } from './case-record.js';
import { landRun } from './commit-runs.js';
import { coverageBlock } from './coverage-rows.js';
import { CrossingSets } from './crossing-sets.js';
import { changedLines } from './diff-lines.js';
import { narrowByJourneys } from './execution-select.js';
import { decodeExecutionIndex } from './execution-format.js';
import { NO_OWNER } from './format-layout.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { coveringTests } from './reverse.js';
import { readTestCoverage, testCoverageFile, type CoverageModule, type TestCoverage } from './index.js';
import { readJourneyChange } from './journey-reading.js';

/**
 * A local run made at the mainline's own commit, over a text in which the
 * mainline's regions were edited. The run re-records only the test for what it
 * wrote, so the older tests' cases are carried onto the regions it cut.
 *
 * The edit between the two texts decides where they land. A region the edit
 * left alone keeps its cases at the lines the edit places it. A region it
 * touched carries none as cases that ran it: they ran another text there, so
 * each is kept on it flagged, which a selection runs and no reader names. A
 * region it wrote takes the cases of the function around it. No region is paired with another by its name: two callbacks given
 * to `useEffect` are both `useEffect.arg0`, and deleting the first while
 * writing one behind the second must not hand the first's cases to the second's
 * seat.
 */

const FILE = 'src/component.ts';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const THREE = 'test/three.test.ts';

/** The call each test file makes, named by the line a region's body holds. */
const RUNS: Record<string, string> = { 'first();': ONE, 'second();': TWO, 'third();': THREE };

const effect = (dependency: string, ...calls: string[]): string =>
  `  useEffect(() => {\n${calls.map((line) => `    ${line}\n`).join('')}  }, [${dependency}]);\n`;
const component = (...effects: string[]): string => `export function component() {\n${effects.join('\n')}}\n`;

/** Two effects, the first calling `first()` and the second `second()` over three lines. */
const TWO_EFFECTS = component(effect('a', 'first();'), effect('b', 'second();', 'again();', 'more();'));
/** The first effect deleted and a new one written behind the second, which no line of the edit touches. */
const SWAPPED = component(effect('b', 'second();', 'again();', 'more();'), effect('c', 'third();'));
/** `second()`'s body edited in place, nothing else touched. */
const EDITED = component(effect('a', 'first();'), effect('b', 'second();', 'again();', 'afterwards();'));
/** A comment written inside the second effect: nothing that runs changed, and its lines no longer match. */
const COMMENTED = component(effect('a', 'first();'), effect('b', 'second();', '// why', 'again();', 'more();'));

interface Region {
  readonly block: Omit<CoverageModule['blocks'][number], 'testFiles'>;
  readonly ran: readonly string[];
}

/** The regions of `text`, each with the tests of `tests` whose call its body holds. */
function regionsOf(text: string, tests: readonly string[]): readonly Region[] {
  const lines = text.split('\n');
  return instrument(text, FILE, FILE)!.blocks.map((block) => {
    const { testFiles: _testFiles, ...row } = coverageBlock(text, block);
    if (row.kind === 'module' || row.name === 'component') return { block: row, ran: tests };
    const body = lines.slice(row.startLine - 1, row.endLine).join('\n');
    const runner = Object.entries(RUNS).find(([call]) => body.includes(call))?.[1];
    return { block: row, ran: runner !== undefined && tests.includes(runner) ? [runner] : [] };
  });
}

function recording(text: string, tests: readonly string[], commit: string): TestCoverage {
  const fresh = instrument(text, FILE, FILE)!;
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: tests.map((file) => ({ file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }] })),
    modules: [{
      file: FILE,
      sourceDigest: fresh.sourceDigest,
      instrumented: true,
      blocks: regionsOf(text, tests).map(({ block, ran }) => ({ ...block, testFiles: [...ran] })),
    }],
  };
}

const caseOf = (file: string): string => `${file} > runs`;

/**
 * The run's own case index: one case per test file, calling the regions its
 * file ran. A cut that `lacks` a call holds no region of the effect calling it,
 * as an older cut of the same text did.
 */
function casesOf(text: string, tests: readonly string[], lacks?: string): Uint8Array {
  const lines = text.split('\n');
  const regions = regionsOf(text, tests).filter(({ block }) =>
    lacks === undefined || !block.name.includes('useEffect') || !lines.slice(block.startLine - 1, block.endLine).join('\n').includes(lacks));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  return encodeSetExecutionIndex({
    tests: tests.map((file) => ({ id: caseOf(file), file, name: 'runs' })),
    modules: [{
      file: FILE,
      blocks: regions.map(({ block }) => ({
        kind: block.kind, name: block.name, path: block.path, startLine: block.startLine, endLine: block.endLine, source: block.source,
      })),
      called: Uint32Array.from(regions, ({ ran }) => sets.intern(ran.map((file) => tests.indexOf(file)))),
      loaded: new Uint8Array(regions.length),
      owner: Uint32Array.from(regions, ({ block }) =>
        (block.owner === undefined ? NO_OWNER : regions.findIndex((region) => region.block.ordinal === block.owner))),
    }],
    sets: sets.pool(),
  });
}

/** The tests on each effect, named by the call its body holds; the effects of `text` only. */
function onEffects(text: string, blocks: readonly { readonly name: string; readonly startLine: number; readonly endLine: number; readonly on: readonly string[] }[]): Record<string, string[]> {
  const lines = text.split('\n');
  const on: Record<string, string[]> = {};
  for (const block of blocks) {
    if (!block.name.includes('useEffect')) continue;
    const body = lines.slice(block.startLine - 1, block.endLine).join('\n');
    on[Object.keys(RUNS).find((call) => body.includes(call)) ?? 'unnamed'] = [...block.on].sort();
  }
  return on;
}

interface Landed {
  readonly coverage: Record<string, string[]>;
  /** The cases that ran each effect. */
  readonly cases: Record<string, string[]>;
  /** The cases flagged on each effect: they ran another text there, so whether they ran it is not known. */
  readonly overwritten: Record<string, string[]>;
  /** The cases `variance covering --line` names at the line of the call in the landed text. */
  readonly covering: (call: string) => string[];
  /** The test files the selection enters for a diff rewriting the line of each call in the landed text. */
  readonly selects: Record<string, string[]>;
}

/**
 * The mainline's run over `base` for ONE and TWO, its cut lacking the effect
 * of the call `lacks` names, then a local leg at the same commit over `dirty`
 * for THREE.
 */
async function landBoth(base: string, dirty: string, options: { readonly commitBase?: boolean; readonly lacks?: string } = {}): Promise<Landed> {
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-carry-diff-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    await mkdir(resolve(root, 'test'), { recursive: true });
    for (const test of [ONE, TWO, THREE]) await writeFile(resolve(root, test), '', 'utf8');
    // A commit that does not hold the text the first run records over leaves it to the landing's kept texts.
    await writeFile(resolve(root, FILE), options.commitBase === false ? `// the commit holds another text\n${base}` : base, 'utf8');
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'the mainline');
    const commit = await git('rev-parse', 'HEAD');
    if (options.commitBase === false) await writeFile(resolve(root, FILE), base, 'utf8');
    const coverageFile = testCoverageFile(root, { cacheRoot });
    const whole = (file: string) => ({ file, complete: true });

    await landRun(coverageFile, recording(base, [ONE, TWO], commit), root, cacheRoot, {
      fresh: casesOf(base, [ONE, TWO], options.lacks),
      run: { tests: [whole(ONE), whole(TWO)], commit },
    });
    await writeFile(resolve(root, FILE), dirty, 'utf8');
    await landRun(coverageFile, recording(dirty, [THREE], commit), root, cacheRoot, {
      fresh: casesOf(dirty, [THREE]),
      run: { tests: [whole(THREE)], commit },
    });

    const landed = await readTestCoverage(coverageFile);
    const module = landed.modules.find((row) => row.file === FILE)!;
    const index = decodeExecutionIndex(caseSectionsAt(coverageFile).index!);
    const caseModule = index.modules.find((row) => row.file === FILE)!;
    const lines = dirty.split('\n');
    // Each selection is asked of the landed text as committed, the record opened from disk.
    await git('commit', '--quiet', '--all', '--message', 'the local leg');
    const selects: Record<string, string[]> = {};
    for (const call of Object.keys(RUNS).filter((call) => dirty.includes(call))) {
      await writeFile(resolve(root, FILE), dirty.replace(call, `${call} again();`), 'utf8');
      const diff = `${await git('diff', '--no-color', '--', FILE)}\n`;
      const { read } = readJourneyChange(diff, (file) => (file === FILE ? dirty : undefined), { root });
      const narrowing = narrowByJourneys(decodeExecutionIndex(caseSectionsAt(coverageFile).index!), changedLines(diff), { read });
      selects[call] = [...narrowing.entered].sort();
    }
    await writeFile(resolve(root, FILE), dirty, 'utf8');
    return {
      selects,
      covering: (call) => coveringTests(index, { file: FILE, line: lines.findIndex((line) => line.includes(call)) + 1 }).map((test) => test.id).sort(),
      coverage: onEffects(dirty, module.blocks.map((block) => ({ ...block, on: block.testFiles }))),
      cases: onEffects(dirty, caseModule.blocks.map((block) => ({ ...block, on: block.crossings.filter((crossing) => crossing.overwritten !== true).map((crossing) => index.tests[crossing.test]!.id) }))),
      overwritten: onEffects(dirty, caseModule.blocks.map((block) => ({ ...block, on: block.crossings.filter((crossing) => crossing.overwritten === true).map((crossing) => index.tests[crossing.test]!.id) }))),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

describe('the cases of a mainline run, carried onto a local leg through the edit between their texts', () => {
  it('keeps the surviving effect on the test that ran it when the first of two same-named effects is deleted and one is written behind', async () => {
    const { cases } = await landBoth(TWO_EFFECTS, SWAPPED);

    // `second()` ran under TWO and no line of the edit touches it. Paired with the
    // old effects by name and seat it is handed `first()`'s test, and a later edit
    // to it would skip TWO, the test that ran it.
    expect(cases['second();']).toEqual([caseOf(TWO)]);
    expect(cases['third();']).toContain(caseOf(THREE));
  });

  it('hands the effect written behind the survivor no case of the one that was deleted', async () => {
    const { cases, overwritten } = await landBoth(TWO_EFFECTS, SWAPPED);

    expect(cases['third();']).not.toContain(caseOf(TWO));
    // TWO ran the function around it in a text without it, so an edit to it runs TWO.
    expect(overwritten['third();']).toContain(caseOf(TWO));
  });

  it('carries no case onto the effect whose body was edited, nor onto the function around it', async () => {
    const { cases, overwritten } = await landBoth(TWO_EFFECTS, EDITED);

    // `first()` stands where it stood and keeps its test. The edit is inside the
    // second effect and so inside the function around it: both changed, and the
    // tests that ran them run again instead of being credited with the new text.
    expect(cases['first();']).toEqual([caseOf(ONE)]);
    expect(cases['second();']).toEqual([]);
    // They ran another text there, so an edit to it runs them, and no reader names them.
    expect(overwritten).toEqual({ 'first();': [], 'second();': [caseOf(TWO)] });
  });

  it('finds the text the first run recorded over in the kept texts when the commit holds another', async () => {
    const { cases } = await landBoth(TWO_EFFECTS, SWAPPED, { commitBase: false });

    expect(cases['second();']).toEqual([caseOf(TWO)]);
    expect(cases['third();']).not.toContain(caseOf(TWO));
  });

  it('names, for a later edit of each effect, the tests that ran that effect and no other', async () => {
    const { covering } = await landBoth(TWO_EFFECTS, SWAPPED);

    // The query a change to a line is answered by: the survivor's body selects
    // TWO alone, the effect written behind it THREE alone.
    expect(covering('second();')).toEqual([caseOf(TWO)]);
    expect(covering('third();')).toEqual([caseOf(THREE)]);
  });

  it('selects, for an edit in either effect, every test the function around them ran, where the mainline cut lacked the first and a comment moved the second', async () => {
    const { cases, selects } = await landBoth(TWO_EFFECTS, COMMENTED, { lacks: 'first();' });

    // Known: the mainline cut held the second effect alone, with TWO on it, and
    // the function, with ONE and TWO. The comment changed nothing that runs, but
    // the fresh cut holds two effects where the held one held one, and the
    // second no longer stands at its lines: neither effect is the held one, so
    // each inherits the function's cases, never the held effect's alone.
    expect(cases).toEqual({ 'first();': [caseOf(ONE), caseOf(TWO)], 'second();': [caseOf(ONE), caseOf(TWO)] });
    // An edit inside the first effect selects ONE, the test that ran it, which
    // its cut never named; neither edit selects THREE, which ran neither.
    expect(selects).toEqual({ 'first();': [ONE, TWO], 'second();': [ONE, TWO] });
  });
});
