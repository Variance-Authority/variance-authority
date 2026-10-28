// compass: variance-authority.reach
/**
 * `variance covering` asked about a line, a run of lines or a function of one
 * file: which cases entered it, which stopped before it, and the one state it
 * is painted as.
 *
 * Split from the command because the question about a place inside a file has
 * its own readings — a line the edit wrote, a line no region holds, a name no
 * recorded function has — and the answer about the whole file and about a
 * diff has none of them.
 *
 * Which regions a place lands on is the record's reading in
 * `source-target.ts`, shared with selection's line rule. What this module adds
 * is the held text: each asked line is carried to the record's coordinates
 * first, and the answer says which lines it could not carry, and which ones
 * the record holds at no finer grain than the file.
 */

import {
  anyStopped,
  coveringChange,
  coveringTests,
  functionsUnder,
  lineGrain,
  marksLoadTime,
  ranWhileLoading,
  stateOf,
  stoppedBefore,
  type CoveringTest,
  type ExecutionIndex,
  type ExecutionModule,
  type ExecutionTest,
  type HeldLines,
  type Placement,
  type RangeState,
  type SourceTestTarget,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import type { CoveringAt } from '../covering-args.js';
import type { Narrowing } from './covering-reach.js';
import { outermostOf, unrunOf } from './covering-frame.js';
import { relationsFor } from './source-graph.js';
import type { Covering, CoveringTarget } from './covering.js';
import type { Graph } from './gap-selection.js';

/** What the command already read before the question narrowed past the file. */
export interface ReadForTarget {
  readonly index: ExecutionIndex;
  /** Under `--where`, the index before it narrowed the cases. */
  readonly before?: ExecutionIndex;
  readonly module: ExecutionModule;
  readonly from: string;
  readonly placement?: Placement;
  readonly near: Narrowing;
  /** The checkout's file graph, read at most once per invocation. */
  readonly graph: Graph;
}

/**
 * The answer about `--line` or `--function`, or undefined when the question
 * named neither.
 *
 * @param reach Handed the cases the question reached before `--where`
 * narrowed them, when it narrowed them.
 */
export async function coveringAt(
  request: CoveringAt,
  read: ReadForTarget,
  reach?: (tests: readonly ExecutionTest[]) => void,
): Promise<Covering | undefined> {
  const { index, before, module, from, placement, near } = read;
  const file = request.file;
  let target: SourceTestTarget;
  let asked: CoveringTarget;
  let grain: Pick<Covering, 'grain' | 'fileGrain' | 'outside' | 'written'> = {};
  if (request.line !== undefined || request.lines !== undefined) {
    const held = request.lines ?? { startLine: request.line!, endLine: request.line! };
    const lines = recordedLines(held, module, placement);
    asked = request.lines === undefined ? { line: held.startLine } : { lines: held };
    if (lines.lines.length === 0) {
      // No asked line is in a recorded region: each is new, or has none to be covered, and saying which is the answer.
      return {
        file,
        target: asked,
        tests: [],
        ...(lines.outside.length === 0 ? {} : { outside: runsOfLines(lines.outside) }),
        ...(lines.written.length === 0 ? {} : { written: runsOfLines(lines.written) }),
        ...(placement === undefined ? {} : { frame: placement.frame }),
        from,
        ...countOf(near, 0, 0),
      };
    }
    target = request.lines === undefined ? { file, line: lines.lines[0]! } : { file, lines: lines.lines };
    const whole = lines.fileGrain.length === lines.lines.length;
    grain = {
      ...(whole ? { grain: 'file' as const } : {}),
      ...(whole || lines.fileGrain.length === 0 ? {} : { fileGrain: runsOfLines(lines.fileGrain) }),
      ...(lines.outside.length === 0 ? {} : { outside: runsOfLines(lines.outside) }),
      ...(lines.written.length === 0 ? {} : { written: runsOfLines(lines.written) }),
    };
  } else if (request.function !== undefined) {
    const named = request.function;
    if (functionsUnder(module.blocks, named).length === 0) throw noFunction(file, named, module);
    target = { file, function: named };
    asked = { function: named };
  } else {
    return undefined;
  }

  const graph = await loadersOf(before ?? index, file, read.graph, target);
  const found = coveringTests(index, target, graph);
  const kept = near.whole ? found : found.filter(near.keep);
  const reached = before === undefined ? kept : coveringTests(before, target, graph).filter(near.keep);
  if (before !== undefined) reach?.(reached);
  const stopped = stoppedBefore(before ?? index, target, graph);
  // Parts are read over every case, so whether any case entered the function is asked before `--at-distance` narrows them.
  const entered = (): boolean => (before === undefined ? found : coveringTests(before, target, graph)).length > 0;
  // Under a stale frame no recorded line is a place in the held text, so no part of the function is one either.
  const placed = placement?.frame !== 'stale';
  const unrun = 'function' in asked && placed && entered() ? unrunParts(before ?? index, module, asked.function, graph, placement) : [];
  // Only a mapped frame tells an edit apart from none: a recorded one holds no edit, and under a stale one no line is placed.
  const moved = 'function' in asked && placement?.frame === 'mapped' &&
    functionsUnder(module.blocks, asked.function).some((block) => placement.place(block)?.moved !== false);
  return {
    file,
    target: asked,
    tests: kept,
    ...(stopped === undefined ? {} : { stopped }),
    ...(unrun.length === 0 ? {} : { unrun }),
    ...(moved ? { moved: true as const } : {}),
    ...stateFor(reached, ranWhileLoading(before ?? index, target, graph), stopped),
    ...grain,
    ...(placement === undefined ? {} : { frame: placement.frame }),
    from,
    ...countOf(near, kept.length, found.length),
  };
}

/**
 * A part of an asked function no case ran: a branch no case took, or a
 * function inside it no case called. Lines are the held text's.
 */
export interface UnrunPart {
  readonly kind: string;
  /** Absent for a part of the asked scope's own body, as a branch of it; present for a function nested in it. */
  readonly name?: string;
  readonly startLine: number;
  readonly endLine: number;
  /** `hole` when a case that could have reached it stopped, `unwalked` when every one finished; absent when the record cannot tell. */
  readonly state?: RangeState;
  /** An edit since the recording touched the part; its lines are the ones it spans now. */
  readonly moved?: true;
}

/**
 * The outermost recorded regions under the scope that no case called, read
 * with the review's `unrunOf` and `outermostOf`. A part inside one no case
 * called is not a second finding.
 */
function unrunParts(
  index: ExecutionIndex,
  module: ExecutionModule,
  scope: string,
  graph: { readonly relations?: Relations },
  placement: Placement | undefined,
): readonly UnrunPart[] {
  const spans = functionsUnder(module.blocks, scope).map((block) => ({ start: block.startLine, end: block.endLine }));
  const regions = (coveringChange(index, new Map([[module.file, spans]]), graph)[0]?.regions ?? [])
    .filter((region) => region.kind !== 'module' && (region.name === scope || region.name.startsWith(`${scope}/`)))
    .map((region) => ({ region, kind: region.kind, startLine: region.startLine, endLine: region.endLine, reach: unrunOf(region) ?? ('entered' as const) }));
  const parts: UnrunPart[] = [];
  for (const { region, reach } of outermostOf(regions)) {
    if (reach === 'entered' || reach === 'loaded') continue;
    const where = placement === undefined ? { lines: region, moved: false } : placement.place(region);
    // A part every line of which an edit removed has nowhere in the held text to be named.
    if (where === undefined) continue;
    parts.push({
      kind: region.kind,
      ...(region.name === scope ? {} : { name: region.name }),
      startLine: where.lines.startLine,
      endLine: where.lines.endLine,
      ...(reach === 'unknown' ? {} : { state: reach }),
      ...(where.moved ? { moved: true as const } : {}),
    });
  }
  return parts;
}

/** What the question named, as an answer says it: `line 7`, `lines 7-20`, `function Ledger`. */
export function targetText(target: CoveringTarget): string {
  if ('line' in target) return `line ${target.line}`;
  if ('lines' in target) return `lines ${target.lines.startLine}-${target.lines.endLine}`;
  return `function ${target.function}`;
}

/** Runs of lines as an answer lists them: `10, 18-20`. */
export function runsText(runs: readonly HeldLines[]): string {
  return runs.map((run) => (run.startLine === run.endLine ? `${run.startLine}` : `${run.startLine}-${run.endLine}`)).join(', ');
}

/** The asked lines, sorted by what the record holds them at. */
interface ReadLines {
  /** In the record's coordinates: every asked line a recorded region holds. */
  readonly lines: readonly number[];
  /** In the held text: the lines of {@link ReadLines.lines} whose edit charges the module's own region. */
  readonly fileGrain: readonly number[];
  /** In the held text: the recorded lines no region holds. */
  readonly outside: readonly number[];
  /** In the held text: the lines written since the recording. */
  readonly written: readonly number[];
}

/**
 * Each held line carried to the record's coordinates and read at the grain the
 * record holds it. A line written since the recording has no place there, and
 * a line no region holds — a blank, an import, a type — has nothing to answer.
 */
function recordedLines(held: HeldLines, module: ExecutionModule, placement: Placement | undefined): ReadLines {
  const lines: number[] = [];
  const fileGrain: number[] = [];
  const outside: number[] = [];
  const written: number[] = [];
  for (let at = held.startLine; at <= held.endLine; at += 1) {
    const line = placement === undefined ? at : placement.recordedLine(at);
    if (line === undefined) {
      written.push(at);
      continue;
    }
    const grain = lineGrain(module.blocks, line);
    if (grain === undefined) {
      outside.push(at);
      continue;
    }
    lines.push(line);
    if (grain === 'file') fileGrain.push(at);
  }
  return { lines, fileGrain, outside, written };
}

/** A name no recorded function has, and no recorded function is under. */
function noFunction(file: string, named: string, module: ExecutionModule): OperatorError {
  const functions = module.blocks
    .filter((block) => block.source && block.kind === 'function')
    .map((block) => block.name);
  return new OperatorError(
    `\`${named}\` is not a recorded function or scope of \`${file}\`. ` +
      (functions.length === 0 ? 'That file has no recorded functions at all.' : `It has ${functions.join(', ')}.`) +
      ' A declaration that is no function, as a constant or a type, holds no region of its own; ask about its ' +
      'lines with `--line <a>-<b>`.',
  );
}

/** Ascending line numbers as the runs they make. */
export function runsOfLines(lines: readonly number[]): readonly HeldLines[] {
  const runs: HeldLines[] = [];
  for (const line of lines) {
    const last = runs.at(-1);
    if (last !== undefined && last.endLine === line - 1) runs[runs.length - 1] = { startLine: last.startLine, endLine: line };
    else runs.push({ startLine: line, endLine: line });
  }
  return runs;
}

/**
 * The state of one place, from the cases that entered it, whether it ran while
 * its module evaluated, and the cases that stopped, before `--where`.
 */
function stateFor(
  tests: readonly CoveringTest[],
  loaded: boolean,
  stopped: readonly ExecutionTest[] | undefined,
): Pick<Covering, 'state'> {
  const state = stateOf({ tests, ...(loaded ? { loaded: true as const } : {}), ...(stopped === undefined ? {} : { stopped }) });
  return state === undefined ? {} : { state };
}

/** The narrowing's own report, when there was a narrowing. */
export function countOf(
  near: Narrowing,
  kept: number,
  of: number,
): Pick<Covering, 'narrowed'> {
  return near.whole ? {} : { narrowed: { kept, of, notes: near.notes } };
}

/**
 * The file graph, read only when the record marks load time on the region the
 * question landed on — or on any block of the module when the question named
 * no region — on a block or a crossing, or when a recorded case stopped and a
 * hole has to be told from a region nobody walked.
 *
 * The record credits no case with that: a module evaluates once per realm, for
 * whichever case imported it first. The graph names every case whose file
 * imports the module, and rules out one that mocked it. A question about a
 * region only a case called into never pays for the scan. Every covering
 * answer, fresh or stale, whole file or one line, decides here.
 */
export async function loadersOf(
  index: ExecutionIndex,
  file: string,
  graph: Graph,
  target?: SourceTestTarget,
): Promise<{ readonly relations?: Relations }> {
  const module = index.modules.find((candidate) => candidate.file === file);
  return (module !== undefined && marksLoadTime(module.blocks, target)) || anyStopped(index) ? { relations: await graph() } : {};
}

/** The file graph of the checkout, which names who imports what and who mocked it. */
export function fileGraph(root: string): Promise<Relations> {
  return relationsFor(root, ['.'], [], []);
}
