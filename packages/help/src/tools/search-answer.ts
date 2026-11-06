import type { Tree } from '@variance-authority/mcp/tools';
import { describedWordsNative, wordStemsNative } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { tokensOf } from '../search-index.js';
import type { Area } from './area.js';
import { areaOf } from './area.js';
import { looseNames, matchingTerms, rowWithin, termsOfStems } from './loose.js';
import { carriedThrough, carriesMost } from './carried.js';
import { countedOf, describedDeclarations, describedNames, describedShown, fileMatch, rowTextOrder, type RowOrder } from './described.js';
import { declaredKey, looseDeclarations } from './loose-declared.js';
import { queryDependencyLexicon } from '../dependency-lexicon.js';
import { aliasMatches, declaredMatches, declaredTold, exactness } from './declared.js';
import { saidFor, type Said } from './held-sentence.js';
import { membersUnreadOf } from './members.js';
import { docRows, exported, exportedOrder, first } from './exported-matches.js';
import { counting, type ImportingOf, type InArea, type PublishedMatch } from './published-match.js';
import type { DescribedMatch, Matches, SearchAnswer, SearchArea, Searched, SearchQuestion } from './search-matches.js';
import { docsSaying } from './phrase.js';

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
function published(index: SearchIndex, hits: readonly Hit[], count: number, said: Said, importingOf?: ImportingOf): Matches<PublishedMatch> {
  const order = surfaceOrder(index);
  const page = first(hits, count, order).map((hit) => {
    const entry = index.published(hit.row);
    const one = importingOf?.(entry.name, entry.at, entry.specifier);
    // With the imports within its package unread, no place found proves nothing: the row keeps the counts by published path.
    const importedIn = one === undefined || (one.unread !== undefined && one.importing.places === 0) ? undefined : one.importing;
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
      ...(entry.doc === undefined ? {} : { summary: said(entry.doc) }),
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
  const said = saidFor(query);
  const area =
    question.from === undefined && question.to === undefined ? undefined : areaOf(question.from, question.to, tree);
  // A start point that could not be resolved is refused whole. Answering the
  // unscoped question instead would hand back four hundred names under a
  // header the caller has every reason to read as *in your area*.
  if (area?.refused !== undefined) return { query, area, refused: area.refused } as const;

  const within = area === undefined ? undefined : index.fileIds(area.files);
  const named = ascending(index.namesContaining(query), namesOfWords(index, query));
  const byName = new Set(named);
  const saying = docsSaying(index, query);
  // The name that is the question is the thing asked for, however few import
  // it: as written first, then the same word in another case.
  const exact = new Map<number, number>();
  for (const name of named) {
    const tier = exactness(index.name(name), question.query);
    if (tier !== undefined) exact.set(name, tier);
  }
  const field = (row: number, name: number): number => exact.get(name) ?? (byName.has(name) ? 2 : saying.published.openings.has(row) ? 3 : 4);
  const hits = surface(index, [...publishedOf(index, named), ...saying.published.rows], area, within, field);
  const answered = new Set(hits.map((hit) => hit.name));
  // An exported row is reached by its doc as a published one is, and inside an
  // area only through a row whose file is in it.
  const through = docRows(index, saying.exported.rows, within, byName);
  const rest = exported(index, ascending(named, [...through.keys()]), answered, within, said, through, saying.exported.openings, exact);
  return { query, said, area, within, named, hits, answered, rest } as const;
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
export function searched(index: SearchIndex, question: SearchQuestion, tree?: Tree, root?: string, importingOf?: ImportingOf, since?: number): Searched {
  const count = importingOf === undefined ? undefined : counting(importingOf);
  const found = searchedBy(index, question, tree, root, count?.of, since);
  if (count === undefined) return found;
  const unread = count.unread();
  return { ...found, publishing: count.publishing(), ...(unread === undefined ? {} : { answer: { ...found.answer, importsUnread: unread } }) };
}

function searchedBy(index: SearchIndex, question: SearchQuestion, tree: Tree | undefined, root: string | undefined, importingOf: ImportingOf | undefined, since: number | undefined): Searched {
  const found = matched(index, question, tree);
  if ('refused' in found) return { answer: { query: found.query, refused: found.refused }, area: found.area };
  const { query, said, area, within, named, hits, answered, rest } = found;

  const counted: SearchArea | undefined =
    area === undefined
      ? undefined
      : { from: area.from, to: area.to, files: area.files.size, entries: area.entries, unresolved: area.unresolved.length };
  // A dependency is usable where the manifest that owns the location declares it. The closure
  // is what the location reaches, and a package another workspace declares is that workspace's
  // to offer, so ownership is asked of the paths the question started at and not of the closure.
  const thirdParty = root === undefined ? undefined : queryDependencyLexicon(root, query, area === undefined ? undefined : [...area.from, ...area.to]);
  const told = declaredTold(root, said, since);
  const read = declaredMatches(root, question.query, area?.files, ELSEWHERE_CAP, told);
  const declared = read?.declared;
  const aliases = aliasMatches(root, question.query, area?.files);
  const others = hits.length > 0 || rest.total > 0 || (declared?.total ?? 0) > 0 || (thirdParty?.total ?? 0) > 0;
  // A row that holds the words adds nothing to an answer; the row that is the question does.
  const inside = read === undefined ? undefined : others ? read.held.slice(0, read.exact) : read.held;

  const answer: SearchAnswer = {
    query,
    ...(counted === undefined ? {} : { area: counted }),
    published: published(index, hits, CAP, said, importingOf),
    exported: { total: rest.total, shown: rest.head(ELSEWHERE_CAP) },
    ...(declared === undefined ? {} : { declared }),
    ...(inside === undefined ? {} : { held: { total: inside.length, shown: inside.slice(0, ELSEWHERE_CAP) } }),
    ...(read === undefined ? {} : { tests: read.tests }),
    ...(aliases === undefined ? {} : { aliases: { total: aliases.length, shown: aliases.slice(0, ELSEWHERE_CAP) } }),
    ...(thirdParty === undefined ? {} : { thirdParty }),
  };
  // Installed packages that describe the words never stand in for this repository's
  // names: only an installed name holding the query as written ends the search.
  // A held row ends it only by being the question: one that holds the words prints
  // beside the readings below, which may hold the name that was meant, and so does
  // a test block: a title is no name.
  if (others || (read?.exact ?? 0) > 0 || (aliases?.length ?? 0) > 0) return { answer, area };

  // The empty answer read as a description: names holding any of its words,
  // stemmed by the rule packages are.
  // A name its file keeps to itself is in no row: the source index answers for it.
  const declarations = describedDeclarations(root, query, area?.files) ?? [];
  const already = new Set([...named, ...answered]);
  const reached = describedNames(index, query, within, already, shownRowOrder(index, area, within), declarations);
  const described = reached === undefined ? undefined : [...reached, ...declarations];
  // Only what carries most of the question answers it, and a name carrying it is
  // the described section's, which prints first: the loose pass offers none of
  // them a second time. What holds less is the loose section's when every word
  // reaches it there, and otherwise nobody's.
  const asked = describedWordsNative(query).map(([, word]) => word);
  // An area narrows what is shown, not what a word weighs: a row carrying the
  // question everywhere carries it here.
  const everyDeclaration = area === undefined ? declarations : describedDeclarations(root, query, undefined) ?? [];
  const everywhere = area === undefined
    ? described
    : [...(describedNames(index, query, undefined, already, shownRowOrder(index, undefined, undefined), everyDeclaration) ?? []), ...everyDeclaration];
  const carries = carriesMost(asked, (everywhere ?? []).map(countedOf), index.nameCount);
  // Each of a name's rows is asked, not only the row the ranking would show.
  const carried = described?.flatMap((one) => carriedThrough(one, carries) ?? []);

  // The loose pass — names the words reach when they are allowed apart and
  // allowed one character off — runs only on an empty answer. The names the
  // substring answered are kept out: a name the caller can already see must
  // not be offered back to them as something else. Whether a name is in the
  // answer is the dictionary's to say; where it sits is not.
  const claimed = new Set([...named, ...answered, ...(carried ?? []).flatMap((one) => ('tied' in one ? [one.name] : []))]);
  const viaDoc = new Map<number, Set<number>>();
  const loose = looseNames(index, query, FUZZY, within, claimed, viaDoc);
  const alsoHits = loose.size === 0 ? [] : surface(index, publishedOf(index, loose), area, within);
  const alsoFound = published(index, alsoHits, LOOSE_CAP, said, importingOf);
  const alsoRest = exported(index, loose, new Set(alsoHits.map((hit) => hit.name)), within, said, viaDoc);
  // A name its file keeps to itself is in no dictionary row: the source index
  // answers for it, by the same rule, after every name that is.
  const describedHere = new Set((carried ?? []).flatMap((one) => ('match' in one ? [declaredKey(one.match)] : [])));
  const kept = looseDeclarations(root, query, FUZZY, area?.files, describedHere) ?? [];
  const heldRows = described === undefined || carried === undefined ? undefined : describedShown(index, query, carried, DESCRIBED_CAP, described)
    .flatMap((one): DescribedMatch[] => {
      if ('match' in one) return [{ ...told(one.match), words: one.words }];
      if ('file' in one) return [{ ...fileMatch(root, one.file, since, said), words: one.words }];
      // The row it was weighed through is the row shown.
      const { through } = one;
      const row = through.kind === 'published'
        ? published(index, surface(index, [through.row], area, within), 1, said, importingOf).shown[0]
        : exported(index, [one.name], new Set(), within, said, new Map([[one.name, new Set([through.row])]])).head(1)[0];
      return row === undefined ? [] : [{ ...row, words: one.words }];
    });
  const reachedNames = [...alsoFound.shown, ...alsoRest.head(LOOSE_CAP - alsoFound.shown.length)];
  const shown = [...reachedNames, ...kept.slice(0, LOOSE_CAP - reachedNames.length).map(told)];
  const membersUnread = root === undefined || (inside?.length ?? 0) > 0 ? [] : membersUnreadOf(root, question.query);
  const loosely: SearchAnswer = { ...answer, ...(membersUnread.length === 0 ? {} : { membersUnread }), loose: { total: alsoFound.total + alsoRest.total + kept.length, shown } };
  if (carried === undefined || heldRows === undefined) return { answer: loosely, area };
  return { answer: { ...loosely, described: { total: carried.length, shown: heldRows } }, area };
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
