import { refreshDependencyLexicon } from './dependency-lexicon.js';

/**
 * What a refused source question does before its refusal is believed, for every
 * surface that asks one: `variance ask`, `variance serve`, and this package's
 * own binary and server.
 *
 * A generation is reused for an hour, so one published before the question may
 * not hold a file written since: the question is asked again of one made now.
 * The dependency lexicon is built by `variance index` alone, so a checkout that
 * never ran it, or installed a package since, would refuse a name an installed
 * package declares: it is brought up to date, which costs a stat of each
 * installed manifest when nothing moved. Only a refusal pays for either; an
 * answer that found its name is given from the generation it was found in.
 *
 * `refusedAt` is the generation the refusal came from. A question that read
 * none has nothing that could have lagged, and is not asked again.
 * `lexiconRoot` is the checkout whose lexicon this process may refresh, absent
 * for a host whose checkout is its own. `again` reads and asks once more,
 * `current` saying a generation made now is wanted rather than the one in hand.
 * Returns undefined when nothing it read can have lagged the checkout.
 */
export async function caughtUp<Answer>(
  refusedAt: string | undefined,
  started: number,
  lexiconRoot: string | undefined,
  again: (current: boolean) => Promise<Answer>,
): Promise<Answer | undefined> {
  if (refusedAt === undefined) return undefined;
  const reused = Date.parse(refusedAt) < started;
  const lexicon = lexiconRoot !== undefined && !(await refreshDependencyLexicon(lexiconRoot).then(
    ({ unchanged }) => unchanged,
    // Unprepared, the lexicon stays what it was, and the refusal that names
    // `variance index` stands: that command says why it was not prepared.
    () => true,
  ));
  if (!reused && !lexicon) return undefined;
  return again(reused);
}

/**
 * The line that dates a source answer. A generation read without comparing it
 * with the checkout says so, since a name missing from it may only be newer.
 */
export function snapshotLine(at: string, unseen: boolean): string {
  return unseen ? `Snapshot ${at}, not compared with the checkout: run \`variance index\` if files changed since.` : `Snapshot ${at}.`;
}
