/**
 * `variance select --format json` — the whole reading, for a caller that is a
 * program.
 *
 * Beside the skip list it says why: which reading was made (`ground`), and,
 * when the record narrowed, why each test it kept was kept. The facts are the
 * ones the selection already held when it chose each test, carried rather than
 * recomputed. A reason is named once in `reasons`, and each selected test
 * points at its own by position, because one changed region of a hub can select
 * tens of thousands of tests and its name is the same for all of them.
 */

// compass: variance-authority.reach

import type { SelectionCause, SelectionReason } from '@variance-authority/sense/test-selection';
import type { TestSelection } from './select.js';

/** Everything the reading knows, for a caller that is a program. */
export function jsonOf(selection: TestSelection): object {
  // The sentences are among the notes already.
  const { says: _inNotes, ...install } = selection.install ?? {};
  return {
    ground: selection.ground,
    skip: selection.skip,
    ...(selection.widened === undefined ? {} : { widened: selection.widened }),
    because: selection.because,
    ...(selection.rests === undefined ? {} : { rests: selection.rests }),
    ...(selection.causes === undefined ? {} : causesOf(selection.causes, new Set(selection.skip))),
    ...(selection.incomplete === undefined ? {} : { incomplete: selection.incomplete }),
    notes: selection.notes,
    journal: {
      at: selection.at,
      ...(selection.commit === undefined ? {} : { commit: selection.commit }),
      ...(selection.recorded === undefined ? {} : { recorded: selection.recorded }),
      ...(selection.source?.from === undefined ? {} : { from: selection.source.from }),
      ...(selection.source?.mainline === undefined ? {} : { mainline: selection.source.mainline }),
      ...(selection.source?.distance === undefined ? {} : { distance: selection.source.distance }),
    },
    unread: selection.unread,
    ...(selection.install === undefined ? {} : { install }),
    ...(selection.declined === undefined ? {} : { declined: selection.declined }),
    stale: selection.stale,
    ...(selection.readings === undefined ? {} : { readings: selection.readings }),
    ...(selection.leg === undefined ? {} : { leg: selection.leg, left: selection.left ?? [] }),
    ...(selection.distances === undefined ? {} : { distances: selection.distances }),
  };
}

/**
 * Each reason once, in the order the selected tests first name it, and each
 * selected test with the positions of its reasons in that table. A test a leg
 * left is in `skip` and not here, so the two never share a test.
 */
function causesOf(
  causes: readonly SelectionCause[],
  skipped: ReadonlySet<string>,
): { readonly reasons: readonly SelectionReason[]; readonly selected: readonly { readonly test: string; readonly because: readonly number[] }[] } {
  const reasons: SelectionReason[] = [];
  const position = new Map<string, number>();
  const selected = causes
    .filter(({ test }) => !skipped.has(test))
    .map(({ test, via }) => {
      const because = new Set<number>();
      for (const reason of via) {
        const key = JSON.stringify(reason);
        let at = position.get(key);
        if (at === undefined) {
          at = reasons.length;
          position.set(key, at);
          reasons.push(reason);
        }
        because.add(at);
      }
      return { test, because: [...because] };
    });
  return { reasons, selected };
}
