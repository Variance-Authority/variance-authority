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
import { codeUnitOrder } from '@variance-authority/core/segment';
import { testsRan } from '../journeys.js';
import type { NativeJourneyCase, NativeRanRegion } from '../native-journeys.js';
import { CACHE_VARIABLE, configuredCacheRoot } from '../test-selection/cache-layers.js';
import { regionKey, sourceCut } from '../test-selection/coverage-rows.js';
import { askCoverageFile } from '../test-selection/coverage-file.js';
import { BLOCK_KINDS } from '../test-selection/format-layout.js';
import type { TestCoverageView } from '../test-selection/format-view.js';
import type { CoverageBlock } from '../test-selection/index.js';
import { findModules } from '../test-selection/lookup.js';
import { servedRun } from './serve-base.js';

/** The kinds of region a break is made in: not a loop body, since emptying one can leave the loop running for ever. */
const BROKEN = new Set(['function', 'branch', 'continuation', 'handler']);

/** A break may run this many times as long as the run with nothing broken, and never less than {@link DEADLINE_FLOOR} milliseconds. */
const DEADLINE_FACTOR = 5;
const DEADLINE_FLOOR = 2_000;
/** The run with nothing broken is stopped past ten minutes, so it leads a process group like every break. */
const UNBROKEN_DEADLINE = 600_000;

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

/** A region as its recording names it: the probes it was cut by, and the identity of the block it was entered as. */
interface Asked {
  readonly region: ExtremeRegion;
  readonly mode: WalkMode | undefined;
  /** The recorded block's {@link regionKey} and digest; undefined when the recording holds no one block at the region's lines. */
  readonly identity: { readonly key: string; readonly digest: string } | undefined;
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
  if (configuredCacheRoot(root) !== undefined) {
    return { refused: 'the checkout\'s configuration names a cache root, which every run of the command records into, so a broken run would land in the record: ask from a checkout whose configuration names none' };
  }
  const scratch = await mkdtemp(join(tmpdir(), 'variance-extreme-'));
  try {
    // The command's own record goes here, so no break folds into the checkout's.
    const stdio: StdioOptions = ['ignore', 2, 2];
    const unbrokenOptions = { env: { [CACHE_VARIABLE]: scratch }, stdio };
    const begun = performance.now();
    const unbrokenRun = await servedRun({}, command, cwd, { ...unbrokenOptions, deadline: UNBROKEN_DEADLINE });
    if (unbrokenRun === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
    if (unbrokenRun.late) return { refused: 'the command was still running with nothing broken after ten minutes, so it was stopped: ask with a command that runs the one test' };
    if (unbrokenRun.exit !== 0) return { refused: `the command fails with nothing broken (exit ${unbrokenRun.exit}), so no break can be told apart from it: run it alone to see why` };
    const options = { ...unbrokenOptions, deadline: Math.max(DEADLINE_FLOOR, Math.ceil((performance.now() - begun) * DEADLINE_FACTOR)) };
    const survived: ExtremeRegion[] = [];
    const noticed: ExtremeRegion[] = [];
    const hung: ExtremeRegion[] = [];
    const unbroken: Unbroken[] = [];
    const cuts = new Map<string, Cut | undefined>();
    const tried = new Set<string>();
    const pastCap = new Set<string>();
    const brokenKeys = new Set<string>();
    // A region another suite's recording let the ask break is not listed as unbroken.
    const skipped: { key: string; entry: Unbroken }[] = [];
    for (const { region, mode, identity } of asked.regions) {
      const named = `${region.file}\0${identity?.key ?? `${region.kind}\0${region.line}\0${region.end}`}`;
      if (tried.size >= limit) {
        if (!brokenKeys.has(named)) pastCap.add(named);
        continue;
      }
      const reason = (why: string): void => void skipped.push({ key: named, entry: { region, reason: why } });
      if (mode === undefined) {
        reason('its recording was made by probes this build does not cut, so no region of the file can be matched to it');
        continue;
      }
      if (identity === undefined) {
        reason('its recording holds no one region at its lines, so which to break cannot be told');
        continue;
      }
      const key = `${mode}\0${region.file}`;
      if (!cuts.has(key)) cuts.set(key, await cutOf(root, region.file, mode));
      const cut = cuts.get(key);
      if (cut === undefined) {
        reason('the checkout no longer holds the file, or the instrumenter does not cut it');
        continue;
      }
      const broken = extremeBreak(cut, identity);
      if ('reason' in broken) {
        reason(broken.reason);
        continue;
      }
      brokenKeys.add(named);
      // Two suites can record one region under two kinds of probe: it is the block in today's text that is broken, once.
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
    unbroken.push(...skipped.filter(({ key }) => !brokenKeys.has(key)).map(({ entry }) => entry));
    return { test: asked.test, survived, noticed, hung, unbroken, pastCap: pastCap.size };
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
  for (const { ran, recording } of named) {
    askCoverageFile(recording, (coverage) => {
      const mode = instrumentModeOf(coverage.instrumentation);
      const walked = mode === 'loads' ? undefined : mode;
      for (const { file: module, regions: ranRegions } of ran.modules) {
        const blocks = recordedBlocks(coverage, module);
        for (const region of ranRegions.filter(breakable)) {
          const identity = identityOf(coverage, blocks, region);
          const key = `${walked ?? ''}\0${module}\0${identity === undefined ? `${region.kind}\0${region.line}\0${region.end}` : `${identity.key}\0${identity.digest}`}`;
          const held = regions.get(key);
          if (held === undefined || region.others < held.region.others) regions.set(key, { region: placed(module, region), mode: walked, identity });
        }
      }
    });
  }
  const order = (a: Asked, b: Asked): number =>
    a.region.others - b.region.others || codeUnitOrder(a.region.file, b.region.file) || a.region.line - b.region.line || a.region.end - b.region.end;
  return { test, regions: [...regions.values()].sort(order) };
}

const breakable = (region: NativeRanRegion): boolean => region.entered && region.source && BROKEN.has(region.kind);

function placed(file: string, region: NativeRanRegion): ExtremeRegion {
  const { kind, line, end, others } = region;
  return { file, kind, line, end, others, ...(region.function == null ? {} : { function: region.function }) };
}

/** Every block the recording holds for the module's instrumented rows. */
function recordedBlocks(coverage: TestCoverageView, module: string): number[] {
  return findModules(coverage, module)
    .filter((row) => coverage.moduleInstrumented.at(row) === 1)
    .flatMap((row) => Array.from({ length: coverage.moduleBlocks.at(row + 1) - coverage.moduleBlocks.at(row) }, (_, at) => coverage.moduleBlocks.at(row) + at));
}

/** The identity of the one recorded block the region was entered as, by its kind, its lines and its name; undefined when no one block is. */
function identityOf(coverage: TestCoverageView, blocks: readonly number[], region: NativeRanRegion): Asked['identity'] {
  const found = new Map<string, { key: string; digest: string }>();
  for (const block of blocks) {
    if (BLOCK_KINDS[coverage.blockKind.at(block)] !== region.kind || coverage.blockSource.at(block) !== 1) continue;
    if (coverage.blockStart.at(block) !== region.line || coverage.blockEnd.at(block) !== region.end) continue;
    const name = coverage.string(coverage.blockName.at(block));
    if (region.function != null && name !== region.function) continue;
    const key = regionKey({ kind: region.kind, name, path: coverage.string(coverage.blockPath.at(block)), source: true });
    const digest = coverage.string(coverage.blockDigest.at(block));
    found.set(`${key}\0${digest}`, { key, digest });
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
}

/** One file as the checkout holds it now, cut as a seam under the recording's probes would cut it. */
interface Cut {
  readonly path: string;
  readonly source: string;
  /** Each row the cut makes at the file's own lines, beside the block it was made from and its {@link regionKey}. */
  readonly rows: readonly { readonly row: CoverageBlock; readonly block: Block; readonly key: string }[];
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
    return block === undefined ? [] : [{ row, block, key: regionKey(row) }];
  });
  return { path, source, rows };
}

/** The empty text a block's span is replaced with, in the order each is tried: a function's span runs from its parameters to the end of its body. */
const empties = (kind: string, opening: string | undefined): readonly string[] => (kind === 'function' ? ['() {}', '() => undefined'] : [opening === '{' ? '{}' : ';']);

/**
 * The broken block: the cut file's text with the recorded region broken in the
 * extreme, and where the block stands now; or why it cannot be broken. The
 * block is the one row of today's cut that carries the recorded region's
 * {@link regionKey}, and it is broken only while its digest is the recorded one.
 */
function extremeBreak(cut: Cut, identity: NonNullable<Asked['identity']>): { text: string; start: number; end: number; line: number; endLine: number } | { reason: string } {
  const matching = cut.rows.filter(({ key }) => key === identity.key);
  if (matching.length > 1) return { reason: 'more than one region of the file is named as the one the record holds, so which to break cannot be told' };
  const [match] = matching;
  if (match === undefined) return { reason: 'no region the file is cut into now is the one the record holds' };
  const { row, block } = match;
  if (row.digest !== identity.digest) return { reason: 'its source changed since the recording, so the record says nothing about it as it is now' };
  if (row.startLine === undefined || row.endLine === undefined) return { reason: 'the region stands at no line of the file' };
  for (const empty of empties(block.kind, cut.source[block.start])) {
    const text = cut.source.slice(0, block.start) + empty + cut.source.slice(block.end);
    if (text === cut.source) return { reason: 'it is empty already, so breaking it changes nothing' };
    if (parseSync(cut.path, text).errors.length === 0) return { text, start: block.start, end: block.end, line: row.startLine, endLine: row.endLine };
  }
  return { reason: 'the break does not parse' };
}
