import type { HistoryStore, Unkept } from './store.js';

/**
 * The store that keeps nothing, and says so.
 *
 * This is what makes the backend optional. Without it every consumer needs a
 * branch around "is history configured", and one of those branches eventually
 * reports zero — which is the failure the whole design is arranged to avoid,
 * arriving through the back door. With it, a pipeline holds a `HistoryStore`
 * either way and the difference surfaces once, in the answer, where somebody
 * reads it.
 *
 * The distinction it protects is small to write and large to get wrong:
 *
 * - an **empty history** is a record that exists and contains nothing yet;
 * - an **absent history** is no record at all.
 *
 * They render identically if the second is allowed to answer with the shape of
 * the first. "0 changes in 0 runs" reads as stability; "nobody is keeping a
 * record" reads as the question being unasked. An agent acts differently on
 * those two sentences, and only one of them is true when there is no service.
 *
 * Refusing is deliberately not modelled as a thrown error. A throw would make an
 * unconfigured store a crash in the middle of a run that is otherwise entirely
 * fine — every single-run answer still works without history — and the first fix
 * anybody reaches for is a `try`/`catch` that swallows it back into an empty
 * result.
 */

const NO_STORE = 'no history store is configured, so nothing is being recorded';

/**
 * The refusal, phrased around the question that was asked.
 *
 * Exported because the same sentence has to be available to anything else that
 * cannot answer a history question — a store whose configuration is incomplete,
 * a dry run — and because a second, differently-worded version of it is how the
 * distinction above starts to blur.
 */
export function unkept(question: string): Unkept {
  return {
    kept: false,
    because:
      `${NO_STORE}: ${question} cannot be answered. ` +
      'This is not a finding that nothing has drifted — it is the absence of anyone asking.',
  };
}

export function createAbsentStore(): HistoryStore {
  return {
    async record(): Promise<void> {
      // Accepted and discarded, rather than refused. A run that would otherwise
      // succeed must not fail because the operator has no history service; the
      // rows this drops are the rows that were never going to be kept.
    },

    async current(subjects) {
      // Refused rather than answered with an empty array, and this is the one
      // place where that choice has teeth. An empty answer here is a valid
      // `previous` set — it means "nothing recorded yet" — so a caller that
      // failed to narrow it would sail on and compute a full set of rows to
      // write, then hand them to a `record` that discards them. Nothing would be
      // wrong and nothing would be kept, which is the shape of a bug nobody finds
      // for a cycle.
      const count = new Set(subjects).size;
      return unkept(
        `what is currently recorded for ${count === 1 ? 'this subject' : `these ${count} subjects`}`,
      );
    },

    async lastChanged(subject, component, band) {
      const area = `when \`${component}\` in \`${subject}\` last changed`;
      return unkept(band === undefined ? area : `${area} in its ${band} band`);
    },

    async churn(component) {
      return unkept(`how often \`${component}\` changes`);
    },

    async flakiness(subject) {
      // The wording matters more here than anywhere else in this file. A run has
      // *just* found this subject reading differently from itself; the reader is
      // deciding whether that is a known bad fixture or something new, and the
      // one thing that must not appear is a zero.
      return unkept(
        `how often \`${subject}\` has read differently from itself, and whether it still does`,
      );
    },

    async valueJourney(token) {
      return unkept(`what \`${token}\` has drifted to`);
    },

    async reach(component) {
      return unkept(`where \`${component}\` has started appearing`);
    },
  };
}
