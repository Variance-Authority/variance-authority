import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolInvocation } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { refreshDependencyLexicon } from './dependency-lexicon.js';
import { workspaceGeneration, workspaceReadStarted } from './snapshot.js';
import { writtenSince } from './tools/as-read.js';
import { FoundNothing } from './tools/find.js';
import { printedFiles, search } from './tools/search.js';
import { restsOn, symbol } from './tools/symbol.js';
import { uses, usesPrinted } from './tools/uses.js';

/** The files an answer rests on, read as the answer read them. */
type Printed = (help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help>) => Iterable<string>;

/** What each answer that can say so rests on, by the question that gives it. */
const PRINTED: ReadonlyMap<string, Printed> = new Map<string, Printed>([
  [symbol.name, restsOn],
  [search.name, printedFiles],
  [uses.name, usesPrinted],
]);

/**
 * Whether the files an answer rests on changed after the generation it comes
 * from began its read, so that it goes to {@link caughtUp} as a refusal does:
 * a file gone, or an mtime after that read began, as `movedSince` in sense
 * compares one. A refresh limited to a list, made during the request that began
 * at `started`, keeps the time of the read it refreshed and is taken at its word,
 * so it is not looked at; any other generation is, the one read whole during the
 * request as well. A question its tool refuses rests on what it rested on in
 * `before`, the generation it was answered from; with none it has nothing to look at.
 */
export async function outlived(
  asked: string | undefined,
  help: Help,
  input: Readonly<Record<string, unknown>>,
  invocation: ToolInvocation<Help> & { readonly root: string },
  started: number,
  before?: Help,
): Promise<boolean> {
  const printed = asked === undefined ? undefined : PRINTED.get(asked);
  const at = workspaceGeneration(help);
  const since = workspaceReadStarted(help);
  if (printed === undefined || at === undefined || since === undefined || (Date.parse(at) >= started && since < started)) return false;
  const rested = (read: Help): readonly string[] | undefined => {
    try {
      return [...printed(read, input, invocation)];
    } catch {
      return undefined;
    }
  };
  const files = rested(help) ?? (before === undefined ? undefined : rested(before));
  if (files === undefined) return false;
  // A file saved during the read may be in the generation or not, so it counts:
  // the cost of counting one that is is a read, whose later time ends the question.
  const changed = await Promise.all(files.map((file) => stat(join(invocation.root, file)).then((held) => writtenSince(held.mtimeMs, since), () => true)));
  return changed.includes(true);
}

/**
 * What a source question does before a refusal, or an answer {@link outlived}
 * found changed, is believed, on `variance ask`, `variance serve`, and this
 * package's binary and server. `refusedAt` is the generation it was answered
 * from, `lexiconRoot` the checkout whose lexicon this process may refresh, absent
 * for a host whose checkout is its own. `again` reads and asks once more, `current`
 * wanting a generation made now, and `still` looks once at what that read gave, or
 * with no subject at the generation `refusedAt` dates, when it was made during the
 * question and is not read again. Undefined when nothing it read can have lagged
 * the checkout, so the answer stands.
 */
export async function caughtUp<Answer>(
  refusedAt: string | undefined,
  started: number,
  lexiconRoot: string | undefined,
  again: (current: boolean) => Promise<Answer>,
  still?: (subject?: Answer) => Promise<boolean>,
): Promise<CaughtUp<Answer> | undefined> {
  if (refusedAt === undefined) return undefined;
  const reused = Date.parse(refusedAt) < started;
  // Two comparisons, each said on its own line when it could not be made: the
  // source against the generation the refusal came from, and the installed
  // packages against the lexicon, which `variance index` alone builds, so a
  // checkout that never ran it would refuse a name an installed package declares.
  let packages: string | undefined;
  let refreshed = false;
  if (lexiconRoot !== undefined) {
    try {
      refreshed = !(await refreshDependencyLexicon(lexiconRoot)).unchanged;
    } catch (failure) {
      packages = `Installed packages not compared with the checkout: the dependency lexicon could not be refreshed (${messageOf(failure)}).`;
    }
  }
  const unread = (unseen: string): CaughtUp<Answer> => {
    const source = snapshotLine(refusedAt, unseen);
    return { footer: packages === undefined ? source : `${source}\n${packages}`, unseen };
  };
  // A file saved during a read may or may not be in it. It is not read again, so
  // one read is what a request costs at most, and the next question reads.
  if (!reused && !refreshed) {
    if ((await still?.()) === true) return unread(MOVED);
    return packages === undefined ? undefined : { footer: packages };
  }
  try {
    const subject = await again(reused);
    const moved = (await still?.(subject)) === true;
    return { subject, ...(moved ? { unseen: MOVED } : {}), ...(packages === undefined ? {} : { footer: packages }) };
  } catch (failure) {
    // A refusal from a reading that could not be brought up to date is no fact about the checkout.
    return unread(`it could not be read again: ${messageOf(failure)}`);
  }
}

/** Why an answer read again was still not compared. */
const MOVED = 'a file it rests on changed while it was read';

/**
 * What {@link caughtUp} asked again, and what a refusal that still stands says.
 * The shape is the one `serve` from `@variance-authority/mcp` takes back from
 * its `again` hook, so a server hands it on as it is.
 */
export interface CaughtUp<Answer> {
  /** What the question was asked again of, brought up to date; absent when nothing could be read. */
  readonly subject?: Answer;
  /** The lines a refusal ends with when part of the checkout could not be compared, and why; a found answer's date line says what it needs of them. */
  readonly footer?: string;
  /** Why the checkout was not compared with the answer, for its date line; when no `subject` came back, `footer` opens with that line. */
  readonly unseen?: string;
}

/**
 * The lines under an answer that found nothing, which {@link caughtUp} read
 * again before it was believed: the date of the generation it was read from
 * (`at`, `unseen` saying the checkout was not compared with it), then what part
 * of the checkout could not be compared, and why. A footer that already dates
 * the generation is not dated twice.
 */
export function foundNothingFooter(caught: CaughtUp<unknown> | undefined, at: string | undefined, unseen: boolean): string | undefined {
  const lines = caught?.unseen !== undefined && caught.subject === undefined ? [caught.footer] : [at === undefined ? undefined : snapshotLine(at, caught?.unseen ?? unseen), caught?.footer];
  const said = lines.filter((line) => line !== undefined);
  return said.length === 0 ? undefined : said.join('\n');
}

/**
 * The lines under any other refusal, which carries a date only when the checkout
 * was not compared with what it came from, and then says why as {@link foundNothingFooter} does.
 */
export function refusalFooter(caught: CaughtUp<unknown> | undefined, at: string | undefined, unseen: boolean): string | undefined {
  return caught?.unseen === undefined && !unseen ? caught?.footer : foundNothingFooter(caught, at, unseen);
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
