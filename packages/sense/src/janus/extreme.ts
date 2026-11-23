// compass: variance-authority.reach
/**
 * What one recorded test would not notice broken: each region it entered,
 * broken in the extreme, served under a command that runs the test.
 *
 * A function returns nothing; a branch, a continuation or a handler is
 * skipped. That is the extreme mutation of pseudo-tested code (Niedermayr,
 * Juergens & Wagner, CSED 2016; Descartes, ASE 2018): one break per region,
 * so the run is one test per region, and the record chooses the regions, so no
 * coverage pass runs first. A loop body is not broken: emptying one can leave
 * the loop running for ever. A break that still runs past a deadline is
 * stopped and named as hung.
 *
 * Each break is cut from the source as the checkout has it now, by the same
 * `spliced` the instrumenter cuts the record's regions with, after the
 * record's lines are placed in it from the commit it was made at; and it is
 * served by {@link serveBase}: nothing is written to the checkout, and the
 * command's record goes to a scratch directory, so the real one is left as it
 * was.
 */

import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { spliced, type Block } from '../instrument/spliced.js';
import { linesThen, testsRan } from '../journeys.js';
import type { NativeJourneyCase, NativeRanRegion } from '../native-journeys.js';
import { linesOf } from '../read.js';
import { CACHE_VARIABLE, rootConfig } from '../test-selection/cache-layers.js';
import { serveBase, type ServedOptions } from './serve-base.js';

/** The kinds of region a break is made in. */
const BROKEN = new Set(['function', 'branch', 'continuation', 'handler']);

/** A break may run this many times as long as the run with nothing broken, and never less than {@link DEADLINE_FLOOR} milliseconds. */
const DEADLINE_FACTOR = 5;
const DEADLINE_FLOOR = 2_000;

/** One region the asked test entered, where the record places it. */
export interface ExtremeRegion {
  readonly file: string;
  readonly kind: string;
  readonly line: number;
  readonly end: number;
  readonly function?: string;
  /** How many other tests entered it. */
  readonly others: number;
}

/** A region the ask did not break, and why. */
export interface Unbroken {
  readonly region: ExtremeRegion;
  readonly reason: string;
}

/** What the asked test did under each break. */
export interface ExtremeAnswer {
  readonly test: NativeJourneyCase;
  /** Broken, and the command still passed. */
  readonly survived: readonly ExtremeRegion[];
  /** Broken, and the command failed. */
  readonly noticed: readonly ExtremeRegion[];
  /** Broken, and the command was still running at its deadline, so it was stopped: neither a pass nor a failure. */
  readonly hung: readonly ExtremeRegion[];
  readonly unbroken: readonly Unbroken[];
  /** How many regions the test entered past the cap, and so were not broken. */
  readonly pastCap: number;
}

/** Why an ask could not answer. */
export interface ExtremeRefusal {
  readonly refused: string;
}

/** The test to ask about, and the command that runs it. */
export interface ExtremeAsk {
  /** The checkout the record is kept for, and the files' root. */
  readonly root: string;
  /** The test file that declares the test, and the test's name, as `testsRan` takes them. */
  readonly file: string;
  readonly name?: string;
  /** The command that runs the asked test, started in `cwd`. */
  readonly command: readonly [string, ...string[]];
  readonly cwd: string;
  /** How many regions to break, fewest other tests first. */
  readonly limit: number;
}

/** A region with the commit its lines are spans of, when its recording names one. */
interface Asked {
  readonly region: ExtremeRegion;
  readonly commit: string | undefined;
}

/**
 * Break each region the asked test entered, fewest other tests first, and
 * run the command under each break. Refused when the record names no such
 * test, or different tests in different suites; when the checkout's
 * configuration names a cache root the command's runs would record into;
 * when the command cannot start; and when it fails with nothing broken.
 */
export async function extremeBreaks({ root, file, name, command, cwd, limit }: ExtremeAsk): Promise<ExtremeAnswer | ExtremeRefusal> {
  const asked = enteredRegions(root, file, name);
  if ('refused' in asked) return asked;
  const config = rootConfig(root);
  if (config?.value['cacheRoot'] !== undefined) {
    return { refused: `${config.file} names a \`cacheRoot\`, which every run of the command records into, so a broken run would land in the record: ask from a checkout whose configuration names none` };
  }
  const scratch = await mkdtemp(join(tmpdir(), 'variance-extreme-'));
  try {
    // The command's own record goes here, so no break folds into the checkout's.
    const unbrokenOptions: ServedOptions = { env: { [CACHE_VARIABLE]: scratch }, stdio: ['ignore', 2, 2] };
    const begun = performance.now();
    const unbrokenRun = await serveBase({}, command, cwd, unbrokenOptions);
    if (unbrokenRun === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
    if (unbrokenRun.exit !== 0) return { refused: `the command fails with nothing broken (exit ${unbrokenRun.exit}), so no break can be told apart from it: run it alone to see why` };
    const options: ServedOptions = { ...unbrokenOptions, deadline: Math.max(DEADLINE_FLOOR, Math.ceil((performance.now() - begun) * DEADLINE_FACTOR)) };
    const survived: ExtremeRegion[] = [];
    const noticed: ExtremeRegion[] = [];
    const hung: ExtremeRegion[] = [];
    const unbroken: Unbroken[] = [];
    const cuts = new Map<string, Cut | undefined>();
    for (const { region, commit } of asked.regions.slice(0, limit)) {
      if (!cuts.has(region.file)) cuts.set(region.file, await cutOf(root, region.file));
      const cut = cuts.get(region.file);
      const broken = cut === undefined ? { reason: 'the checkout no longer holds the file, or the instrumenter does not cut it' } : extremeBreak(root, cut, region, commit);
      if ('reason' in broken) {
        unbroken.push({ region, reason: broken.reason });
        continue;
      }
      const served = await serveBase({ [cut!.path]: broken.text }, command, cwd, options);
      if (served === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
      if (served.late) hung.push(region);
      else if (served.unread.length > 0) unbroken.push({ region, reason: 'no process the command started read the file, so the break was not run' });
      else (served.exit === 0 ? survived : noticed).push(region);
    }
    return { test: asked.test, survived, noticed, hung, unbroken, pastCap: Math.max(0, asked.regions.length - limit) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The source regions the asked test entered in every suite that recorded it, once each, fewest other tests first. */
function enteredRegions(root: string, file: string, name: string | undefined): { test: NativeJourneyCase; regions: Asked[] } | ExtremeRefusal {
  const suites = testsRan(root, file, name);
  const named = suites.filter((suite) => suite.ran.test != null);
  const test = named[0]?.ran.test;
  if (test == null) return { refused: suites.map((suite) => suite.ran.notRecorded).find((why) => why != null) ?? 'the recording names no test to read' };
  const other = named.map((suite) => suite.ran.test!).find((each) => each.file !== test.file || each.name !== test.name);
  if (other !== undefined) return { refused: `the suites name different tests for it, \`${test.name}\` and \`${other.name}\`: ask by the whole name` };
  const regions = new Map<string, Asked>();
  for (const { ran, commit } of named) {
    for (const { file: module, regions: ranRegions } of ran.modules) {
      for (const region of ranRegions.filter(breakable)) {
        const key = `${commit ?? ''}\0${module}\0${region.kind}\0${region.line}\0${region.end}\0${region.function ?? ''}`;
        const held = regions.get(key);
        if (held === undefined || region.others < held.region.others) regions.set(key, { region: placed(module, region), commit });
      }
    }
  }
  const order = (a: Asked, b: Asked): number =>
    a.region.others - b.region.others || (a.region.file < b.region.file ? -1 : a.region.file > b.region.file ? 1 : a.region.line - b.region.line || a.region.end - b.region.end);
  return { test, regions: [...regions.values()].sort(order) };
}

const breakable = (region: NativeRanRegion): boolean => region.entered && region.source && BROKEN.has(region.kind);

function placed(file: string, region: NativeRanRegion): ExtremeRegion {
  const { kind, line, end, others } = region;
  return { file, kind, line, end, others, ...(region.function == null ? {} : { function: region.function }) };
}

/** One file as the checkout holds it now, cut into the regions the instrumenter keeps. */
interface Cut {
  readonly file: string;
  readonly path: string;
  readonly source: string;
  readonly blocks: readonly Block[];
  readonly lineOf: (offset: number) => number;
  /** Where each line now stood at a commit, read once per commit. */
  readonly atCommit: Map<string, ReturnType<typeof linesThen>>;
}

async function cutOf(root: string, file: string): Promise<Cut | undefined> {
  const path = await realpath(join(root, file)).catch(() => undefined);
  if (path === undefined) return undefined;
  const source = await readFile(path, 'utf8');
  const cut = spliced(source, path, 'presence');
  if (cut === undefined) return undefined;
  return { file, path, source, blocks: cut.blocks, lineOf: linesOf(source), atCommit: new Map() };
}

/** Where the lines `first` to `last` of the cut file stood at `commit`: as they are when there is no commit, or nothing to place them by. */
function placedThen(root: string, cut: Cut, commit: string | undefined, first: number, last: number): readonly (number | null)[] {
  const now = Array.from({ length: last - first + 1 }, (_, at) => first + at);
  if (commit === undefined) return now;
  if (!cut.atCommit.has(commit)) {
    const count = cut.lineOf(cut.source.length);
    cut.atCommit.set(commit, linesThen(root, commit, cut.file, Array.from({ length: count }, (_, at) => at + 1)));
  }
  const then = cut.atCommit.get(commit)!;
  return then.unplaced != null ? now : now.map((line) => then.lines[line - 1] ?? null);
}

/** The cut file's text with `region` broken in the extreme, or why it cannot be. */
function extremeBreak(root: string, cut: Cut, region: ExtremeRegion, commit: string | undefined): { text: string } | { reason: string } {
  const matching = cut.blocks.filter((block) => {
    if (block.kind !== region.kind || block.start === block.end || (region.function !== undefined && block.name !== region.function)) return false;
    // The record's lines are the recorded commit's; a line written since is in no region it holds.
    const lines = placedThen(root, cut, commit, cut.lineOf(block.start), cut.lineOf(block.end - 1));
    return lines[0] === region.line && lines.at(-1) === region.end && lines.every((line) => line !== null);
  });
  const [block, ...more] = matching;
  if (block === undefined || more.length > 0) return { reason: 'its source changed since the recording, so no region of the file is the one it holds' };
  // A function's region runs from its parameters to the end of its body: replaced whole, it takes nothing and returns nothing.
  const empties = block.kind === 'function' ? ['() {}', '() => undefined'] : [cut.source[block.start] === '{' ? '{}' : ';'];
  for (const empty of empties) {
    const text = cut.source.slice(0, block.start) + empty + cut.source.slice(block.end);
    if (parseSync(cut.path, text).errors.length === 0) return { text };
  }
  return { reason: 'the break does not parse' };
}
