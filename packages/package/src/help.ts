import { relative, resolve } from 'node:path';
import type { Declaration } from './declare.js';
import { type Offering, type OfferingOptions, readOfferings } from './manifest.js';
import { createReader, namesReachedBy, type Names } from './reach.js';
import { type Mention, type Readmes, readMention, readmes } from './mention.js';
import { type Deep, type Named, type Usage, type UsageOptions, type Use, readUsage } from './use.js';

/**
 * What a workspace publishes, what it says about it, and what uses it.
 *
 * Three readings joined into one value. The manifests say which doors exist, the
 * source behind them says what is on the other side and what was written about
 * it, and the rest of the repository says which of it anybody actually reaches
 * for. Separately each is a partial answer; together they are the thing an agent
 * needs in order to use a library it has never seen.
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

/** One published name: what it is, what it says, and who reaches for it. */
export interface Entry {
  readonly name: string;
  /** Every kind this name turned out to be, joined — an `interface` and a `const` share one. */
  readonly kind: string;
  /** The file that declares it, relative to the workspace root. */
  readonly at: string;
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
}

/** One published package. */
export interface Documented {
  readonly name: string;
  /** The manifest keys `OFFERED` names, present-or-absent, verbatim. */
  readonly declared: Readonly<Record<string, unknown>>;
  readonly openings: readonly Opening[];
}

/** A workspace, read three ways and joined. */
export interface Help {
  readonly packages: readonly Documented[];
  /** Specifiers reaching into a package past what its `exports` map opens. */
  readonly deep: readonly Deep[];
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
 * Who imports a name, and how often.
 *
 * A package importing its own name is excluded from `usedBy` and counted in
 * `uses`. Both halves of that are deliberate: a package's own tests import its
 * barrel constantly, so counting them as consumers would make every name look
 * load-bearing, and dropping them entirely would lose the fact that the name is
 * exercised at all.
 */
function reachedFrom(usage: Usage, key: string, name: string, owner: string): Pick<Entry, 'usedBy' | 'uses' | 'sites'> {
  const uses = usage.names.get(key)?.get(name) ?? [];
  const by: string[] = [];
  for (const use of uses) {
    if (use.by !== owner && !by.includes(use.by)) by.push(use.by);
  }
  return { usedBy: by, uses: uses.length, sites: uses };
}

function entryOf(
  name: string,
  kinds: ReadonlyMap<string, Declaration>,
  reached: Pick<Entry, 'usedBy' | 'uses' | 'sites'>,
  found: (at: string) => Mention | undefined,
): Entry {
  // The kinds of one name are one thing declared once — an interface merged with
  // a const is written in one place, under one comment — so the first of them
  // carries the place and the prose, and the rest contribute their word.
  const [first] = [...kinds.values()];
  if (first === undefined) throw new Error(`\`${name}\` was reached with no declaration behind it`);

  const mention = first.doc === undefined ? found(first.at) : undefined;

  return {
    name,
    kind: [...kinds.keys()].sort().join('+'),
    at: first.at,
    line: first.line,
    ...(first.signature === undefined ? {} : { signature: first.signature }),
    ...(first.doc === undefined ? {} : { doc: first.doc }),
    ...(mention === undefined ? {} : { mention }),
    ...reached,
  };
}

/**
 * Read a workspace's active, documented API.
 *
 * Entries within a subpath are ordered by how much of the repository reaches for
 * them, then by name. That ordering is the product rather than a presentation
 * choice: everything downstream truncates somewhere, and what survives the
 * truncation should be what somebody was most likely to ask about.
 */
export function readHelp(root: string, options: HelpOptions = {}): Help {
  const where = resolve(root);
  const offerings = readOfferings(where, options);

  const entrypoints = new Map<string, string>();
  for (const offering of offerings) {
    for (const entry of offering.entrypoints) {
      entrypoints.set(`${offering.name} ${entry.subpath}`, entry.source);
    }
  }

  const reader = createReader(where, entrypoints);
  const usage = options.usage ?? readUsage(where, new Set(entrypoints.keys()), options, reader.parses);

  return assembleHelp(where, offerings, usage, (source) => namesReachedBy(reader, source));
}

/** Join manifests, declarations and usage after a caller has already read the source. */
export function assembleHelp(
  root: string,
  offerings: readonly Offering[],
  usage: Usage,
  namesOf: (source: string) => Names,
): Help {
  const where = resolve(root);

  // One cache for one reading, and one lookup per declaring file: a barrel and a
  // subpath publishing the same declaration ask the same question twice.
  const held: Readmes = readmes();
  const mentions = new Map<string, Mention | undefined>();
  const mentionOf = (name: string) => (at: string) => {
    const key = `${at} ${name}`;
    if (!mentions.has(key)) mentions.set(key, readMention(where, at, name, held));
    return mentions.get(key);
  };

  const packages = offerings.map((offering) => ({
    name: offering.name,
    declared: offering.declared,
    openings: offering.entrypoints.map((entry) => {
      const key = `${offering.name} ${entry.subpath}`;
      const entries = [...namesOf(entry.source)]
        .map(([name, kinds]) =>
          entryOf(name, kinds, reachedFrom(usage, key, name, offering.name), mentionOf(name)),
        )
        .sort(
          (a, b) =>
            b.usedBy.length - a.usedBy.length ||
            b.uses - a.uses ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        );
      return { subpath: entry.subpath, source: relative(where, entry.source), entries };
    }),
  }));

  return {
    packages,
    deep: usage.deep,
    exported: usage.exported,
    unreadable: [...offerings.flatMap((offering) => offering.unreadable ?? []), ...usage.unreadable],
  };
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
export { opening, writeGaps, writeIndex, writeLlms } from './write.js';
export type { Page } from './write.js';
export { readUsage, usageFrom, kindOf } from './use.js';
export type {
  Bound,
  Named,
  Deep,
  Exported,
  Recorded,
  Requested,
  Through,
  Usage,
  UsageOptions,
  Use,
  UseKind,
} from './use.js';
export { ownership, readOfferings, requested } from './manifest.js';
export type { Entrypoint, Offering, OfferingOptions } from './manifest.js';
export { readMention, readmes } from './mention.js';
export type { Mention, Readmes } from './mention.js';
export type { Declaration, DeclarationKind } from './declare.js';
export type { Names } from './reach.js';
