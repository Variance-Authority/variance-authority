import { type OfferingOptions } from './manifest.js';
import { type Deep, type Named, type Usage, type UsageOptions, type Use } from './use.js';

/**
 * What a workspace publishes, what it says about it, and what uses it.
 *
 * Three readings joined into one value. The manifests say which doors exist, the
 * source behind them says what is on the other side and what was written about
 * it, and the rest of the repository says which of it anybody actually reaches
 * for. Separately each is a partial answer; together they are the thing an agent
 * needs in order to use a library it has never seen.
 *
 * This module holds the value's shape and what reads it. The join itself runs
 * in the addon, behind `readHelp` in `@variance-authority/help`, which is the
 * one join the index's publish runs too.
 *
 * ## Why the third reading changes the answer
 *
 * A published surface of a thousand names is not a document. Handed to a model
 * it is a thousand equally-weighted facts, and the one it needs is as likely to
 * be the last as the first. `uses` is the ordering that was there all along:
 * `digestValue`, imported from nine places, is the front door, and a type
 * nothing has mentioned since it was added is a footnote — or a mistake.
 *
 * That same number is what makes the documentation gap actionable. *61% of names
 * carry a doc* is a statistic nobody acts on. *These eleven names are imported
 * across a package boundary and say nothing about themselves* is a morning's
 * work, and it is the eleven that anyone would have hit first.
 *
 * ## Plain JSON, for the same reason the surface is
 *
 * A reader that returned a rendered page would have decided what could be asked
 * of it. This returns the join and nothing else; rendering it as an index, an
 * `llms.txt`, or an answer to one question over a wire are three consumers of
 * one value, and none of them is privileged.
 */

/**
 * A passage of a README that names a symbol, for a name nothing was written
 * above. Never merged into `doc`: a paragraph about a package is not a comment
 * about a declaration.
 */
export interface Mention {
  /** The README, relative to the workspace root. */
  readonly at: string;
  /** The 1-based line the passage begins on. */
  readonly line: number;
  /** The passage, verbatim. */
  readonly text: string;
}

/** One published name: what it is, what it says, and who reaches for it. */
export interface Entry {
  readonly name: string;
  /** Every kind this name turned out to be, joined — an `interface` and a `const` share one. */
  readonly kind: string;
  /** The file that declares it, relative to the workspace root. */
  readonly at: string;
  /**
   * The name `at` exports it under, which with `at` is which declaration this
   * is: `export { greet as salute } from './greet.js'` publishes `salute` and
   * declares `greet`, beside a `salute` the same file may declare too.
   */
  readonly declared: string;
  readonly line: number;
  /** Everything written before the body. */
  readonly signature?: string;
  /** The block comment written above it, undented. */
  readonly doc?: string;
  /** Packages that import this name, in the order they were found. */
  readonly usedBy: readonly string[];
  /** How many places import it, counting each import statement once. */
  readonly uses: number;
  /**
   * Every place that imports it, including the declaring package's own files.
   *
   * `usedBy` and `uses` are this list counted two ways, and both counts are what
   * a *ranking* needs. They are not what somebody writing the call needs, which
   * is a file and a line they can open — so the sites are kept rather than
   * summarised away, and whoever renders them decides how many to show.
   */
  readonly sites: readonly Use[];
  /**
   * Every place that reads this name off the module's `default`:
   * `(await import('m')).default.x`.
   *
   * Kept apart from `sites`, and counted in neither `usedBy` nor `uses`:
   * `default` holds the name only when the module is CommonJS, and for an ES
   * module that does not export it there, the line reads something else.
   */
  readonly throughDefault: readonly Use[];
  /**
   * Where the nearest README names this, for a name with no doc comment.
   *
   * Present only when `doc` is absent and the prose exists. Never merged into
   * `doc`: a paragraph about a package is not a comment about a declaration, and
   * counting it as one would empty the work queue without closing it.
   */
  readonly mention?: Mention;
}

/** One subpath a manifest opens, and everything behind it. */
export interface Opening {
  readonly subpath: string;
  /** The file the manifest points at, relative to the workspace root. */
  readonly source: string;
  readonly entries: readonly Entry[];
  /**
   * Every place this subpath's module goes on whole where the reading does not
   * follow it — passed to a call, returned, stored. Each may read any name of
   * it, and none is known to, so it is a fact of the module, held once here,
   * and no use of any entry.
   */
  readonly whole: readonly Use[];
}

/** One published package. */
export interface Documented {
  readonly name: string;
  /** Whether the manifest declares an entry — `exports`, `main`, `types` or `typings` — whether or not any of it was opened. */
  readonly entry: boolean;
  readonly openings: readonly Opening[];
}

/** A workspace, read three ways and joined. */
export interface Help {
  readonly packages: readonly Documented[];
  /** Specifiers naming a file of a package past every specifier its manifest declares: deep imports. */
  readonly deep: readonly Deep[];
  /**
   * Specifiers a published manifest declares that the reading could not follow
   * to a source file, such as a `main` naming a build output the checkout does
   * not hold. Each names the entry exactly, so none is deep.
   */
  readonly unfollowed: readonly Deep[];
  /**
   * Specifiers naming a file of a package that declares no entry — no
   * `exports`, `main`, `types` or `typings` — private or not.
   *
   * Such a package is a folder and a boundary, and these imports are its whole
   * surface: which of its files other packages import, and which names they
   * take. Nothing is listed from its files that nobody imports, because nothing
   * is declared to list.
   */
  readonly byPath: readonly Deep[];
  /**
   * Every name the repository's own files export, published or not.
   *
   * `packages` is the surface: the names a manifest opens a door to, joined
   * against their documentation and their consumers. This is the rest of the
   * repository — three thousand names here against a few hundred published —
   * and it carries a file and a line and nothing else, because nothing else was
   * read for it.
   *
   * It is here because the question *where is the thing that does X* does not
   * know in advance whether X was published, and a search that only looked at
   * the surface would answer *nowhere* for most of the code. The two are kept
   * apart rather than merged so that an answer can still say which it found: a
   * published name is an API, and an exported one is somebody's internal.
   */
  readonly exported: readonly Named[];
  /** Files whose imports could not be enumerated. Empty is the expected answer. */
  readonly unreadable: readonly string[];
}

export interface HelpOptions extends OfferingOptions, UsageOptions {
  /**
   * What the repository already imports, when something read it already.
   *
   * The third reading is the expensive one — every module file in the
   * repository, opened and parsed — and it is the one most likely to have been
   * done. A caller holding a cached, incremental reading of the same tree passes
   * it here and this reads the manifests and the entrypoints only.
   */
  readonly usage?: Usage;
}

/**
 * The places outside `owner` that may read `entry` and are no use of it: reads
 * off the module's `default`, and the module passed on whole. A name with none
 * of `usedBy` and some of these is unknown, not unused.
 */
export function undecided(owner: string, held: Pick<Opening, 'whole'>, entry: Pick<Entry, 'throughDefault'>): readonly Use[] {
  return [...entry.throughDefault, ...held.whole].filter((use) => use.by !== owner);
}

/** Where the places `undecided` returns may read a name: `may be read in 2 places: 1 off …, 1 passing …`. */
export function mayBeRead(places: readonly Use[]): string {
  const off = places.filter((use) => use.through?.throughDefault === true).length;
  const parts = [
    ...(off > 0 ? [`${off} off the module's \`default\``] : []),
    ...(places.length > off ? [`${places.length - off} passing the module on whole`] : []),
  ];
  return `may be read in ${places.length} ${places.length === 1 ? 'place' : 'places'}: ${parts.join(', ')}`;
}

/** Every entry of a reading, flattened, with the package and subpath each came from. */
export function* everyEntry(help: Help): Generator<readonly [Documented, Opening, Entry]> {
  for (const published of help.packages) {
    for (const opening of published.openings) {
      for (const entry of opening.entries) yield [published, opening, entry];
    }
  }
}

/**
 * Names anybody outside their own package imports, and which say nothing about
 * themselves.
 *
 * The gap worth closing, in the order worth closing it. A name nothing imports
 * may be undocumented because nobody needed it; a name three packages import is
 * undocumented in front of an audience.
 */
export function undocumented(help: Help): readonly Entry[] {
  return [...everyEntry(help)]
    .map(([, , entry]) => entry)
    .filter((entry) => entry.doc === undefined && entry.usedBy.length > 0)
    .sort(
      (a, b) =>
        b.usedBy.length - a.usedBy.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

/**
 * The rest of the entrypoint.
 *
 * A caller that wants the join almost always wants a page out of it, and the
 * two live one import apart rather than one package apart: rendering needs
 * nothing a reading does not already need.
 */
export { opening, PARAGRAPH_BREAK, writeGaps, writeIndex, writeLlms } from './write.js';
export type { Page } from './write.js';
export { boundDeclaration, gatheringUsage, kindOf, ownBinding, usageFrom } from './use.js';
export { readUsage } from './read-usage.js';
export type {
  Bound,
  Named,
  Deep,
  Exported,
  Recorded,
  Requested,
  Taken,
  Through,
  Usage,
  UsageOptions,
  Use,
  UseKind,
} from './use.js';
export { ownership, readImportTargets, readOfferings, readWorkspaceManifests } from './manifest.js';
export { requested } from './exports.js';
export { landing, type ImportTargets } from './entry.js';
export type { Entrypoint, Offering, OfferingOptions, WorkspaceManifests } from './manifest.js';
export type { Declaration, DeclarationKind } from './declare.js';
export type { Names, Reached } from './reach.js';
