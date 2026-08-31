/**
 * The one sentence a movement carries, written once for both readers.
 *
 * Every rung ends in prose because the category is not the answer — *upstream*
 * tells a reviewer nothing, `ProductCard` was edited and reaches it through
 * `Card` sends them to a file. The sentence is written here, shipped to the
 * terminal and to the review page, and rendered rather than rewritten at the far
 * end: a second sentence composed for the web is a second thing that can
 * disagree with the first, and the disagreement would be between a reviewer's
 * screen and their CI log.
 *
 * Names the sentence claims things about are wrapped in backticks. That is for
 * the terminal, and the page turns each pair into `code` rather than reprinting
 * the punctuation.
 */

import type { Site } from './composition.js';
import type { Ancestor, Evidence } from './movement.js';

/**
 * The upstream sentence, which is the one a reviewer acts on.
 *
 * It says three things and the third is the reason the first two are worth
 * printing: an edited component reaches this one, this one's own file is not in
 * the change set, and therefore what moved here is what it was handed. Every
 * rung above this has already been tried, so *its own code* and *a token it
 * reads* are both ruled out by the time this speaks.
 */
export function becauseUpstream(ancestor: Ancestor): string {
  const reaches =
    ancestor.through.length === 0 ? 'mounts it' : `reaches it through ${chain(ancestor.through)}`;

  return (
    `\`${ancestor.name}\` was edited and ${reaches}; nothing edited its own file, ` +
    `so it moved on what it was given`
  );
}

/** The components in between, named while there are few enough to be worth naming. */
function chain(through: readonly string[]): string {
  const named = through.map((name) => `\`${name}\``);
  if (named.length === 1) return named[0] ?? '';
  if (named.length > 3) return `${named.slice(0, 3).join(', ')} and ${String(named.length - 3)} more`;
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`;
}

/**
 * Why nothing explains it, and how much the suite could say about that.
 *
 * The three endings are three different findings and were one sentence. An empty
 * control group has two causes — the component renders nowhere else with these
 * inputs, or it renders elsewhere and moved in every one of them — and they point
 * opposite ways. The first is a suite with nothing to compare against. The second
 * *is* the comparison, and a component that moved in all six of its renders with
 * no file, token or ancestor behind it is the strongest unexplained this ladder
 * can produce.
 */
export function unexplainedBecause(
  movement: { readonly component: string; readonly held: readonly Site[] },
  considered: number,
  evidence: Evidence,
): string {
  if (evidence.changed === undefined) {
    return 'nothing was asked about what changed, so nothing here explains it — run with `--against` to reach the first rung';
  }

  const unexplained = 'no file, token or ancestor explains it, and';

  if (considered === 0) {
    return `${unexplained} it renders nowhere else in this run with these props to compare against`;
  }

  if (movement.held.length === 0) {
    return `${unexplained} every other render of it with these props moved here too`;
  }

  return (
    `${unexplained} the same component with the same props held in ` +
    `${movement.held.length} of ${considered} other place(s) in this run`
  );
}
