import type { HeldCell, HeldValue, Holding } from '../format/holding.js';
import type { MovedInput } from './parting.js';

/**
 * What a boundary received, as a framework adapter read it.
 *
 * The counterpart to `cascade.ts`: that one reads the input nobody passed, and
 * this one reads the three that were — props, contexts and hook cells. Split out
 * because they fail in opposite directions and the difference is the whole
 * safety property. A cascade reading is either present or the property was
 * declared; a holding reading can be *absent*, and absent must never settle as
 * agreement. Everything here that returns `unread` is doing that work.
 */

/**
 * What differs between two readings of one boundary.
 *
 * `unread` is returned beside the inputs rather than folded into them because
 * the two answer different questions. The inputs say what moved; `unread` says
 * whether "nothing moved" is a reading or a shrug, and only the second caller —
 * the one about to call a render nondeterministic — needs it.
 */
export function compareHoldings(
  left: Holding | undefined,
  right: Holding | undefined,
): { inputs: readonly MovedInput[]; unread: boolean } {
  const inputs: MovedInput[] = [];
  let unread = left?.unread !== undefined || right?.unread !== undefined;

  // Absent props mean `memoizedProps` was not an object, which is a failure to
  // read rather than a component with no props. Symmetric absence is left alone:
  // two readings that failed the same way have not disagreed.
  if ((left?.props === undefined) !== (right?.props === undefined)) unread = true;
  else compareNamed('prop', left?.props, right?.props, inputs);

  // Contexts are different: absent means `dependencies` was null, and that is a
  // positive reading — this component subscribes to no context.
  compareNamed('context', left?.contexts, right?.contexts, inputs);

  if (left?.cells === undefined || right?.cells === undefined) unread = true;
  else compareCells(left.cells, right.cells, inputs);

  return { inputs, unread };
}

function compareNamed(
  kind: 'prop' | 'context',
  left: readonly HeldValue[] | undefined,
  right: readonly HeldValue[] | undefined,
  into: MovedInput[],
): void {
  const before = new Map((left ?? []).map((value) => [value.name, value.digest]));
  const after = new Map((right ?? []).map((value) => [value.name, value.digest]));

  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const from = before.get(name);
    const to = after.get(name);
    if (from !== to) into.push({ kind, name, from, to });
  }
}

/**
 * Hook cells, joined on call position.
 *
 * On position rather than on name because position is what a hook *is* to React
 * — the rule the linter enforces — and because a component that ran a different
 * number of hooks took a different branch before it rendered anything. That case
 * arrives here as cells present on one side only, which is a reading rather than
 * a join failure, and one of the loudest available.
 */
function compareCells(
  left: readonly HeldCell[],
  right: readonly HeldCell[],
  into: MovedInput[],
): void {
  const before = new Map(left.map((cell) => [cell.index, cell]));
  const after = new Map(right.map((cell) => [cell.index, cell]));

  for (const index of [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)) {
    const from = before.get(index);
    const to = after.get(index);
    if (from?.digest === to?.digest && from?.hook === to?.hook) continue;
    into.push({
      kind: 'hook',
      name: to?.hook ?? from?.hook ?? '(unknown)',
      index,
      from: from?.digest,
      to: to?.digest,
    });
  }
}
