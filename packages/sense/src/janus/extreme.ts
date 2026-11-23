// compass: variance-authority.reach
/**
 * What one recorded test would not notice broken: each region it entered,
 * broken in the extreme — a function returns nothing, a branch, continuation
 * or handler is skipped — and served under a command that runs the test. That
 * is the extreme mutation of pseudo-tested code (Niedermayr, Juergens & Wagner,
 * CSED 2016; Descartes, ASE 2018): the record chooses the regions, so no
 * coverage pass runs first, and nothing is written to the checkout or its record.
 */

import type { StdioOptions } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { instrumentModeOf } from '../instrument/identity.js';
import type { Block } from '../instrument/index.js';
import type { WalkMode } from '../instrument/spliced.js';
import { linesThen, testsRan } from '../journeys.js';
import type { NativeJourneyCase, NativeLinesThen, NativeRanRegion } from '../native-journeys.js';
import { CACHE_VARIABLE, rootConfig } from '../test-selection/cache-layers.js';
import { sourceCut } from '../test-selection/coverage-rows.js';
import { askCoverageFile } from '../test-selection/coverage-file.js';
import type { CoverageBlock } from '../test-selection/index.js';
import { servedRun } from './serve-base.js';

/** The kinds of region a break is made in: not a loop body, since emptying one can leave the loop running for ever. */
const BROKEN = new Set(['function', 'branch', 'continuation', 'handler']);

/** A break may run this many times as long as the run with nothing broken, and never less than {@link DEADLINE_FLOOR} milliseconds. */
const DEADLINE_FACTOR = 5;
const DEADLINE_FLOOR = 2_000;

/** One region the asked test entered. */
export interface ExtremeRegion {
  readonly file: string;
  readonly kind: string;
  /** Where the region stands in the file now when it was broken, and where the record places it when it was not. */
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
  /** How many more regions the test entered once the cap of breaks was run, which were not tried. */
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
  /** How many breaks to run, fewest other tests first. */
  readonly limit: number;
}

/** A region, with the commit its lines are spans of and the probes it was cut by, as its recording names them. */
interface Asked {
  readonly region: ExtremeRegion;
  readonly commit: string | undefined;
  readonly mode: WalkMode | undefined;
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
    const stdio: StdioOptions = ['ignore', 2, 2];
    const unbrokenOptions = { env: { [CACHE_VARIABLE]: scratch }, stdio };
    const begun = performance.now();
    const unbrokenRun = await servedRun({}, command, cwd, unbrokenOptions);
    if (unbrokenRun === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
    if (unbrokenRun.exit !== 0) return { refused: `the command fails with nothing broken (exit ${unbrokenRun.exit}), so no break can be told apart from it: run it alone to see why` };
    const options = { ...unbrokenOptions, deadline: Math.max(DEADLINE_FLOOR, Math.ceil((performance.now() - begun) * DEADLINE_FACTOR)) };
    const survived: ExtremeRegion[] = [];
    const noticed: ExtremeRegion[] = [];
    const hung: ExtremeRegion[] = [];
    const unbroken: Unbroken[] = [];
    const cuts = new Map<string, Cut | undefined>();
    const tried = new Set<string>();
    let pastCap = 0;
    for (const { region, commit, mode } of asked.regions) {
      if (tried.size >= limit) {
        pastCap += 1;
        continue;
      }
      const reason = (why: string): void => void unbroken.push({ region, reason: why });
      if (mode === undefined) {
        reason('its recording was made by probes this build does not cut, so no region of the file can be matched to it');
        continue;
      }
      if (commit === undefined) {
        reason('its recording names no commit, so its lines cannot be placed in the file as it is now');
        continue;
      }
      const key = `${mode}\0${region.file}`;
      if (!cuts.has(key)) cuts.set(key, await cutOf(root, region.file, mode));
      const cut = cuts.get(key);
      if (cut === undefined) {
        reason('the checkout no longer holds the file, or the instrumenter does not cut it');
        continue;
      }
      const broken = extremeBreak(root, cut, region, commit);
      if ('reason' in broken) {
        reason(broken.reason);
        continue;
      }
      // Two suites can record one region at two commits: it is the block in today's text that is broken, once.
      const block = `${cut.path}\0${broken.start}\0${broken.end}`;
      if (tried.has(block)) continue;
      tried.add(block);
      const now = { ...region, line: broken.line, end: broken.endLine };
      const served = await servedRun({ [cut.path]: broken.text }, command, cwd, options);
      if (served === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
      if (served.late) hung.push(now);
      else if (served.unread.length > 0) unbroken.push({ region: now, reason: 'no process the command started read the file, so the break was not run' });
      else (served.exit === 0 ? survived : noticed).push(now);
    }
    return { test: asked.test, survived, noticed, hung, unbroken, pastCap };
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
  for (const { ran, commit, recording } of named) {
    const mode = instrumentModeOf(askCoverageFile(recording, (view) => view.instrumentation));
    const walked = mode === 'loads' ? undefined : mode;
    for (const { file: module, regions: ranRegions } of ran.modules) {
      for (const region of ranRegions.filter(breakable)) {
        const key = `${commit ?? ''}\0${walked ?? ''}\0${module}\0${region.kind}\0${region.line}\0${region.end}\0${region.function ?? ''}`;
        const held = regions.get(key);
        if (held === undefined || region.others < held.region.others) regions.set(key, { region: placed(module, region), commit, mode: walked });
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

/** One file as the checkout holds it now, cut as a seam under the recording's probes would cut it. */
interface Cut {
  readonly file: string;
  readonly path: string;
  readonly source: string;
  /** Each row the cut makes at the file's own lines, beside the block it was made from. */
  readonly rows: readonly { readonly row: CoverageBlock; readonly block: Block }[];
  /** Where each line now stood at a commit, read once per commit. */
  readonly atCommit: Map<string, NativeLinesThen>;
  readonly lines: number;
}

async function cutOf(root: string, file: string, mode: WalkMode): Promise<Cut | undefined> {
  const path = await realpath(join(root, file)).catch(() => undefined);
  if (path === undefined) return undefined;
  const source = await readFile(path, 'utf8');
  const cut = sourceCut(source, path, mode);
  if (cut === undefined) return undefined;
  const blocks = new Map(cut.blocks.map((block) => [block.ordinal, block]));
  const rows = cut.rows.flatMap((row) => {
    const block = blocks.get(row.ordinal);
    return block === undefined ? [] : [{ row, block }];
  });
  return { file, path, source, rows, atCommit: new Map(), lines: source.split('\n').length };
}

/** Where every line of the cut file stood at `commit`, read once. */
function placedAt(root: string, cut: Cut, commit: string): NativeLinesThen {
  if (!cut.atCommit.has(commit)) cut.atCommit.set(commit, linesThen(root, commit, cut.file, Array.from({ length: cut.lines }, (_, at) => at + 1)));
  return cut.atCommit.get(commit)!;
}

/** The empty text a block's span is replaced with, in the order each is tried: a function's span runs from its parameters to the end of its body. */
const empties = (kind: string, opening: string | undefined): readonly string[] => (kind === 'function' ? ['() {}', '() => undefined'] : [opening === '{' ? '{}' : ';']);

/**
 * The broken block: the cut file's text with `region` broken in the extreme,
 * and where the block stands now; or why it cannot be broken. The block is cut
 * from today's text and matched by placing its lines at the recording's commit:
 * a line that cannot be placed leaves the region unbroken rather than read where
 * it stands now.
 */
function extremeBreak(
  root: string,
  cut: Cut,
  region: ExtremeRegion,
  commit: string,
): { text: string; start: number; end: number; line: number; endLine: number } | { reason: string } {
  const then = placedAt(root, cut, commit);
  if (then.unplaced != null) return { reason: `its lines cannot be placed in the file as it is now: ${then.unplaced}` };
  const at = (line: number): number | null => then.lines[line - 1] ?? null;
  const matching = cut.rows.filter(({ row, block }) => {
    if (row.kind !== region.kind || !row.source || row.startLine === undefined || row.endLine === undefined) return false;
    if (region.function !== undefined && block.name !== region.function) return false;
    // A line written since the recording is in no region it holds.
    const spans = Array.from({ length: row.endLine - row.startLine + 1 }, (_, offset) => at(row.startLine! + offset));
    return spans[0] === region.line && spans.at(-1) === region.end && spans.every((line) => line !== null);
  });
  if (matching.length > 1) return { reason: 'more than one region of the file is the one the record holds, so which to break cannot be told' };
  const [match] = matching;
  if (match === undefined) {
    return { reason: then.changed ? 'its source changed since the recording, so no region of the file is the one it holds' : 'no region the file is cut into is the one the record holds' };
  }
  const { row, block } = match;
  for (const empty of empties(block.kind, cut.source[block.start])) {
    const text = cut.source.slice(0, block.start) + empty + cut.source.slice(block.end);
    if (text === cut.source) return { reason: 'it is empty already, so breaking it changes nothing' };
    if (parseSync(cut.path, text).errors.length === 0) return { text, start: block.start, end: block.end, line: row.startLine!, endLine: row.endLine! };
  }
  return { reason: 'the break does not parse' };
}
