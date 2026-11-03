// compass: variance-authority.reach
/**
 * The tests a selection leaves to the mainline: those only the mainline's own
 * commits since a record behind the merge base reach. The record says what can
 * differ since it ran; the import graph at the checkout says what the
 * checkout's own change can reach. A test is kept when both say so. A path
 * the change removed is in no graph at the checkout, and what still imports it
 * holds an import the scan could not resolve, so those files are reached too.
 */
import { affectedBy, NODE_KINDS, RUNTIME_EDGES, type Relations } from '@variance-authority/core/relate';
import type { TestDistance } from './distance.js';
import type { ExecutionNarrowing } from './narrowing.js';

/** What {@link leftToMainline} kept of a narrowing, and how many tests it left. */
export interface MainlineLeft<Distance extends TestDistance> {
  readonly narrowing: ExecutionNarrowing;
  readonly distances: readonly Distance[] | undefined;
  readonly left: number;
}

const FILE = NODE_KINDS.indexOf('file');

/**
 * `narrowing`, read from a record behind the merge base, without the tests
 * the import graph does not reach from `mine`: the files the checkout changed
 * from that base, and those its install moved. With `removes`, the change
 * removed a path, and every file whose imports the scan could not all read is
 * reached as well. `undefined` when it leaves none.
 */
export function leftToMainline<Distance extends TestDistance>(
  narrowing: ExecutionNarrowing,
  distances: readonly Distance[] | undefined,
  mine: ReadonlySet<string>,
  relations: Relations,
  removes: boolean,
): MainlineLeft<Distance> | undefined {
  const holes = removes ? relations.names.filter((_, id) => relations.unknown[id] === 1 && relations.kinds[id] === FILE) : [];
  const reached = new Set(affectedBy(relations, [...mine, ...holes], { through: RUNTIME_EDGES }).files);
  const kept = new Set(narrowing.entered.filter((test) => reached.has(test)));
  if (kept.size === narrowing.entered.length) return undefined;
  return {
    narrowing: { ...narrowing, entered: [...kept], because: (narrowing.because ?? []).filter((cause) => kept.has(cause.test)) },
    distances: distances?.filter((distance) => kept.has(distance.test)),
    left: narrowing.entered.length - kept.size,
  };
}
