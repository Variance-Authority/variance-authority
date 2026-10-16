import type { Tree } from '@variance-authority/mcp/tools';
import { opening } from '@variance-authority/package/help';
import type { SearchIndex } from '../search-index.js';
import { tokensOf } from '../search-index.js';
import type { Area } from './area.js';
import { areaOf } from './area.js';
import { looseNames, matchingTerms } from './loose.js';
import { describedDeclarations, describedNames, describedOrder } from './described.js';
import { queryDependencyLexicon, type LexiconMatches } from '../dependency-lexicon.js';
import { declaredMatches } from './declared.js';
import { memberMatches } from './members.js';
import { docRows, exported, first } from './exported-matches.js';

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

/** How one published name is used inside the area. */
export interface InArea {
  readonly files: number;
  readonly imports: number;
  /** `[hops, files]`, nearest first: how many importing files sit at each distance. */
  readonly filesByDistance: readonly (readonly [number, number])[];
}

/** A name a manifest publishes. */
export interface PublishedMatch {
  readonly source: 'published';
  readonly name: string;
  /** What to import it from. */
  readonly specifier: string;
  readonly kind: string;
  /**
   * The first paragraph of its documentation, on one line; absent when nothing
   * documents it. The whole comment is `symbol`'s answer, not this one's: forty
   * of them would cost more than every other field here together.
   */
  readonly summary?: string;
  /** The file that declares it. */
  readonly at: string;
  /** Packages that import it, across the repository. */
  readonly packages: number;
  /** Import sites, across the repository. */
  readonly imports: number;
  /** Absent when no start point was said. */
  readonly inArea?: InArea;
}

/** A name the source exports without publishing. */
export interface ExportedMatch {
  readonly source: 'exported';
  readonly name: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  /** The file shown: source before tests before stories. */
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

/**
 * A member a file declares: a property or method of an interface, a type
 * literal or a class, a field of a Rust struct or a variant of a Rust enum.
 */
export interface MemberMatch {
  readonly source: 'member';
  readonly name: string;
  /** The container it is on: `Props`, `Shape`, `Shape::Square`, or `a type literal` or `a class` when it has no name. */
  readonly on: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  readonly at: string;
  readonly line: number;
}

/** A name of this repository a description reached, and which of its words it holds. */
export type DescribedMatch = (PublishedMatch | ExportedMatch | DeclaredMatch) & {
  /** The question's words the name or its documentation holds, as the question wrote them. */
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
   * Members whose names hold the query, read off the source index; `uses`
   * answers who reads and writes one. Absent when no checkout was named or its
   * index could not be read.
   */
  readonly members?: Matches<MemberMatch>;
  /** Present only when the exact sections are empty, which is when it runs. */
  readonly loose?: Matches<PublishedMatch | ExportedMatch>;
  /**
   * This repository's names holding at least half of the question's words.
   * `loose` holds none of them. Present when `loose` ran, which is when it runs;
   * absent too when the question has no word to describe it by.
   */
  readonly described?: Matches<DescribedMatch>;
  /** Installed third-party names available to this workspace or area. */
  readonly thirdParty?: LexiconMatches;
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
 * The last key is the row, which is the order `everyEntry` walks, so ties land
 * where the stable sort over that walk always put them.
 *
 * The area enters here rather than at the call sites for the same reason: it
 * decides both what is admitted and how what is admitted is ordered, and a
 * second pass that applied only one of the two would answer a scoped question
 * with an unscoped ranking.
 */
function surface(
  index: SearchIndex,
  rows: Iterable<number>,
  area: Area | undefined,
  inArea: ReadonlySet<number> | undefined,
): readonly Hit[] {
  const hits: Hit[] = [];
  for (const row of new Set(rows)) {
    const scoped = area === undefined || inArea === undefined ? undefined : usedWithin(index, row, area, inArea);
    // A published name with no import site in the closure is a name the area
    // does not use, however well it matches the word.
    if (scoped !== undefined && scoped.imports === 0) continue;
    const name = index.publishedName(row);
    hits.push({ row, name, rank: index.rank(name), usedBy: index.usedBy(row), uses: index.uses(row), scoped });
  }
  return hits;
}

const surfaceOrder = (a: Hit, b: Hit): number =>
  (b.scoped?.files ?? 0) - (a.scoped?.files ?? 0) ||
  (b.scoped?.imports ?? 0) - (a.scoped?.imports ?? 0) ||
  b.usedBy - a.usedBy ||
  b.uses - a.uses ||
  a.rank - b.rank ||
  a.row - b.row;

function published(index: SearchIndex, hits: readonly Hit[], count: number): Matches<PublishedMatch> {
  return {
    total: hits.length,
    shown: first(hits, count, surfaceOrder).map((hit) => {
      const entry = index.published(hit.row);
      return {
        source: 'published',
        name: entry.name,
        specifier: entry.specifier,
        kind: entry.kind,
        ...(entry.doc === undefined ? {} : { summary: opening(entry.doc) }),
        at: entry.at,
        packages: entry.usedBy.length,
        imports: entry.uses,
        ...(hit.scoped === undefined ? {} : { inArea: hit.scoped }),
      };
    }),
  };
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
  const hits = surface(index, [...publishedOf(index, named), ...index.docsContaining(query)], area, within);
  const answered = new Set(hits.map((hit) => hit.name));
  // An exported row is reached by its doc as a published one is, and inside an
  // area only through a row whose file is in it.
  const through = docRows(index, index.exportedDocsContaining(query), within, new Set(named));
  const rest = exported(index, ascending(named, [...through.keys()]), answered, within, through);
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

/** The search over an opened index, and the area the text answer names. */
export function searched(index: SearchIndex, question: SearchQuestion, tree?: Tree, root?: string): Searched {
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
  const declared = declaredMatches(root, query, area?.files, ELSEWHERE_CAP);
  const members = memberMatches(root, query, area?.files, ELSEWHERE_CAP);

  const answer: SearchAnswer = {
    query,
    ...(counted === undefined ? {} : { area: counted }),
    published: published(index, hits, CAP),
    exported: { total: rest.total, shown: rest.head(ELSEWHERE_CAP) },
    ...(declared === undefined ? {} : { declared }),
    ...(members === undefined ? {} : { members }),
    ...(thirdParty === undefined ? {} : { thirdParty }),
  };
  // The installed packages that describe the words are a different answer from
  // this repository's names, and never stand in for them: only an installed
  // name holding the query as written — which the caller asked for by name —
  // ends the search for names of this repository's own.
  if (hits.length > 0 || rest.total > 0 || (declared?.total ?? 0) > 0 || (members?.total ?? 0) > 0 || (thirdParty?.total ?? 0) > 0) return { answer, area };

  // The empty answer read as a description: names holding half of its words,
  // stemmed by the rule packages are. It prints first, so it claims its names
  // first, and the loose pass offers none of them a second time.
  // A name its file keeps to itself is in no row: the source index answers for it.
  const reached = describedNames(index, query, within, new Set([...named, ...answered]));
  const described = reached === undefined ? undefined : [...reached, ...(describedDeclarations(root, query, area?.files) ?? [])];
  const told = described === undefined ? undefined : first(described, DESCRIBED_CAP, describedOrder)
    .flatMap((held): DescribedMatch[] => {
      if ('match' in held) return [{ ...held.match, words: held.words }];
      const row = published(index, surface(index, index.publishedOf(held.name), area, within), 1).shown[0] ??
        exported(index, [held.name], new Set(), within, held.through === undefined ? undefined : new Map([[held.name, new Set([held.through])]])).head(1)[0];
      return row === undefined ? [] : [{ ...row, words: held.words }];
    });

  // The loose pass — names the words reach when they are allowed apart and
  // allowed one character off — runs only on an empty answer. The names the
  // substring answered are kept out: a name the caller can already see must
  // not be offered back to them as something else. Whether a name is in the
  // answer is the dictionary's to say; where it sits is not.
  const claimed = new Set([...named, ...answered, ...(reached ?? []).map(({ name }) => name)]);
  const viaDoc = new Map<number, Set<number>>();
  const loose = looseNames(index, query, FUZZY, within, claimed, viaDoc);
  const alsoHits = loose.size === 0 ? [] : surface(index, publishedOf(index, loose), area, within);
  const alsoFound = published(index, alsoHits, LOOSE_CAP);
  const alsoRest = exported(index, loose, new Set(alsoHits.map((hit) => hit.name)), within, viaDoc);
  const shown = [...alsoFound.shown, ...alsoRest.head(LOOSE_CAP - alsoFound.shown.length)];
  const loosely: SearchAnswer = { ...answer, loose: { total: alsoFound.total + alsoRest.total, shown } };
  if (described === undefined || told === undefined) return { answer: loosely, area };
  return { answer: { ...loosely, described: { total: described.length, shown: told } }, area };
}

/**
 * Names a query of several words reaches through the words names are written
 * in, ascending: every word of the query is a word of the name or the start of
 * one, so `select test files` is `selectTestFiles`. A query of one word is the
 * substring's alone.
 */
function namesOfWords(index: SearchIndex, query: string): readonly number[] {
  const words = tokensOf(query);
  if (words.length < 2) return [];

  let held: ReadonlySet<number> | undefined;
  for (const word of words) {
    const reached = new Set<number>();
    for (const term of matchingTerms(index, word, 0)) {
      for (const name of index.termNames(term)) if (held === undefined || held.has(name)) reached.add(name);
    }
    if (reached.size === 0) return [];
    held = reached;
  }
  return [...(held ?? [])];
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
 * finds and the names that hold half of the words.
 */
export function searchNames(index: SearchIndex, question: SearchQuestion, tree?: Tree, root?: string): SearchAnswer {
  return searched(index, question, tree, root).answer;
}
