// compass: variance-authority.reach
/**
 * The tests a selection leaves to the mainline: those only the mainline's own
 * commits since a record behind the merge base reach. A test is kept when
 * anything the checkout changed from that base can reach it, by the record or,
 * where the record is older than the mainline's change, by the graph and the
 * roots declared at the checkout. ADR-0062 holds the rule, and the load it cannot see.
 */
import { affectedBy, beforeReach, changedBefore, EDGE_KINDS, idOf, RUNTIME_EDGES, type NodeId, type Relations } from '@variance-authority/core/relate';
import type { TestDistance } from './distance.js';
import type { ExecutionNarrowing, SelectionReason } from './narrowing.js';

/** What {@link leftToMainline} kept of a narrowing, and how many tests it left. */
export interface MainlineLeft<Distance extends TestDistance> {
  readonly narrowing: ExecutionNarrowing;
  readonly distances: readonly Distance[] | undefined;
  readonly left: number;
}

/** The files one reason names: where the change it read is, and every file it passed through to reach the test. */
function filesOf(reason: SelectionReason): readonly string[] {
  if (reason.kind === 'region') return [reason.file];
  if (reason.kind === 'precondition') return [reason.name];
  if (reason.kind === 'reader') return [reason.file, reason.reader];
  return reason.trail;
}

const LOADED = new Set(RUNTIME_EDGES.map((kind) => EDGE_KINDS.indexOf(kind)));
const DECLARED = EDGE_KINDS.indexOf('depends');

/** Whether anything in the graph loads the file `id`. */
function imported(relations: Relations, id: NodeId): boolean {
  const { offset, kind } = relations.dependents;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (LOADED.has(kind[edge]!)) return true;
  return false;
}

/** Whether the scan could not read every load out of `file`, and the file declares none with a `/// <depends>`: a change there may load anything. */
function computesLoads(relations: Relations, file: string): boolean {
  const id = idOf(relations, 'file', file);
  if (id === undefined || relations.unknown[id] !== 1) return false;
  const { offset, kind } = relations.depends;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (kind[edge] === DECLARED) return false;
  return true;
}

/**
 * `narrowing`, read from a record behind the merge base, without the tests
 * nothing in `mine` reaches: the files the checkout changed from that base,
 * and those its install moved. `undefined` when it leaves none.
 */
export function leftToMainline<Distance extends TestDistance>(
  narrowing: ExecutionNarrowing,
  distances: readonly Distance[] | undefined,
  mine: ReadonlySet<string>,
  relations: Relations,
): MainlineLeft<Distance> | undefined {
  const reached = new Set(affectedBy(relations, mine, { through: RUNTIME_EDGES }).files);
  const why = new Map((narrowing.because ?? []).map((cause) => [cause.test, cause.via] as const));
  const entered = new Set(narrowing.entered);
  // A config names its setup by a string, so a file nothing imports that my change reaches may be one a precondition the mainline changed now names.
  const named = [...new Set([...mine, ...reached])].some((file) => {
    const id = idOf(relations, 'file', file);
    return id !== undefined && !entered.has(file) && !imported(relations, id);
  });
  const closures = new Map<string, boolean>();
  const loadsMine = (roots: readonly string[]): boolean => {
    const key = roots.join('\0');
    let loads = closures.get(key);
    if (loads === undefined) closures.set(key, (loads = changedBefore(beforeReach(relations, roots), [...mine]).length > 0));
    return loads;
  };
  const ours = (test: string): boolean => {
    const via = why.get(test);
    // A test selected for no reason it names is kept: nothing says whose change selected it.
    if (via === undefined || via.length === 0) return true;
    if (reached.has(test) || via.some((reason) => filesOf(reason).some((file) => mine.has(file)))) return true;
    const roots = via.flatMap((reason) => (reason.kind === 'precondition' ? [reason.name] : []));
    if (roots.length > 0 && (named || loadsMine(roots))) return true;
    return via.some((reason) => reason.kind === 'region' && computesLoads(relations, reason.file));
  };
  const kept = new Set(narrowing.entered.filter(ours));
  if (kept.size === narrowing.entered.length) return undefined;
  return {
    narrowing: { ...narrowing, entered: [...kept], because: (narrowing.because ?? []).filter((cause) => kept.has(cause.test)) },
    distances: distances?.filter((distance) => kept.has(distance.test)),
    left: narrowing.entered.length - kept.size,
  };
}
