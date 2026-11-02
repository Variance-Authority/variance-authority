import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { heldWeight, rarity } from '@variance-authority/mcp/tools';
import { opening } from '@variance-authority/package/help';
import { declaredDescribedOf, describedWordsNative, nearOfNative, type DescribedFile } from '@variance-authority/sense';
import { docOf } from '../indexed-surface.js';
import type { SearchIndex } from '../search-index.js';
import { declaredMatch } from './declared.js';
import type { DeclaredMatch, FileMatch } from './search-answer.js';
import { admittedBy, rowWithin, termsOfStems } from './loose.js';

// compass: variance-authority.report.agent-surface

/**
 * The repository's own names and files a description reaches, asked by the
 * words the dependency lexicon asks a package by.
 *
 * A description is not a name: `tsconfig custom conditions` is three words an
 * agent would say about `customConditionsFor`. So the question is cut into
 * stems by the sense addon's rule, stopwords included, and a name answers when
 * its own words or the doc of a row that publishes or exports it hold any of
 * them; one word of three is still the nearest the repository has. A name no row
 * holds is answered by the source index by the same rule, and a file by its
 * name and the doc it opens with. A row's signature adds words to a name
 * something else reached, below its doc. {@link weightOf} weighs what each
 * holds, {@link describedOrderBy} orders them, and {@link describedShown} picks
 * the rows shown so that every word anything reached holds is held by one.
 * Integers throughout, so a tie is a tie (ADR-0057).
 */

/** What a reached name is ordered on. */
export interface DescribedKey {
  /** The question's words it holds, as the question wrote them, in stem order. */
  readonly words: readonly string[];
  /** Those of them its name holds. */
  readonly named: readonly string[];
  /** Those of them only its signature holds, neither its name nor its doc; absent when no signature was read. */
  readonly signed?: readonly string[];
  /** How many of the question's adjacent word pairs its doc writes, by {@link nearOfNative}. */
  readonly near: number;
  /** Rows that publish or export it, in an area only those {@link rowWithin} it. */
  readonly rows: number;
  readonly rank: number;
  /** The bytes of the doc it is judged by, absent when it has none: what a word its doc holds is counted against. */
  readonly docLength?: number;
}

const docLengthOf = (bytes: number | null | undefined): Pick<DescribedKey, 'docLength'> => (bytes == null ? {} : { docLength: bytes });

/** The `rows` that count for a name: every one, or in an area, `within` file ids, those {@link rowWithin} it. */
const rowsWithin = (index: SearchIndex, kind: DescribedRow['kind'], rows: Uint32Array, within: ReadonlySet<number> | undefined): Uint32Array =>
  within === undefined ? rows : rows.filter((row) => rowWithin(index, kind, row, within));

/** One name of the search index the description reached. */
export interface DescribedName extends DescribedKey {
  readonly name: number;
  /**
   * The row it is weighed, ordered and shown through: of its published and
   * exported rows, the one its name's words and that row's doc weigh most by
   * {@link weightOf}; of those weighing alike, the one whose doc writes the most
   * of the question's adjacent word pairs, then the first by {@link RowOrder}.
   */
  readonly through: DescribedRow;
}

/** One published or exported row of the search index. */
export interface DescribedRow {
  readonly kind: 'published' | 'exported';
  readonly row: number;
}

/**
 * The order one name's rows are shown in, a total order: of the rows a name
 * weighs as much through, whose docs write as many of the question's adjacent
 * word pairs, the first is the one it is shown through.
 */
export type RowOrder = (a: DescribedRow, b: DescribedRow) => number;

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
export type ReachedName = Omit<DescribedName, 'near'> & Counted & {
  /**
   * The rows it can be shown through: the one it is weighed through, then each
   * other row with a doc weighing as much, by {@link RowOrder}.
   */
  readonly tied: readonly Pick<DescribedName, 'through' | 'words' | 'signed' | 'docLength'>[];
};

/** What one reached thing counts for in every word's rarity and the mean doc length: the same whichever row it is weighed through. */
interface Counted {
  /** The question's words held anywhere: in its name, or in any doc it could be weighed through. */
  readonly holds: readonly string[];
  /** The bytes of each doc it could be weighed through. */
  readonly docLengths: readonly number[];
}

const countedOf = (one: Reached): Counted =>
  'holds' in one ? one : { holds: one.words, docLengths: one.docLength === undefined ? [] : [one.docLength] };

/** What a description reached, a name's phrase not yet counted. */
export type Reached = ReachedName | DescribedDeclaration | DescribedFileHit;

/**
 * Names holding any of the description's distinct stems, unordered;
 * `undefined` when the question has no word to describe — every word short or
 * a stopword — so it was not asked.
 *
 * `already` names are never reached. `within`, file ids when given, admits a
 * name by its own words and a doc only through a row {@link rowWithin} the
 * area and counts only those rows; the index writes a name only for a row of
 * it, so every name reached has one. `order` is the {@link RowOrder} of the
 * section showing them. `others`, the declarations and files reached, count in
 * each word's rarity and in the mean doc length.
 */
export function describedNames(
  index: SearchIndex,
  query: string,
  within: ReadonlySet<number> | undefined,
  already: ReadonlySet<number>,
  order: RowOrder,
  others: readonly (DescribedDeclaration | DescribedFileHit)[] = [],
): readonly ReachedName[] | undefined {
  const asked = describedWordsNative(query);
  if (asked.length === 0) return undefined;

  const stemmed = termsOfStems(index, asked.map(([stem]) => stem));

  const admits = admittedBy(index, within, already);

  // Per name, the positions of the asked stems its own words hold.
  const named = new Map<number, Set<number>>();
  // Per published or exported row, the stems its doc holds: one row's doc
  // counts for a name, never two rows' docs added up.
  const docs = new Map<string, Set<number>>();
  // Per row, the stems its signature holds, which reach no name on their own.
  const signatures = new Map<string, Set<number>>();
  const reached = new Set<number>();
  const mark = <K>(into: Map<K, Set<number>>, key: K, position: number): void => {
    into.set(key, (into.get(key) ?? new Set<number>()).add(position));
  };
  const markRow = (name: number, kind: DescribedRow['kind'], row: number, position: number): void => {
    if (already.has(name) || (within !== undefined && !rowWithin(index, kind, row, within))) return;
    reached.add(name);
    mark(docs, `${kind}:${row}`, position);
  };
  asked.forEach((_, position) => {
    for (const term of stemmed[position] ?? []) {
      for (const name of index.termNames(term)) {
        if (!admits(name)) continue;
        reached.add(name);
        mark(named, name, position);
      }
      for (const row of index.termPublished(term)) markRow(index.publishedName(row), 'published', row, position);
      for (const row of index.termExported(term)) markRow(index.exportedName(row), 'exported', row, position);
      for (const row of index.termPublishedSignature(term)) mark(signatures, `published:${row}`, position);
      for (const row of index.termExportedSignature(term)) mark(signatures, `exported:${row}`, position);
    }
  });

  const wordsOf = (positions: ReadonlySet<number> | undefined): string[] =>
    asked.filter((_, position) => positions?.has(position) === true).map(([, word]) => word);
  // Held by the row's name or doc, the words that reach a name.
  const saidThrough = (name: number, row: DescribedRow): Set<number> =>
    new Set([...(named.get(name) ?? []), ...(docs.get(`${row.kind}:${row.row}`) ?? [])]);
  const signatureOf = (row: DescribedRow): ReadonlySet<number> => signatures.get(`${row.kind}:${row.row}`) ?? new Set();
  const heldThrough = (name: number, row: DescribedRow): Set<number> => new Set([...saidThrough(name, row), ...signatureOf(row)]);
  // Held by the row's signature alone: neither its name nor its doc holds it.
  const signedThrough = (name: number, row: DescribedRow): Set<number> => {
    const said = saidThrough(name, row);
    return new Set([...signatureOf(row)].filter((position) => !said.has(position)));
  };
  const candidates = [...reached].map((name) => {
    const rows: DescribedRow[] = [
      ...[...rowsWithin(index, 'published', index.publishedOf(name), within)].map((row) => ({ kind: 'published' as const, row })),
      ...[...rowsWithin(index, 'exported', index.exportedOf(name), within)].map((row) => ({ kind: 'exported' as const, row })),
    ];
    const holds = wordsOf(new Set(rows.flatMap((row) => [...heldThrough(name, row)])));
    const docLengths = rows.flatMap((row) => rowDocLength(index, row) ?? []);
    return { name, rows, holds, docLengths };
  });

  // Every row a name could be weighed through counts, the chosen one or not.
  const weight = weightOf([...candidates, ...others.map(countedOf)]);
  return candidates.map(({ name, rows, holds, docLengths }): ReachedName => {
    const own = wordsOf(named.get(name));
    const picks = rows.map((row) => ({
      through: row, words: wordsOf(heldThrough(name, row)), named: own, signed: wordsOf(signedThrough(name, row)), ...docLengthOf(rowDocLength(index, row)),
    }));
    const chosen = picks.reduce((best, one) => ((weight(best) - weight(one) || order(one.through, best.through)) < 0 ? one : best));
    // A row with no doc writes no phrase, so it never comes before the row chosen.
    const most = weight(chosen);
    const alike = picks.filter((one) => one !== chosen && one.docLength !== undefined && weight(one) === most);
    return { name, ...chosen, rows: rows.length, rank: index.rank(name), holds, docLengths, tied: [chosen, ...alike.sort((a, b) => order(a.through, b.through))] };
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
 * leave room in, or the best level among a word's holders. A word is weighed
 * by how rare it is in `population`, everything the description reached, of
 * which `reached` is what is left to show.
 */
export function describedShown(
  index: SearchIndex,
  query: string,
  reached: readonly Reached[],
  count: number,
  population: readonly Reached[],
): readonly Described[] {
  const words = describedWordsNative(query).map(([, word]) => word);
  const weight = weightOf(population.map(countedOf));
  const level = (a: Reached, b: Reached): number => levelOrder(weight, a, b);
  const levels = [...reached].sort(level);

  const read = new Set<Reached>();
  for (let at = 0; at < levels.length && at < count; ) {
    const from = at;
    while (at < levels.length && level(levels[from] as Reached, levels[at] as Reached) === 0) read.add(levels[at++] as Reached);
  }
  // A name may be shown through any of the rows it weighs as much through.
  const holding = (one: Reached, word: string): boolean => ('tied' in one ? one.tied : [one]).some((row) => row.words.includes(word));
  for (const word of words) {
    const best = levels.find((one) => holding(one, word));
    if (best === undefined) continue;
    for (const one of levels) if (level(best, one) === 0 && holding(one, word)) read.add(one);
  }

  const rows = [...read].flatMap((one) => ('tied' in one ? one.tied : []));
  // One word has no pair to write as a phrase, so no doc is decoded for it.
  const near = words.length > 1 ? nearOfNative(query, rows.map((one) => rowDoc(index, one.through) ?? '')) : [];
  let at = 0;
  const order = describedOrderBy(weight);
  const weighed = [...read].map((one): Described => {
    if (!('tied' in one)) return one;
    // The first of its tied rows whose doc writes the most of the question's pairs.
    const nears = one.tied.map(() => near[at++] ?? 0);
    const nearest = nears.reduce((best, count, row) => (count > (nears[best] ?? 0) ? row : best), 0);
    return { ...one, ...one.tied[nearest], near: nears[nearest] ?? 0 };
  }).sort(order);

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

/** One row's doc: for a reached name, the doc of the row it is shown through. */
function rowDoc(index: SearchIndex, row: DescribedRow): string | undefined {
  return row.kind === 'published' ? index.published(row.row).doc : index.exported(row.row).doc;
}

/**
 * Two rows of one kind level on every count, in every section: the doc's text,
 * an absent one last, then what a published row declares or the line an
 * exported one is declared on, then the file, then a published row's specifier,
 * in code-unit order. Where the index wrote a row follows its package and file
 * names, which say nothing about the name, so it settles nothing. A published
 * row has no line, so the file settles two published declarations of one
 * kind under one doc; otherwise the path and the specifier settle only one name
 * two files export on one line under one doc, or one declaration two specifiers
 * publish.
 */
export function rowTextOrder(index: SearchIndex, a: DescribedRow, b: DescribedRow): number {
  const text = (row: DescribedRow): readonly [string | undefined, string, number, string, string] => {
    if (row.kind === 'exported') {
      const { doc, line, at } = index.exported(row.row);
      return [doc, '', line, at, ''];
    }
    const { doc, kind, at, specifier } = index.published(row.row);
    return [doc, kind, 0, at, specifier];
  };
  const [docA, kindA, lineA, atA, specifierA] = text(a);
  const [docB, kindB, lineB, atB, specifierB] = text(b);
  const doc = docA === docB ? 0 : docA === undefined ? 1 : docB === undefined ? -1 : codeUnitOrder(docA, docB);
  return doc || codeUnitOrder(kindA, kindB) || lineA - lineB || codeUnitOrder(atA, atB) || codeUnitOrder(specifierA, specifierB);
}

/** The bytes of one row's doc, without decoding it; absent when it has none. */
function rowDocLength(index: SearchIndex, row: DescribedRow): number | undefined {
  return row.kind === 'published' ? index.publishedDocLength(row.row) : index.exportedDocLength(row.row);
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
      ...docLengthOf(one.docLength),
    })),
    ...read.files.map((file): DescribedFileHit => ({
      file, words: words(file.held), near: file.near, named: words(file.named), ...unranked,
      ...docLengthOf(file.docLength),
    })),
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
type Weighed = Pick<DescribedKey, 'words' | 'named' | 'signed' | 'docLength'>;

/** How much of the question one row holds. */
type Weight = (key: Weighed) => number;

/**
 * The weight of a word by where a row holds it: its name, as a title, over its
 * doc, over its signature — what its declaration writes before its body, its
 * parameters and the types they are written with — so `coverageTest(task:
 * FinishedFile)` answers `finished test file` before a name holding only
 * `test`, and after a row whose doc holds the words.
 */
const FIELD_WEIGHTS = { name: 3, doc: 2, signature: 0.5 } as const;

/**
 * The weight of what a row holds of the question: each word's {@link rarity}
 * among `population`, by what each holds anywhere, times what the place it holds it in counts — its name
 * its {@link FIELD_WEIGHTS} weight in thousandths, its doc its weight times
 * the doc's {@link lengthCount}, never more than a doc of the mean length, its
 * signature alone its weight, a quarter of a mean doc's and as much as a doc
 * eight times the mean length counts —
 * summed by {@link heldWeight}, times the rarities of the words held summed
 * alone: how much of the question the row holds, wherever it holds it. That is
 * Lucene's coordination factor weighed by rarity, so a word's rarity weighs in
 * both factors, and a word most rows hold adds little to either. An integer.
 */
function weightOf(population: readonly Counted[]): Weight {
  const holders = new Map<string, number>();
  let docBytes = 0;
  let docs = 0;
  for (const one of population) {
    for (const word of one.holds) holders.set(word, (holders.get(word) ?? 0) + 1);
    // Absent is not empty: a row without a doc says nothing of how long a doc is.
    for (const length of one.docLengths) {
      if (length === 0) continue;
      docBytes += length;
      docs += 1;
    }
  }
  const rare = new Map([...holders].map(([word, n]) => [word, rarity(population.length, n)]));
  const name = FIELD_WEIGHTS.name * 1000;
  const signature = FIELD_WEIGHTS.signature * 1000;
  return (key) => {
    // A doc longer than most counts less than one of the mean length, and a
    // shorter one as much: a doc's word, never a name's. An unmeasured doc is
    // not an empty one, so it counts as one of the mean length.
    const counted = key.docLength === undefined ? 1000 : Math.min(1000, lengthCount(key.docLength, docBytes, docs));
    const doc = FIELD_WEIGHTS.doc * counted;
    // How much of the question it holds, wherever: a coordination factor by rarity.
    const covered = heldWeight(key.words, (word) => rare.get(word) ?? 0, () => 1);
    const field = (word: string): number => (key.named.includes(word) ? name : key.signed?.includes(word) === true ? signature : doc);
    return covered * heldWeight(key.words, (word) => rare.get(word) ?? 0, field);
  };
}

/**
 * BM25's length term for a word held once, in thousandths: how much a word
 * held in a text of `bytes` counts, against the mean of `docs` docs of
 * `docBytes` in all. With `k1` six fifths and `b` three quarters,
 * `1000 (k1 + 1) / (1 + k1 (1 - b) + k1 b L / A)` is `22000 A / (13 A + 9 L)`,
 * here with `A` as `docBytes / docs` multiplied through: a doc of the mean
 * length counts 1000, an empty one 1692, ten times the mean 213. With no doc
 * to measure against, every doc counts 1000.
 */
function lengthCount(bytes: number, docBytes: number, docs: number): number {
  return docBytes === 0 ? 1000 : Math.floor((22000 * docBytes) / (13 * docBytes + 9 * bytes * docs));
}

/** Weight, then words in the name: the keys that order a row before its phrase is counted. */
function levelOrder(weight: Weight, a: Weighed, b: Weighed): number {
  return weight(b) - weight(a) || b.named.length - a.named.length;
}

/**
 * Best first by `weight`: the weight of the words held, then words in the
 * name, then the phrase its doc shares, then rows, then rank; a name of the
 * index before a declaration before a file, declarations by file, then line,
 * and files by path. The phrase comes after the name: a doc that writes the
 * question's phrase about a name holding none of it is usually saying what the
 * name is used with, so term proximity only settles what the rest leaves level.
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
