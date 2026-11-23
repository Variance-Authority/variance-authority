// compass: variance-authority.reach
/**
 * What one recorded test would not notice broken: each region it entered,
 * broken in the extreme, served under a command that runs the test.
 *
 * A function's body is emptied, so it returns nothing; a branch, a
 * continuation or a handler is skipped. That is the extreme mutation of
 * pseudo-tested code (Niedermayr, Juergens & Wagner, CSED 2016; Descartes,
 * ASE 2018): one break per region, so the run is one test per region, and the
 * record chooses the regions, so no coverage pass runs first. A loop body is
 * not broken: emptying one can leave the loop running for ever.
 *
 * Each break is cut from the source as the checkout has it now, by the same
 * `spliced` the instrumenter cuts the record's regions with, and served by
 * {@link serveBase}: nothing is written to the checkout, and the command's
 * record goes to a scratch directory, so the real one is left as it was.
 */

import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { spliced, type Block } from '../instrument/spliced.js';
import { testsRan } from '../journeys.js';
import { linesOf } from '../read.js';
import type { NativeJourneyCase, NativeRanRegion } from '../native-journeys.js';
import { serveBase, type ServedOptions } from './serve-base.js';

/** The kinds of region a break is made in. */
const BROKEN = new Set(['function', 'branch', 'continuation', 'handler']);

/** How many regions one ask breaks unless it names a cap: one run of the command each. */
export const EXTREME_LIMIT = 20;

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
  readonly unbroken: readonly Unbroken[];
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
  readonly limit?: number;
}

/**
 * Break each region the asked test entered, fewest other tests first, and
 * run the command under each break. Refused when the record names no such
 * test, when the command cannot start, and when it fails with nothing broken.
 */
export async function extremeBreaks({ root, file, name, command, cwd, limit = EXTREME_LIMIT }: ExtremeAsk): Promise<ExtremeAnswer | ExtremeRefusal> {
  const asked = enteredRegions(root, file, name);
  if ('refused' in asked) return asked;
  const scratch = await mkdtemp(join(tmpdir(), 'variance-extreme-'));
  try {
    // The command's own record goes here, so no break folds into the checkout's.
    const options: ServedOptions = { env: { VARIANCE_AUTHORITY_CACHE: scratch }, stdio: ['ignore', 2, 2] };
    const unbrokenRun = await serveBase({}, command, cwd, options);
    if (unbrokenRun === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
    if (unbrokenRun.exit !== 0) return { refused: `the command fails with nothing broken (exit ${unbrokenRun.exit}), so no break can be told apart from it: run it alone to see why` };
    const survived: ExtremeRegion[] = [];
    const noticed: ExtremeRegion[] = [];
    const unbroken: Unbroken[] = asked.regions.slice(limit).map((region) => ({ region, reason: `past the cap of ${limit} regions` }));
    for (const region of asked.regions.slice(0, limit)) {
      const path = await realpath(join(root, region.file)).catch(() => undefined);
      const source = path === undefined ? undefined : await readFile(path, 'utf8');
      const broken = path === undefined || source === undefined ? { reason: 'the checkout no longer holds the file' } : extremeBreak(source, path, region);
      if ('reason' in broken) {
        unbroken.push({ region, reason: broken.reason });
        continue;
      }
      const served = await serveBase({ [path!]: broken.text }, command, cwd, options);
      if (served === undefined) return { refused: `\`${command[0]}\` could not be started: no such command` };
      if (served.unread.length > 0) unbroken.push({ region, reason: 'no process the command started read the file, so the break was not run' });
      else (served.exit === 0 ? survived : noticed).push(region);
    }
    return { test: asked.test, survived, noticed, unbroken };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The source regions the asked test entered in every suite that recorded it, once each, fewest other tests first. */
function enteredRegions(root: string, file: string, name: string | undefined): { test: NativeJourneyCase; regions: ExtremeRegion[] } | ExtremeRefusal {
  const suites = testsRan(root, file, name);
  const named = suites.filter((suite) => suite.ran.test != null);
  const test = named[0]?.ran.test;
  if (test == null) return { refused: suites.map((suite) => suite.ran.notRecorded).find((why) => why != null) ?? 'the recording names no test to read' };
  const regions = new Map<string, ExtremeRegion>();
  for (const { ran } of named) {
    for (const { file: module, regions: ranRegions } of ran.modules) {
      for (const region of ranRegions.filter(breakable)) {
        const key = `${module}\0${region.kind}\0${region.line}\0${region.end}\0${region.function ?? ''}`;
        const held = regions.get(key);
        if (held === undefined || region.others < held.others) regions.set(key, placed(module, region));
      }
    }
  }
  const order = (a: ExtremeRegion, b: ExtremeRegion): number => a.others - b.others || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.end - b.end);
  return { test, regions: [...regions.values()].sort(order) };
}

const breakable = (region: NativeRanRegion): boolean => region.entered && region.source && BROKEN.has(region.kind);

function placed(file: string, region: NativeRanRegion): ExtremeRegion {
  const { kind, line, end, others } = region;
  return { file, kind, line, end, others, ...(region.function == null ? {} : { function: region.function }) };
}

/** `source` with `region` broken in the extreme, or why it cannot be. */
export function extremeBreak(source: string, path: string, region: ExtremeRegion): { text: string } | { reason: string } {
  const cut = spliced(source, path, 'presence');
  if (cut === undefined) return { reason: 'the instrumenter does not cut this file' };
  const lineOf = linesOf(source);
  const matching = cut.blocks.filter((block) =>
    block.kind === region.kind && block.start !== block.end && lineOf(block.start) === region.line && lineOf(block.end) === region.end && (region.function === undefined || block.name === region.function));
  const [block, ...more] = matching;
  if (block === undefined || more.length > 0) return { reason: 'its source no longer matches the record' };
  const span = block.kind === 'function' ? functionBody(source, path, block) : { start: block.start, end: block.end, empty: source[block.start] === '{' ? '{}' : ';' };
  if (span === undefined) return { reason: 'its body could not be found' };
  const text = source.slice(0, span.start) + span.empty + source.slice(span.end);
  if (parseSync(path, text).errors.length > 0) return { reason: 'the break does not parse' };
  return { text };
}

/** The body of the function `block` is, and what empties it: `{}`, or `undefined` for an arrow's expression. */
function functionBody(source: string, path: string, block: Block): { start: number; end: number; empty: string } | undefined {
  const found = functionNode(parseSync(path, source).program, block.end);
  if (found === undefined) return undefined;
  const { body } = found;
  return { start: body.start, end: body.end, empty: body.type === 'BlockStatement' || body.type === 'FunctionBody' ? '{}' : '(undefined)' };
}

interface Spanned {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly body?: Spanned;
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The function in `node` whose body ends at `end`, the end of the region the instrumenter cut for it. */
function functionNode(node: unknown, end: number): (Spanned & { body: Spanned }) | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const spanned = node as Spanned;
  if (FUNCTIONS.has(spanned.type) && spanned.body !== undefined && spanned.body !== null && spanned.body.end === end) return spanned as Spanned & { body: Spanned };
  for (const child of Object.values(node)) {
    const found = Array.isArray(child) ? child.map((item: unknown) => functionNode(item, end)).find(Boolean) : functionNode(child, end);
    if (found !== undefined) return found;
  }
  return undefined;
}
