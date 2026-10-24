import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { opening } from '@variance-authority/package/help';
import { declaredDescribedOf, describedWordsNative, nearOfNative, type DescribedFile } from '@variance-authority/sense';
import { docOf } from '../indexed-surface.js';
import type { SearchIndex } from '../search-index.js';
import { declaredMatch } from './declared.js';
import type { DeclaredMatch, FileMatch } from './search-answer.js';
import { admittedBy, termsOfStems } from './loose.js';

// compass: variance-authority.report.agent-surface

/**
 * The repository's own names and files a description reaches, asked by the
 * words the dependency lexicon asks a package by.
 *
 * A description is not a name: `tsconfig custom conditions` is three words an
 * agent would say about `customConditionsFor`, and neither the phrase nor every
 * word is in it. So the question is cut into stems by the rule the installed
 * packages were cut by — the sense addon owns it, stopwords included — and a
 * name answers when its own words, or the documentation of a row that
 * publishes or exports it, hold any of the question's distinct stems. One word
 * of three is still the nearest the repository has, and leaving it out would
 * answer that the repository has nothing; how much it holds decides where it
 * sits, below. A dictionary term
 * stands for a stem when it reduces to it, so `files` stands for `file` and
 * `filter` does not. A name its file declares and does not export is in no
 * row, so the source index answers for it by the same rule, its name and its
 * doc comment read in the sense addon. A file is described the same way, by
 * the words of its own name and of the doc it opens with — what it is for,
 * which no one declaration in it says. The words every package says about
 * itself — `package`, `module`, `use`, `tool`, `get` and the like — are asked
 * of code and not of a package, since code is named in them.
 *
 * Ordered by how much of the question it holds, each word weighed by how
 * rare it is among what the description reached — inverse document frequency,
 * `ln(1 + N / n)` of the `N` reached and the `n` holding it, counted in this
 * one question and stored nowhere — and a word its name holds weighed half
 * again, as a field-weighted ranking weighs a title over a body. Then the words
 * its name holds, then how many of the question's adjacent word pairs its doc
 * writes adjacent, then how many rows publish or export it, then the name's
 * own rank. A word every doc says in passing tells nothing about which of them
 * was meant: `find the repository root` is asked of `repositoryRoot`, not of
 * every doc that opens on `find` and mentions a root. Among words that weigh
 * alike the weight is a coordination factor: a doc that says all of what was
 * asked still describes it better than a name that says half, since half
 * again is less than twice. A name was chosen for what it does, and a doc that
 * writes the question's phrase about a name that holds none of it is usually
 * saying what the name is used with. The phrase — term proximity, counted as
 * the pairs it shares — settles what the weight and the name leave level.
 *
 * The rows shown hold every word anything reached holds: the best holder of a
 * word no row shown holds takes the place of the last row whose every word
 * another row shown also holds, so `mermaid chart palette` shows the one name
 * holding `mermaid` however many names holding `chart` sort before it. The
 * phrase is counted only for a name that can be shown, since a doc is decoded
 * to count it.
 */

/** What a reached name is ordered on. */
export interface DescribedKey {
  /** The question's words it holds, as the question wrote them, in stem order. */
  readonly words: readonly string[];
  /** Those of them its name holds. */
  readonly named: readonly string[];
  /** How many of the question's adjacent word pairs its doc writes adjacent. */
  readonly near: number;
  /** Rows that publish or export it. */
  readonly rows: number;
  readonly rank: number;
}

/** One name of the search index the description reached. */
export interface DescribedName extends DescribedKey {
  readonly name: number;
  /** The exported row whose doc held words its name did not: the row to show. */
  readonly through?: number;
}

/** One declaration no export binds that the description reached: in no row, and ranked after every name that is. */
export interface DescribedDeclaration extends DescribedKey {
  readonly match: DeclaredMatch;
}

/** One file the description reached by its own name and the doc it opens with. */
export interface DescribedFileHit extends DescribedKey {
  readonly file: DescribedFile;
}

/** What a description reached, of any kind. */
export type Described = DescribedName | DescribedDeclaration | DescribedFileHit;

/** A name of the search index the description reached, before its doc is read for the phrase. */
export type ReachedName = Omit<DescribedName, 'near'>;

/** What a description reached, a name's phrase not yet counted. */
export type Reached = ReachedName | DescribedDeclaration | DescribedFileHit;

/**
 * Names holding any of the description's distinct stems, unordered;
 * `undefined` when the question has no word to describe — every word short or
 * a stopword — so it was not asked.
 *
 * `already` names are never reached. `within`, file ids when given, admits a
 * name through a row whose file is in it, and a doc through the published or
 * exported row that carries it — the loose pass's rule, for the same reason.
 */
export function describedNames(
  index: SearchIndex,
  query: string,
  within: ReadonlySet<number> | undefined,
  already: ReadonlySet<number>,
): readonly ReachedName[] | undefined {
  const asked = describedWordsNative(query);
  if (asked.length === 0) return undefined;

  const stemmed = termsOfStems(index, asked.map(([stem]) => stem));

  const admits = admittedBy(index, within, already);

  // Per name, the positions of the asked stems it holds anywhere, and in its name.
  const held = new Map<number, Set<number>>();
  const named = new Map<number, Set<number>>();
  // Per name, per exported row, the stems that row's doc holds: one file's doc
  // counts for a name, never two files' docs added up.
  const docs = new Map<number, Map<number, Set<number>>>();
  const mark = (into: Map<number, Set<number>>, name: number, position: number): void => {
    const positions = into.get(name) ?? new Set<number>();
    positions.add(position);
    into.set(name, positions);
  };
  asked.forEach((_, position) => {
    for (const term of stemmed[position] ?? []) {
      for (const name of index.termNames(term)) {
        if (!admits(name)) continue;
        mark(held, name, position);
        mark(named, name, position);
      }
      for (const row of index.termPublished(term)) {
        const name = index.publishedName(row);
        if (already.has(name) || (within !== undefined && !within.has(index.publishedFile(row)))) continue;
        mark(held, name, position);
      }
      for (const row of index.termExported(term)) {
        const name = index.exportedName(row);
        if (already.has(name) || (within !== undefined && !within.has(index.exportedFile(row)))) continue;
        const rows = docs.get(name) ?? new Map<number, Set<number>>();
        docs.set(name, rows);
        mark(rows, row, position);
      }
    }
  });

  const through = new Map<number, number>();
  for (const [name, rows] of docs) {
    const own = held.get(name) ?? new Set<number>();
    let best = own;
    for (const [row, positions] of rows) {
      const union = new Set([...own, ...positions]);
      if (union.size <= best.size) continue;
      best = union;
      through.set(name, row);
    }
    held.set(name, best);
  }

  return [...held].map(([name, positions]): ReachedName => {
    const row = through.get(name);
    return {
      name,
      ...(row === undefined ? {} : { through: row }),
      words: asked.filter((_, position) => positions.has(position)).map(([, word]) => word),
      named: asked.filter((_, position) => named.get(name)?.has(position) === true).map(([, word]) => word),
      rows: index.publishedOf(name).length + index.exportedOf(name).length,
      rank: index.rank(name),
    };
  });
}

/**
 * The `count` rows of `reached` to show, best first by {@link describedOrderBy} the weight of what they reached:
 * the best of them, but a word anything reached holds is held by one of them,
 * its best holder taking the place of the last row a better one did not need.
 *
 * The weight of the words held and the words in the name order a row before
 * its phrase does, so a name's doc is decoded for the phrase only when the name
 * is level on both with a row that can be shown: in a level the rows above
 * leave room in, or the best level among a word's holders.
 */
export function describedShown(index: SearchIndex, query: string, reached: readonly Reached[], count: number): readonly Described[] {
  const words = describedWordsNative(query).map(([, word]) => word);
  const weight = weightOf(reached);
  const level = (a: Reached, b: Reached): number => levelOrder(weight, a, b);
  const levels = [...reached].sort(level);

  const read = new Set<Reached>();
  for (let at = 0; at < levels.length && at < count; ) {
    const from = at;
    while (at < levels.length && level(levels[from] as Reached, levels[at] as Reached) === 0) read.add(levels[at++] as Reached);
  }
  for (const word of words) {
    const best = levels.find((one) => one.words.includes(word));
    if (best === undefined) continue;
    for (const one of levels) if (level(best, one) === 0 && one.words.includes(word)) read.add(one);
  }

  const names = [...read].filter((one): one is ReachedName => !('near' in one));
  // One word has no pair to write adjacent, so no doc is decoded for it.
  const near = words.length > 1 ? nearOfNative(query, names.map((one) => docAbout(index, one.name, one.through) ?? '')) : [];
  const counted = new Map(names.map((one, at) => [one, near[at] ?? 0]));
  const order = describedOrderBy(weight);
  const weighed = [...read].map((one): Described => ('near' in one ? one : { ...one, near: counted.get(one) ?? 0 })).sort(order);

  const shown = weighed.slice(0, count);
  for (const word of words) {
    if (shown.some((one) => one.words.includes(word))) continue;
    const holder = weighed.find((one) => one.words.includes(word));
    // The last row whose every word another row shown also holds gives its place.
    let gives = shown.length - 1;
    while (gives >= 0 && !(shown[gives] as Described).words.every((held) => shown.some((other, at) => at !== gives && other.words.includes(held)))) gives -= 1;
    if (holder === undefined || gives < 0) continue;
    shown.splice(gives, 1);
    shown.push(holder);
  }
  return shown.sort(order);
}

/** The doc a reached name is shown with: the row it was reached through, else its first published or exported row's. */
function docAbout(index: SearchIndex, name: number, through: number | undefined): string | undefined {
  if (through !== undefined) return index.exported(through).doc;
  const published = index.publishedOf(name)[0];
  if (published !== undefined) return index.published(published).doc;
  const exported = index.exportedOf(name)[0];
  return exported === undefined ? undefined : index.exported(exported).doc;
}

/**
 * The declarations no export binds, and the files, in `files` when they are
 * named, whose name and doc hold any of the description's distinct stems;
 * `undefined` when the question has no word to describe or no checkout
 * was named, and when its source index is absent or does not read, which the
 * `declared` section already says.
 */
export function describedDeclarations(
  root: string | undefined,
  query: string,
  files: Iterable<string> | undefined,
): readonly (DescribedDeclaration | DescribedFileHit)[] | undefined {
  const asked = describedWordsNative(query);
  if (root === undefined || asked.length === 0) return undefined;
  let read: ReturnType<typeof declaredDescribedOf>;
  try {
    read = declaredDescribedOf(root, query, asked.map(([stem]) => stem as string), files);
  } catch {
    return undefined;
  }
  if (read === undefined) return undefined;
  const words = (positions: readonly number[] | null | undefined): string[] => {
    const held = new Set(positions ?? []);
    return asked.filter((_, position) => held.has(position)).map(([, word]) => word as string);
  };
  const unranked = { rows: 0, rank: Number.MAX_SAFE_INTEGER } as const;
  return [
    ...read.names.map((one): DescribedDeclaration => ({
      match: declaredMatch(one), words: words(one.held), near: one.near ?? 0, named: words(one.named), ...unranked,
    })),
    ...read.files.map((file): DescribedFileHit => ({ file, words: words(file.held), near: file.near, named: words(file.named), ...unranked })),
  ];
}

/** A described file as a `search` section holds it, its doc's opening read from the checkout. */
export function fileMatch(root: string | undefined, file: DescribedFile): FileMatch {
  let summary: string | undefined;
  if (root !== undefined && file.docStart != null && file.docEnd != null) {
    try {
      const doc = docOf(readFileSync(join(root, file.at), 'utf8'), { start: file.docStart, end: file.docEnd });
      summary = doc === undefined ? undefined : opening(doc);
    } catch {
      summary = undefined;
    }
  }
  return { source: 'file', at: file.at, ...(file.by === '' ? {} : { package: file.by }), ...(summary === undefined ? {} : { summary }) };
}

/** Where a reached thing sorts at a full tie: a name of the index, then a declaration, then a file. */
const kindOrder = (one: Described): number => ('match' in one ? 1 : 'file' in one ? 2 : 0);

/** The keys a row's weight is read from. */
type Weighed = Pick<DescribedKey, 'words' | 'named'>;

/** How much of the question one row holds. */
type Weight = (key: Weighed) => number;

/** A word its name holds weighs this many times what a doc holding it does. */
const NAME_WEIGHT = 1.5;

/**
 * The weight of what a row holds of the question: each word's inverse
 * frequency among `reached`, `ln(1 + N / n)`, times {@link NAME_WEIGHT} when
 * its name holds it.
 */
function weightOf(reached: readonly Weighed[]): Weight {
  const holders = new Map<string, number>();
  for (const one of reached) for (const word of one.words) holders.set(word, (holders.get(word) ?? 0) + 1);
  const rare = new Map([...holders].map(([word, n]) => [word, Math.log(1 + reached.length / n)]));
  return (key) => key.words.reduce((sum, word) => sum + (rare.get(word) ?? 0) * (key.named.includes(word) ? NAME_WEIGHT : 1), 0);
}

/** Two weights a float's rounding alone tells apart are level. */
const LEVEL = 1e-9;

/** Weight, then words in the name: the keys that order a row before its phrase is counted. */
function levelOrder(weight: Weight, a: Weighed, b: Weighed): number {
  const apart = weight(b) - weight(a);
  return (Math.abs(apart) < LEVEL ? 0 : Math.sign(apart)) || b.named.length - a.named.length;
}

/**
 * Best first by `weight`: the weight of the words held, then words in the
 * name, then the phrase its doc shares, then rows, then rank; a name of the
 * index before a declaration before a file, declarations by file, then line,
 * and files by path.
 */
const describedOrderBy = (weight: Weight) => (a: Described, b: Described): number =>
  levelOrder(weight, a, b) ||
  b.near - a.near ||
  b.rows - a.rows ||
  a.rank - b.rank ||
  kindOrder(a) - kindOrder(b) ||
  // `const a = 1, b = 2` declares two names on one line; the name settles them.
  ('match' in a && 'match' in b
    ? codeUnitOrder(a.match.at, b.match.at) || a.match.line - b.match.line || codeUnitOrder(a.match.name, b.match.name)
    : 'file' in a && 'file' in b
      ? codeUnitOrder(a.file.at, b.file.at)
      : 0);
