import type { Tree } from '@variance-authority/mcp/tools';
import { opening } from '@variance-authority/package/help';
import { describedWordsNative, wordStemsNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { tokensOf } from '../search-index.js';
import type { Area } from './area.js';
import { areaOf } from './area.js';
import { looseNames, matchingTerms, rowWithin, termsOfStems } from './loose.js';
import { describedDeclarations, describedNames, describedShown, fileMatch, rowTextOrder, type Reached, type RowOrder } from './described.js';
import { declaredKey, looseDeclarations } from './loose-declared.js';
import { queryDependencyLexicon, type LexiconMatches } from '../dependency-lexicon.js';
import { declaredMatches, exactness } from './declared.js';
import { docRows, exported, exportedOrder, first } from './exported-matches.js';
import { counting, type ImportingOf, type InArea, type PublishedMatch } from './published-match.js';

/**
 * What `search` found, before a word of it is written.
 *
 * The text answer is one rendering of this and `--format json` is the other,
 * so the two cannot disagree about a count or a row: both read the same value.
 * What was not determined is absent, never empty. A start point that did not
 * resolve carries `refused` and no sections, because nothing was searched; the
 * loose and described sections are absent when an earlier section answered,
 * because they were not run, and present with a total of zero when they ran and
 * found nothing.
 *
 * Every `total` counts the whole match and every `shown` holds the first few.
 * Only the shown rows are decoded, so a two-letter query that matches a
 * hundred thousand names costs its count and fifteen rows.
 */

/** Published matches shown before the answer says it stopped. */
export const CAP = 40;

/** Exported matches shown. Lower, because the section below it is the cheaper half. */
export const ELSEWHERE_CAP = 25;

/** Loose matches shown. Lowest: these are the ones the caller did not ask for. */
export const LOOSE_CAP = 15;

/** Described matches shown: as many as the loose pass, the same kind of guess. */
export const DESCRIBED_CAP = LOOSE_CAP;

/** How wrong a word may be and still be looked up: one character, capped in `loose.ts`. */
const FUZZY = 0.2;

/** What a question to `search` says. */
export interface SearchQuestion {
  /**
   * A substring of a name or its documentation, matched case-insensitively; or
   * several words, which also match a name whose own words — split where the
   * case or a digit changes — start with every one of them.
   */
  readonly query: string;
  /** Paths whose imports the answer is confined to. */
  readonly from?: string | readonly string[] | undefined;
  /** Paths whose importers the answer is confined to. */
  readonly to?: string | readonly string[] | undefined;
}

export type { InArea, PublishedMatch } from './published-match.js';

/** A name the source exports without publishing. */
export interface ExportedMatch {
  readonly source: 'exported';
  readonly name: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  /** The file shown: the row that ranks it, where the question was found first, then {@link exportedOrder}; in the described section, the row it is weighed through. */
  readonly at: string;
  readonly line: number;
  /** How many files export it, the one shown included. */
  readonly files: number;
  /**
   * The first paragraph of the shown row's own documentation, on one line, as
   * `PublishedMatch` says it; absent when that row has none.
   */
  readonly summary?: string;
}

/** A name a file declares at its top level and does not export. */
export interface DeclaredMatch {
  readonly source: 'declared';
  readonly name: string;
  /** The declaration's kind as the parser read it: `function`, `const`, … */
  readonly kind: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  readonly at: string;
  readonly line: number;
}

/** A file of this repository, described by its name and the doc it opens with. */
export interface FileMatch {
  readonly source: 'file';
  readonly at: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  /** The first paragraph of the doc the file opens with, on one line; absent when it opens with none. */
  readonly summary?: string;
}

/** A name or a file of this repository a description reached, and which of its words it holds. */
export type DescribedMatch = (PublishedMatch | ExportedMatch | DeclaredMatch | FileMatch) & {
  /** The question's words the name, the file's name or the documentation holds, as the question wrote them. */
  readonly words: readonly string[];
};

export interface Matches<T> {
  readonly total: number;
  readonly shown: readonly T[];
}

/** The closure a start point resolved to, counted. */
export interface SearchArea {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly files: number;
  /** Files the paths themselves named. */
  readonly entries: number;
  /** Files in it whose own imports the scan could not enumerate. */
  readonly unresolved: number;
}

/**
 * One `search` answer, as the text and `--format json` both read it.
 *
 * Sections are present when they ran. `loose` runs only when the exact local
 * sections are empty and no installed name holds the query, and `described`
 * runs beside it. No section runs when `refused` is set.
 */
export interface SearchAnswer {
  /** The query as it was matched: lowercase. */
  readonly query: string;
  /** Absent when no start point was said. */
  readonly area?: SearchArea;
  /** Why the start point was not resolved. When present, nothing was searched. */
  readonly refused?: string;
  readonly published?: Matches<PublishedMatch>;
  readonly exported?: Matches<ExportedMatch>;
  /**
   * Names a file declares and does not export, read off the source index.
   * Absent when no checkout was named or its index could not be read.
   */
  readonly declared?: Matches<DeclaredMatch> & {
    /** Files whose declarations the index holds none of, since none were read: unknown, not empty. */
    readonly unread: readonly string[];
  };
  /**
   * Present only when the exact sections are empty, which is when it runs: the
   * published and exported names first, then the ones a file keeps to itself.
   */
  readonly loose?: Matches<PublishedMatch | ExportedMatch | DeclaredMatch>;
  /**
   * This repository's names and files holding any of the question's words,
   * but a name holding fewer than half the stems that `loose` holds. Present
   * when `loose` ran, which is when it runs;
   * absent too when the question has no word to describe it by.
   */
  readonly described?: Matches<DescribedMatch>;
  /** Installed third-party names available to this workspace or area. */
  readonly thirdParty?: LexiconMatches;
  /** Why the imports within a package were not read for the counts shown; absent when they were, or nothing was counted. */
  readonly importsUnread?: string;
}

/** The answer, and the resolved area the text renders its header from. */
export interface Searched {
  readonly answer: SearchAnswer;
  readonly area: Area | undefined;
}

/** One published row, keyed by the columns it sorts on — nothing decoded yet. */
interface Hit {
  readonly row: number;
  readonly name: number;
  readonly rank: number;
  readonly usedBy: number;
  readonly uses: number;
  /**
   * Where the question was found: 0 as the whole name as written, 1 as the
   * whole name in another case, 2 in the name, 3 in the doc's opening
   * paragraph, 4 later in the doc.
   */
  readonly field: number;
  /** What the area saw of it — nothing, when there is no area. */
  readonly scoped: InArea | undefined;
}

/** Import sites of one published name that are actually written in the area. */
function usedWithin(index: SearchIndex, row: number, area: Area, inArea: ReadonlySet<number>): InArea {
  const sites = [...index.siteFiles(row)].filter((at) => inArea.has(at));
  const files = new Set(sites);
  const distance = new Map<number, number>();
  for (const file of files) {
    const hops = area.distance.get(index.file(file));
    if (hops !== undefined) distance.set(hops, (distance.get(hops) ?? 0) + 1);
  }
  return { files: files.size, imports: sites.length, filesByDistance: [...distance].sort(([a], [b]) => a - b) };
}

/**
 * Published rows, in the order the surface is always read in.
 *
 * The rows arrive as a set rather than a rule because the same ordering has
 * to hold for names the substring found and names the loose pass added. Two
 * orderings would be two answers, and the second would look like a ranking.
 *
 * The area enters here rather than at the call sites for the same reason: it
 * decides both what is admitted and how what is admitted is ordered, and a
 * second pass that applied only one of the two would answer a scoped question
 * with an unscoped ranking.
 *
 * `field` says where the question was found in a row, and orders before
 * anything the area or the importers say: a name that is the word is the thing
 * asked for, a name holding the word is that thing, a doc opening with it says what the name is for, and a doc saying it
 * three paragraphs down mentions it. Absent, every row was reached alike.
 */
function surface(
  index: SearchIndex,
  rows: Iterable<number>,
  area: Area | undefined,
  inArea: ReadonlySet<number> | undefined,
  field?: (row: number, name: number) => number,
): readonly Hit[] {
  const admitted = [...new Set(rows)].filter((row) => area === undefined || inArea === undefined || rowWithin(index, 'published', row, inArea));
  return admitted.map((row) => hitOf(index, row, area, inArea, field));
}

/** One published row's {@link Hit}, the area's counts of it included when there is one. */
function hitOf(index: SearchIndex, row: number, area: Area | undefined, inArea: ReadonlySet<number> | undefined, field?: (row: number, name: number) => number): Hit {
  const scoped = area === undefined || inArea === undefined ? undefined : usedWithin(index, row, area, inArea);
  const name = index.publishedName(row);
  return { row, name, rank: index.rank(name), usedBy: index.usedBy(row), uses: index.uses(row), field: field?.(row, name) ?? 0, scoped };
}

/**
 * The order {@link surface}'s rows are read in. A rank is a name's own, so {@link rowTextOrder} settles rows of
 * one name: by the doc's text, then the kind, then the row's path and specifier, never by where the index wrote them.
 */
const surfaceOrder = (index: SearchIndex) => (a: Hit, b: Hit): number =>
  a.field - b.field ||
  (b.scoped?.files ?? 0) - (a.scoped?.files ?? 0) ||
  (b.scoped?.imports ?? 0) - (a.scoped?.imports ?? 0) ||
  b.usedBy - a.usedBy ||
  b.uses - a.uses ||
  a.rank - b.rank ||
  rowTextOrder(index, { kind: 'published', row: a.row }, { kind: 'published', row: b.row });

/**
 * The first `count` of `hits`, each counted by `importingOf` when it is given
 * and then ordered by that count in place of the index's. Which rows the page
 * holds stays the index's to say: counting a row reads the source index, so
 * counting every candidate would cost the question a read per match.
 */
function published(index: SearchIndex, hits: readonly Hit[], count: number, importingOf?: ImportingOf): Matches<PublishedMatch> {
  const order = surfaceOrder(index);
  const page = first(hits, count, order).map((hit) => {
    const entry = index.published(hit.row);
    const importedIn = importingOf?.(entry.name, entry.at).importing;
    return { entry, importedIn, hit: importedIn === undefined ? hit : { ...hit, usedBy: importedIn.packages, uses: importedIn.places } };
  });
  if (importingOf !== undefined) page.sort((a, b) => order(a.hit, b.hit));
  return {
    total: hits.length,
    shown: page.map(({ entry, importedIn, hit }) => ({
      source: 'published',
      name: entry.name,
      specifier: entry.specifier,
      kind: entry.kind,
      ...(entry.doc === undefined ? {} : { summary: opening(entry.doc) }),
      at: entry.at,
      ...(importedIn === undefined ? {} : { importedIn }),
      otherPackages: entry.usedBy.length,
      otherImports: entry.uses,
      ...(hit.scoped === undefined ? {} : { inArea: hit.scoped }),
    })),
  };
}

/**
 * The described section's {@link RowOrder}: a published row before an exported one, then {@link surfaceOrder} with the
 * question found alike in each, or {@link exportedOrder}. The published and exported sections also put a published row
 * first, before where the question was found; the described section puts a row's weight, then its phrase, before it.
 */
export function shownRowOrder(index: SearchIndex, area: Area | undefined, within: ReadonlySet<number> | undefined): RowOrder {
  const hits = new Map<number, Hit>();
  const hit = (row: number): Hit => {
    const one = hits.get(row) ?? hitOf(index, row, area, within);
    hits.set(row, one);
    return one;
  };
  const publishedOrder = surfaceOrder(index);
  const exportedRows = exportedOrder(index);
  return (a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'published' ? -1 : 1) ||
    (a.kind === 'published' ? publishedOrder(hit(a.row), hit(b.row)) : exportedRows(a.row, b.row));
}

/** Every published row of the names given. */
const publishedOf = (index: SearchIndex, names: Iterable<number>): number[] =>
  [...names].flatMap((name) => [...index.publishedOf(name)]);

/**
 * What the words match, in the area a start point resolved to: the published
 * rows the area uses and the exported names past them. Both the answer and the
 * file set read this, so they cannot disagree about what matched.
 */
function matched(index: SearchIndex, question: SearchQuestion, tree: Tree | undefined) {
  const query = question.query.toLowerCase();
  const area =
    question.from === undefined && question.to === undefined ? undefined : areaOf(question.from, question.to, tree);
  // A start point that could not be resolved is refused whole. Answering the
  // unscoped question instead would hand back four hundred names under a
  // header the caller has every reason to read as *in your area*.
  if (area?.refused !== undefined) return { query, area, refused: area.refused } as const;

  const within = area === undefined ? undefined : index.fileIds(area.files);
  const named = ascending(index.namesContaining(query), namesOfWords(index, query));
  const byName = new Set(named);
  const openings = new Set(index.docOpeningsContaining(query));
  // The name that is the question is the thing asked for, however few import
  // it: as written first, then the same word in another case.
  const exact = new Map<number, number>();
  for (const name of named) {
    const tier = exactness(index.name(name), question.query);
    if (tier !== undefined) exact.set(name, tier);
  }
  const field = (row: number, name: number): number => exact.get(name) ?? (byName.has(name) ? 2 : openings.has(row) ? 3 : 4);
  const hits = surface(index, [...publishedOf(index, named), ...index.docsContaining(query)], area, within, field);
  const answered = new Set(hits.map((hit) => hit.name));
  // An exported row is reached by its doc as a published one is, and inside an
  // area only through a row whose file is in it.
  const through = docRows(index, index.exportedDocsContaining(query), within, byName);
  const rest = exported(index, ascending(named, [...through.keys()]), answered, within, through, new Set(index.exportedDocOpeningsContaining(query)), exact);
  return { query, area, within, named, hits, answered, rest } as const;
}

/**
 * Every file declaring a name the words match, uncapped: the file each matched
 * published name is declared in, without a line the index keeps for it, and
 * each file that exports a matched name, at its line. The loose pass and
 * installed names are not files of this checkout's answer: one is a guess at
 * other words, the other is not in the checkout.
 */
export function searchedFiles(index: SearchIndex, question: SearchQuestion, tree?: Tree): ReadonlyMap<string, readonly number[]> {
  const found = matched(index, question, tree);
  if ('refused' in found) throw new Error(`\`search\` searched nothing: ${found.refused}.`);
  const files = new Map<string, number[]>();
  for (const hit of found.hits) {
    const at = index.publishedAt(hit.row);
    if (!files.has(at)) files.set(at, []);
  }
  for (const row of found.rest.rows()) {
    const { at, line } = index.exported(row);
    const lines = files.get(at) ?? [];
    if (!lines.includes(line)) lines.push(line);
    files.set(at, lines.sort((left, right) => left - right));
  }
  return files;
}

/**
 * The search over an opened index, and the area the text answer names. Each
 * published row shown is counted by `importingOf` when it is given, as `uses`
 * counts that name.
 */
export function searched(index: SearchIndex, question: SearchQuestion, tree?: Tree, root?: string, importingOf?: ImportingOf): Searched {
  const count = importingOf === undefined ? undefined : counting(importingOf);
  const found = searchedBy(index, question, tree, root, count?.of);
  const unread = count?.unread();
  return unread === undefined ? found : { ...found, answer: { ...found.answer, importsUnread: unread } };
}

function searchedBy(index: SearchIndex, question: SearchQuestion, tree: Tree | undefined, root: string | undefined, importingOf: ImportingOf | undefined): Searched {
  const found = matched(index, question, tree);
  if ('refused' in found) return { answer: { query: found.query, refused: found.refused }, area: found.area };
  const { query, area, within, named, hits, answered, rest } = found;

  const counted: SearchArea | undefined =
    area === undefined
      ? undefined
      : { from: area.from, to: area.to, files: area.files.size, entries: area.entries, unresolved: area.unresolved.length };
  // A dependency is usable where the manifest that owns the location declares it. The closure
  // is what the location reaches, and a package another workspace declares is that workspace's
  // to offer, so ownership is asked of the paths the question started at and not of the closure.
  const thirdParty = root === undefined ? undefined : queryDependencyLexicon(root, query, area === undefined ? undefined : [...area.from, ...area.to]);
  const declared = declaredMatches(root, question.query, area?.files, ELSEWHERE_CAP);

  const answer: SearchAnswer = {
    query,
    ...(counted === undefined ? {} : { area: counted }),
    published: published(index, hits, CAP, importingOf),
    exported: { total: rest.total, shown: rest.head(ELSEWHERE_CAP) },
    ...(declared === undefined ? {} : { declared }),
    ...(thirdParty === undefined ? {} : { thirdParty }),
  };
  // The installed packages that describe the words are a different answer from
  // this repository's names, and never stand in for them: only an installed
  // name holding the query as written — which the caller asked for by name —
  // ends the search for names of this repository's own.
  if (hits.length > 0 || rest.total > 0 || (declared?.total ?? 0) > 0 || (thirdParty?.total ?? 0) > 0) return { answer, area };

  // The empty answer read as a description: names holding any of its words,
  // stemmed by the rule packages are.
  // A name its file keeps to itself is in no row: the source index answers for it.
  const declarations = describedDeclarations(root, query, area?.files) ?? [];
  const reached = describedNames(index, query, within, new Set([...named, ...answered]), shownRowOrder(index, area, within), declarations);
  const described = reached === undefined ? undefined : [...reached, ...declarations];
  // Which reading a name both reach is told by is decided by what each holds, never
  // by how many rows print. A name holding at least half the stems through one row
  // is the described section's, which prints first, and the loose pass offers none
  // of them a second time. A name holding fewer is the loose section's when every
  // word reaches it there, since every word one character off says more than under
  // half the stems do: held on so few, it would sort past the rows shown.
  const strong = Math.ceil(describedWordsNative(query).length / 2);
  const held = (one: Reached): boolean => one.words.length >= strong;

  // The loose pass — names the words reach when they are allowed apart and
  // allowed one character off — runs only on an empty answer. The names the
  // substring answered are kept out: a name the caller can already see must
  // not be offered back to them as something else. Whether a name is in the
  // answer is the dictionary's to say; where it sits is not.
  const claimed = new Set([...named, ...answered, ...(reached ?? []).filter(held).map(({ name }) => name)]);
  const viaDoc = new Map<number, Set<number>>();
  const loose = looseNames(index, query, FUZZY, within, claimed, viaDoc);
  const alsoHits = loose.size === 0 ? [] : surface(index, publishedOf(index, loose), area, within);
  const alsoFound = published(index, alsoHits, LOOSE_CAP, importingOf);
  const alsoRest = exported(index, loose, new Set(alsoHits.map((hit) => hit.name)), within, viaDoc);
  // A name its file keeps to itself is in no dictionary row: the source index
  // answers for it, by the same rule, after every name that is.
  const describedHere = new Set((described ?? []).flatMap((one) => ('match' in one && held(one) ? [declaredKey(one.match)] : [])));
  const kept = looseDeclarations(root, query, FUZZY, area?.files, describedHere) ?? [];
  const keptHere = new Set(kept.map(declaredKey));
  const left = described?.filter((one) => ('match' in one ? !keptHere.has(declaredKey(one.match)) : 'file' in one || !loose.has(one.name)));
  const told = described === undefined || left === undefined ? undefined : describedShown(index, query, left, DESCRIBED_CAP, described)
    .flatMap((one): DescribedMatch[] => {
      if ('match' in one) return [{ ...one.match, words: one.words }];
      if ('file' in one) return [{ ...fileMatch(root, one.file), words: one.words }];
      // The row it was weighed through is the row shown.
      const { through } = one;
      const row = through.kind === 'published'
        ? published(index, surface(index, [through.row], area, within), 1, importingOf).shown[0]
        : exported(index, [one.name], new Set(), within, new Map([[one.name, new Set([through.row])]])).head(1)[0];
      return row === undefined ? [] : [{ ...row, words: one.words }];
    });
  const reachedNames = [...alsoFound.shown, ...alsoRest.head(LOOSE_CAP - alsoFound.shown.length)];
  const shown = [...reachedNames, ...kept.slice(0, LOOSE_CAP - reachedNames.length)];
  const loosely: SearchAnswer = { ...answer, loose: { total: alsoFound.total + alsoRest.total + kept.length, shown } };
  if (left === undefined || told === undefined) return { answer: loosely, area };
  return { answer: { ...loosely, described: { total: left.length, shown: told } }, area };
}

/**
 * Names a query reaches through the words names are written in, ascending:
 * every word of the query is a word of the name, the start of one, or one that
 * shares its stem, so `select test files` is `selectTestFiles` and
 * `instrumenting` is `instrumentModule`. The stem is the dependency lexicon's,
 * admitted the way the described section admits it.
 */
function namesOfWords(index: SearchIndex, query: string): readonly number[] {
  const words = tokensOf(query);
  if (words.length === 0) return [];

  const stemmed = termsOfStems(index, wordStemsNative(words));
  let held: ReadonlySet<number> | undefined;
  for (const [position, word] of words.entries()) {
    const terms = new Set([...matchingTerms(index, word, 0), ...(stemmed[position] ?? [])]);
    const reached = new Set<number>();
    for (const term of terms) {
      for (const name of index.termNames(term)) if (held === undefined || held.has(name)) reached.add(name);
    }
    if (reached.size === 0) return [];
    held = reached;
  }
  return held === undefined ? [] : [...held];
}

/** Two lists of ids as one, ascending and without repeats. */
function ascending(left: readonly number[], right: readonly number[]): readonly number[] {
  if (right.length === 0) return left;
  return [...new Set([...left, ...right])].sort((a, b) => a - b);
}

/**
 * The names `search` answers with, as data.
 *
 * The same answer `variance ask search` prints, before it is written as text:
 * published names first, then the names the source exports without
 * publishing, then — only when both are empty — the names a looser reading
 * finds and the names that hold any of the words. Each published row shown is
 * counted by `importingOf` when it is given, as `uses` counts that name, and
 * the rows shown are ordered by that count.
 */
export function searchNames(index: SearchIndex, question: SearchQuestion, tree?: Tree, root?: string, importingOf?: ImportingOf): SearchAnswer {
  return searched(index, question, tree, root, importingOf).answer;
}
