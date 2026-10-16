// compass: variance-authority.reach
/**
 * `variance covering` asked about a line or a function of one file: which
 * cases entered it, which stopped before it, and the one state it is painted
 * as.
 *
 * Split from the command because the question about a place inside a file has
 * its own refusals — a line the edit wrote, a line no region holds, a name no
 * recorded function has — and the answer about the whole file and about a diff
 * has none of them.
 */

import {
  anyStopped,
  coveringTests,
  ranWhileLoading,
  stateOf,
  stoppedBefore,
  type CoveringTest,
  type ExecutionIndex,
  type ExecutionModule,
  type ExecutionTest,
  type Placement,
  type SourceTestTarget,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import type { CoveringAt } from '../covering-args.js';
import type { Narrowing } from './covering-reach.js';
import { relationsFor } from './source-graph.js';
import type { Covering } from './covering.js';

/** What the command already read before the question narrowed past the file. */
export interface ReadForTarget {
  readonly index: ExecutionIndex;
  /** Under `--where`, the index before it narrowed the cases. */
  readonly before?: ExecutionIndex;
  readonly module: ExecutionModule;
  readonly from: string;
  readonly placement?: Placement;
  readonly near: Narrowing;
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
  let asked: NonNullable<Covering['target']>;
  if (request.line !== undefined) {
    const held = request.line;
    const line = placement === undefined ? held : placement.recordedLine(held);
    if (line === undefined) {
      throw new OperatorError(
        `line ${held} of \`${file}\` was written since the recording, so the record has nothing to say ` +
          'about it yet: no case has run it. Run the suite to record it.',
      );
    }
    if (!module.blocks.some((block) => block.source && block.startLine <= line && line <= block.endLine)) {
      throw new OperatorError(
        `line ${line} of \`${file}\` is outside every recorded region. A blank line, an ` +
          'import or a type declaration has no region to be covered, so there is no list to ' +
          'print — which again is not the same as nobody covering it.',
      );
    }
    target = { file, line };
    asked = { line: held };
  } else if (request.function !== undefined) {
    const named = request.function;
    if (!module.blocks.some((block) =>
      block.source && block.kind === 'function' && block.name === named,
    )) {
      const functions = module.blocks
        .filter((block) => block.source && block.kind === 'function')
        .map((block) => block.name);
      throw new OperatorError(
        `\`${named}\` is not a recorded function of \`${file}\`. ` +
          (functions.length === 0
            ? 'That file has no recorded functions at all.'
            : `It has ${functions.join(', ')}.`),
      );
    }
    target = { file, function: named };
    asked = { function: named };
  } else {
    return undefined;
  }

  const graph = await loadersFor(before ?? index, target, request.root);
  const found = coveringTests(index, target, graph);
  const kept = near.whole ? found : found.filter(near.keep);
  const reached = before === undefined ? kept : coveringTests(before, target, graph).filter(near.keep);
  if (before !== undefined) reach?.(reached);
  const stopped = stoppedBefore(before ?? index, target, graph);
  return {
    file,
    target: asked,
    tests: kept,
    ...(stopped === undefined ? {} : { stopped }),
    ...stateFor(reached, stopped),
    ...(placement === undefined || 'function' in asked ? {} : { frame: placement.frame }),
    from,
    ...countOf(near, kept.length, found.length),
  };
}

/** The state of one line or function, from the cases that entered it and those that stopped, before `--where`. */
function stateFor(tests: readonly CoveringTest[], stopped: readonly ExecutionTest[] | undefined): Pick<Covering, 'state'> {
  const state = stateOf({ startLine: 0, endLine: 0, tests, ...(stopped === undefined ? {} : { stopped }) });
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
 * The file graph, read only when a region the question landed on ran while its
 * module evaluated, or when a recorded case stopped and a hole has to be told
 * from a region nobody walked.
 *
 * The record credits no case with that: a module evaluates once per realm, for
 * whichever case imported it first. The graph names every case whose file
 * imports the module, and rules out one that mocked it. A question about a
 * region only a case called into never pays for the scan.
 */
async function loadersFor(
  index: ExecutionIndex,
  target: SourceTestTarget,
  root: string,
): Promise<{ readonly relations?: Relations }> {
  return ranWhileLoading(index, target) || anyStopped(index) ? { relations: await fileGraph(root) } : {};
}

/** The file graph of the checkout, which names who imports what and who mocked it. */
export function fileGraph(root: string): Promise<Relations> {
  return relationsFor(root, ['.'], [], []);
}
