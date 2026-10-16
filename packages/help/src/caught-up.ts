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
 *
 * Returns undefined when nothing it read can have lagged the checkout, so the
 * refusal stands as it is. Otherwise `again` is what was asked again, and
 * `footer` is the line every refusal of the question ends with when the
 * checkout could not be compared: the lexicon could not be refreshed, or the
 * second reading failed. A refusal from a reading that lagged and could not be
 * brought up to date is not a fact about the checkout, and says so.
 */
export async function caughtUp<Answer>(
  refusedAt: string | undefined,
  started: number,
  lexiconRoot: string | undefined,
  again: (current: boolean) => Promise<Answer>,
): Promise<CaughtUp<Answer> | undefined> {
  if (refusedAt === undefined) return undefined;
  const reused = Date.parse(refusedAt) < started;
  let unread: string | undefined;
  let refreshed = false;
  if (lexiconRoot !== undefined) {
    try {
      refreshed = !(await refreshDependencyLexicon(lexiconRoot)).unchanged;
    } catch (failure) {
      unread = `its dependency lexicon could not be refreshed: ${messageOf(failure)}`;
    }
  }
  const footer = (why: string): string => snapshotLine(refusedAt, why);
  if (!reused && !refreshed) return unread === undefined ? undefined : { footer: footer(unread) };
  try {
    return { again: await again(reused), ...(unread === undefined ? {} : { footer: footer(unread) }) };
  } catch (failure) {
    return { footer: footer(`it could not be read again: ${messageOf(failure)}`) };
  }
}

/** What {@link caughtUp} asked again, and what a refusal that still stands says. */
export interface CaughtUp<Answer> {
  /** The question asked again of a reading brought up to date; absent when none could be made. */
  readonly again?: Answer;
  /** The line a refusal ends with when the checkout could not be compared, and why. */
  readonly footer?: string;
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The line that dates a source answer. A generation read without comparing it
 * with the checkout says so, since a name missing from it may only be newer;
 * `unseen` as a sentence is why a comparison that was asked for was not made.
 */
export function snapshotLine(at: string, unseen: boolean | string): string {
  if (unseen === false) return `Snapshot ${at}.`;
  const why = unseen === true ? '' : ` (${unseen})`;
  return `Snapshot ${at}, not compared with the checkout${why}: run \`variance index\` if files changed since.`;
}
