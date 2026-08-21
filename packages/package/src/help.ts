import { relative, resolve } from 'node:path';
import type { Declaration } from './declare.js';
import { type OfferingOptions, readOfferings } from './manifest.js';
import { createReader, namesReachedBy } from './reach.js';
import { type Deep, type Usage, type UsageOptions, readUsage } from './use.js';

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
  /** Files whose imports could not be enumerated. Empty is the expected answer. */
  readonly unreadable: readonly string[];
}

export interface HelpOptions extends OfferingOptions, UsageOptions {}

/**
 * Who imports a name, and how often.
 *
 * A package importing its own name is excluded from `usedBy` and counted in
 * `uses`. Both halves of that are deliberate: a package's own tests import its
 * barrel constantly, so counting them as consumers would make every name look
 * load-bearing, and dropping them entirely would lose the fact that the name is
 * exercised at all.
 */
function reachedFrom(usage: Usage, key: string, name: string, owner: string): Pick<Entry, 'usedBy' | 'uses'> {
  const uses = usage.names.get(key)?.get(name) ?? [];
  const by: string[] = [];
  for (const use of uses) {
    if (use.by !== owner && !by.includes(use.by)) by.push(use.by);
  }
  return { usedBy: by, uses: uses.length };
}

function entryOf(name: string, kinds: ReadonlyMap<string, Declaration>, reached: Pick<Entry, 'usedBy' | 'uses'>): Entry {
  // The kinds of one name are one thing declared once — an interface merged with
  // a const is written in one place, under one comment — so the first of them
  // carries the place and the prose, and the rest contribute their word.
  const [first] = [...kinds.values()];
  if (first === undefined) throw new Error(`\`${name}\` was reached with no declaration behind it`);

  return {
    name,
    kind: [...kinds.keys()].sort().join('+'),
    at: first.at,
    line: first.line,
    ...(first.signature === undefined ? {} : { signature: first.signature }),
    ...(first.doc === undefined ? {} : { doc: first.doc }),
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
  const usage = readUsage(where, new Set(entrypoints.keys()), options, reader.parses);

  const packages = offerings.map((offering) => ({
    name: offering.name,
    declared: offering.declared,
    openings: offering.entrypoints.map((entry) => {
      const key = `${offering.name} ${entry.subpath}`;
      const entries = [...namesReachedBy(reader, entry.source)]
        .map(([name, kinds]) => entryOf(name, kinds, reachedFrom(usage, key, name, offering.name)))
        .sort((a, b) => b.usedBy.length - a.usedBy.length || b.uses - a.uses || a.name.localeCompare(b.name));
      return { subpath: entry.subpath, source: relative(where, entry.source), entries };
    }),
  }));

  return { packages, deep: usage.deep, unreadable: usage.unreadable };
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
    .sort((a, b) => b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name));
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
export { readUsage } from './use.js';
export type { Deep, Usage, UsageOptions, Use } from './use.js';
export type { Declaration, DeclarationKind } from './declare.js';
