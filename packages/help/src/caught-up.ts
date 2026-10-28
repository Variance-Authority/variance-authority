import { refreshDependencyLexicon } from './dependency-lexicon.js';
import { FoundNothing } from './tools/find.js';

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
 * refusal stands as it is. Otherwise `subject` is what was asked again, and
 * `footer` is what every refusal of the question ends with when part of the
 * checkout could not be compared: the second reading failed, which dates the
 * refusing generation and says why, or the lexicon could not be refreshed,
 * which says the installed packages were not compared. A refusal from a
 * reading that could not be brought up to date is not a fact about the
 * checkout, and says so.
 */
export async function caughtUp<Answer>(
  refusedAt: string | undefined,
  started: number,
  lexiconRoot: string | undefined,
  again: (current: boolean) => Promise<Answer>,
): Promise<CaughtUp<Answer> | undefined> {
  if (refusedAt === undefined) return undefined;
  const reused = Date.parse(refusedAt) < started;
  // Two comparisons, each said on its own line when it could not be made: the
  // source against the generation the refusal came from, and the installed
  // packages against the lexicon whichever reading refuses consults.
  let packages: string | undefined;
  let refreshed = false;
  if (lexiconRoot !== undefined) {
    try {
      refreshed = !(await refreshDependencyLexicon(lexiconRoot)).unchanged;
    } catch (failure) {
      packages = `Installed packages not compared with the checkout: the dependency lexicon could not be refreshed (${messageOf(failure)}).`;
    }
  }
  if (!reused && !refreshed) return packages === undefined ? undefined : { footer: packages };
  try {
    return { subject: await again(reused), ...(packages === undefined ? {} : { footer: packages }) };
  } catch (failure) {
    const source = snapshotLine(refusedAt, `it could not be read again: ${messageOf(failure)}`);
    return { footer: packages === undefined ? source : `${source}\n${packages}`, dated: true };
  }
}

/**
 * What {@link caughtUp} asked again, and what a refusal that still stands says.
 * The shape is the one `serve` from `@variance-authority/mcp` takes back from
 * its `again` hook, so a server hands it on as it is.
 */
export interface CaughtUp<Answer> {
  /** What the question was asked again of, brought up to date; absent when nothing could be read. */
  readonly subject?: Answer;
  /** The lines a refusal ends with when part of the checkout could not be compared, and why. */
  readonly footer?: string;
  /** True when `footer` opens with the date of the generation that could not be read again. */
  readonly dated?: true;
}

/**
 * The lines under an answer that found nothing, which {@link caughtUp} read
 * again before it was believed: the date of the generation it was read from
 * (`at`, `unseen` saying the checkout was not compared with it), then what part
 * of the checkout could not be compared, and why. A footer that already dates
 * the generation is not dated twice.
 */
export function foundNothingFooter(caught: CaughtUp<unknown> | undefined, at: string | undefined, unseen: boolean): string | undefined {
  const lines = caught?.dated === true ? [caught.footer] : [at === undefined ? undefined : snapshotLine(at, unseen), caught?.footer];
  const said = lines.filter((line) => line !== undefined);
  return said.length === 0 ? undefined : said.join('\n');
}

/**
 * The answer a question gives when what it threw is a {@link FoundNothing}, for
 * every surface that asks one — `variance ask`, `variance serve`, and this
 * package's binary and server — so a name nothing declares reads the same on
 * each: what was read and found nothing, then {@link foundNothingFooter}'s
 * lines. Undefined for any other throw, which stays a refusal.
 */
export function foundNothingAnswer(thrown: unknown, caught: CaughtUp<unknown> | undefined, at: string | undefined, unseen: boolean): string | undefined {
  if (!(thrown instanceof FoundNothing)) return undefined;
  const dated = foundNothingFooter(caught, at, unseen);
  return dated === undefined ? thrown.message : `${thrown.message}\n${dated}`;
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
