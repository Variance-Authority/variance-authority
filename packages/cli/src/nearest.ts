/**
 * The name somebody meant, when exactly one name is close enough.
 *
 * Every refusal in this CLI already prints the whole accepted set, which is what
 * a person needs: they read it, see the one they meant, and type it. The reader
 * here is usually not a person. An agent that mistyped `--quer` gets back
 * twenty-one flags and has to decide which of them was the intention — a second
 * turn spent on a typo it could have corrected from the same message.
 *
 * So the set stays, and one sentence goes in front of it. Naming a candidate is
 * cheap and reversible: nothing is run on the guess, and a wrong guess costs a
 * line of text next to the list that was already there.
 *
 * ## Why one, and why not always
 *
 * Two names equally close is not a suggestion, it is a second decision handed
 * back — so a tie suggests nothing and the set alone answers. And the distance
 * is bounded by the length of what was typed: without that, `--x` is one edit
 * from nothing and three from half the table, and a suggestion that fires on
 * anything is one nobody can read as a signal.
 *
 * Damerau-Levenshtein, iterative, over three rows. Transposed neighbours count
 * as one edit rather than two, which is not a refinement: `aks` for `ask` and
 * `--fromat` for `--format` are the typo, and under plain Levenshtein both sit
 * at distance two and are missed by the bound below. No dependency, for the
 * reason `parse.ts` gives — a tool whose claim is that its output can be trusted
 * does not acquire a transitive graph to spell-check a flag.
 */

/** How far a name may be from what was typed, as a share of the typed length. */
function within(typed: string): number {
  // A third of it, at least one and at most three. One edit on a short name and
  // three on `--exit-zero-on-changes`, which is the range real typos fall in:
  // a transposition, a dropped character, a repeated one.
  return Math.min(3, Math.max(1, Math.floor(typed.length / 3)));
}

/**
 * The single closest candidate, or nothing.
 *
 * Case-insensitive, because a name typed in the wrong case is the same mistake
 * and the answer is the same name. Comparison only — what comes back is the
 * candidate as it is actually spelled, since that is what has to be typed next.
 */
export function nearest(typed: string, candidates: readonly string[]): string | undefined {
  const limit = within(typed);
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;

  for (const candidate of candidates) {
    const distance = editDistance(typed.toLowerCase(), candidate.toLowerCase());
    if (distance > limit) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }

  return tied ? undefined : best;
}

/**
 * The line a refusal adds beside its list, or nothing.
 *
 * Its own function so every refusal says it the same way. An agent reading three
 * different phrasings for one idea has three things to recognise.
 *
 * A line of its own, and it carries the newline itself so a refusal with nothing
 * to suggest does not print a blank one. Beside the accepted set rather than
 * inside that sentence: the set is the part a reader parses — a name split out
 * of a list should not have half a second sentence attached to it.
 */
export function didYouMean(typed: string, candidates: readonly string[]): string {
  const found = nearest(typed, candidates);
  return found === undefined ? '' : `\nDid you mean \`${found}\`?`;
}

/**
 * Edits between two strings, counting a swap of neighbours as one.
 *
 * Three rows rather than a matrix: a transposition needs the row before last,
 * and nothing needs the one before that.
 */
function editDistance(from: string, to: string): number {
  let twoBack: number[] = [];
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);

  for (let row = 1; row <= from.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= to.length; column += 1) {
      const same = from[row - 1] === to[column - 1];
      let best = Math.min(
        previous[column - 1]! + (same ? 0 : 1),
        previous[column]! + 1,
        current[column - 1]! + 1,
      );
      if (
        row > 1 &&
        column > 1 &&
        from[row - 1] === to[column - 2] &&
        from[row - 2] === to[column - 1]
      ) {
        best = Math.min(best, twoBack[column - 2]! + 1);
      }
      current[column] = best;
    }
    twoBack = previous;
    previous = current;
  }

  return previous[to.length]!;
}
