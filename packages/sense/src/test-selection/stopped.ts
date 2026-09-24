import { affectedBy, type Relations } from '@variance-authority/core/relate';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule, ExecutionTest } from './reverse.js';

/**
 * The stopped cases that could have reached this module, by the file graph.
 *
 * Could have reached means the case's file imports the module, which is
 * `affectedBy`'s answer and the one `loadersOf` in `reverse.ts` gives for load
 * time; a stopped case that crossed the module anyway is added, since it
 * plainly reached it. A record in which every case finished needs no graph:
 * the answer is nobody. Otherwise it is absent without a graph, when the graph
 * cannot answer for the module under the rules `loadersOf` states, and when a
 * case that could have reached it carries no settling: then nobody can say
 * whether its journey ended.
 */
export function stoppedIn(
  index: ExecutionIndex,
  module: ExecutionModule,
  relations: Relations | undefined,
): ReadonlySet<number> | undefined {
  if (index.tests.every((test) => test.stopped === false)) return new Set();
  if (relations === undefined) return undefined;
  const affected = affectedBy(relations, [module.file]);
  if (affected.missing.length > 0) return undefined;
  const files = new Set(affected.files);
  const reach = new Set<number>();
  for (const [at, test] of index.tests.entries()) if (files.has(test.file)) reach.add(at);
  if (reach.size === 0) return undefined;
  for (const block of module.blocks) for (const crossing of block.crossings) reach.add(crossing.test);
  const stopped = new Set<number>();
  for (const at of reach) {
    const settled = index.tests[at]?.stopped;
    if (settled === undefined) return undefined;
    if (settled) stopped.add(at);
  }
  return stopped;
}

/** Of the stopped cases, the ones that entered none of `blocks`, in record order. */
export function outside(
  index: ExecutionIndex,
  stopped: ReadonlySet<number> | undefined,
  blocks: readonly ExecutionBlock[],
): readonly ExecutionTest[] | undefined {
  if (stopped === undefined) return undefined;
  const entered = new Set<number>();
  for (const block of blocks) for (const crossing of block.crossings) entered.add(crossing.test);
  return [...stopped]
    .filter((test) => !entered.has(test))
    .sort((left, right) => left - right)
    .map((test) => index.tests[test]!);
}

export function sameCases(
  left: readonly ExecutionTest[] | undefined,
  right: readonly ExecutionTest[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((test, at) => test.id === right[at]!.id);
}

/** Whether any recorded case stopped, which is when a hole needs the file graph to name. */
export function anyStopped(index: ExecutionIndex): boolean {
  return index.tests.some((test) => test.stopped === true);
}
