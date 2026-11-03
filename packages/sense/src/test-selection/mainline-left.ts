// compass: variance-authority.reach
/**
 * The tests a selection leaves to the mainline: those only the mainline's own
 * commits since a record behind the merge base reach. The record says what can
 * differ since it ran; the import graph at the checkout says what the
 * checkout's own change can reach, as a suite at `file` precision reads it:
 * the graph's walk, and the files the record says a test entered. A test is
 * kept when both say so, so the answer never runs a test that `file`
 * precision over the checkout's change alone would not.
 */
import { affectedBy, RUNTIME_EDGES, type Relations } from '@variance-authority/core/relate';
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

/**
 * `narrowing`, read from a record behind the merge base, without the tests
 * neither the import graph reaches from `mine`, the files the checkout
 * changed from that base and those its install moved, nor a reason names one
 * of. A removed path is in no graph at the checkout, and the reason that names
 * it is what a test that entered it is kept by. `undefined` when it leaves none.
 */
export function leftToMainline<Distance extends TestDistance>(
  narrowing: ExecutionNarrowing,
  distances: readonly Distance[] | undefined,
  mine: ReadonlySet<string>,
  relations: Relations,
): MainlineLeft<Distance> | undefined {
  const reached = new Set(affectedBy(relations, mine, { through: RUNTIME_EDGES }).files);
  const named = new Set(
    (narrowing.because ?? []).filter((cause) => cause.via.some((reason) => filesOf(reason).some((file) => mine.has(file)))).map((cause) => cause.test),
  );
  const kept = new Set(narrowing.entered.filter((test) => reached.has(test) || named.has(test)));
  if (kept.size === narrowing.entered.length) return undefined;
  return {
    narrowing: { ...narrowing, entered: [...kept], because: (narrowing.because ?? []).filter((cause) => kept.has(cause.test)) },
    distances: distances?.filter((distance) => kept.has(distance.test)),
    left: narrowing.entered.length - kept.size,
  };
}
