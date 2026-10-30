/**
 * `variance select --format json` — the whole reading, for a caller that is a
 * program.
 *
 * Beside the skip list it says why: which reading was made (`ground`), and,
 * when the record narrowed, why each test it kept was kept. The facts are the
 * ones the selection already held when it chose each test, carried rather than
 * recomputed. A reason is named once in `reasons`, and each selected test
 * points at its own there by position, because one changed region of a hub
 * can select tens of thousands of tests and its name is the same for all.
 */

// compass: variance-authority.reach

import type { SelectionCause, SelectionReason } from '@variance-authority/sense/test-selection';
import type { TestSelection } from './select.js';

/** Everything the reading knows, for a caller that is a program. */
export function jsonOf(selection: TestSelection): object {
  // The sentences are among the notes already.
  const { says: _inNotes, ...install } = selection.install ?? {};
  // A leg leaves tests it does not run in `skip`, so no other list names them.
  const skipped = new Set(selection.skip);
  return {
    ground: selection.ground,
    skip: selection.skip,
    ...(selection.widened === undefined ? {} : { widened: selection.widened }),
    because: selection.because,
    ...(selection.rests === undefined ? {} : { rests: selection.rests }),
    ...(selection.causes === undefined ? {} : causesOf(selection.causes, skipped)),
    ...(selection.incomplete === undefined ? {} : { incomplete: selection.incomplete.filter((test) => !skipped.has(test)) }),
    notes: selection.notes,
    journal: {
      at: selection.at,
      ...(selection.commit === undefined ? {} : { commit: selection.commit }),
      ...(selection.recorded === undefined ? {} : { recorded: selection.recorded }),
      ...(selection.source?.from === undefined ? {} : { from: selection.source.from }),
      ...(selection.source?.mainline === undefined ? {} : { mainline: selection.source.mainline }),
      ...(selection.source?.distance === undefined ? {} : { distance: selection.source.distance }),
    },
    ...(selection.changed === undefined ? {} : { changed: selection.changed }),
    unread: selection.unread,
    ...(selection.install === undefined ? {} : { install }),
    ...(selection.declined === undefined ? {} : { declined: selection.declined }),
    ...(selection.ignored === undefined ? {} : { ignored: selection.ignored }),
    stale: selection.stale,
    ...(selection.readings === undefined ? {} : { readings: selection.readings }),
    ...(selection.leg === undefined ? {} : { leg: selection.leg, left: selection.left ?? [] }),
    ...(selection.distances === undefined ? {} : { distances: selection.distances }),
  };
}

/**
 * Each reason once, in the order the selected tests first name it, and each
 * selected test with the positions of its reasons in that table.
 */
function causesOf(
  causes: readonly SelectionCause[],
  skipped: ReadonlySet<string>,
): { readonly reasons: readonly SelectionReason[]; readonly selected: readonly { readonly test: string; readonly reasons: readonly number[] }[] } {
  const reasons: SelectionReason[] = [];
  const position = new Map<string, number>();
  const selected = causes
    .filter(({ test }) => !skipped.has(test))
    .map(({ test, via }) => {
      const named = new Set<number>();
      for (const reason of via) {
        const key = JSON.stringify(reason);
        let at = position.get(key);
        if (at === undefined) {
          at = reasons.length;
          position.set(key, at);
          reasons.push(reason);
        }
        named.add(at);
      }
      return { test, reasons: [...named] };
    });
  return { reasons, selected };
}
