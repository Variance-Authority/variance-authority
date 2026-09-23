import type { Tree } from '@variance-authority/mcp/tools';
import { opening } from '@variance-authority/package/help';
import type { SearchIndex } from '../search-index.js';
import type { Area } from './area.js';
import { areaOf } from './area.js';
import { looseNames } from './loose.js';

/**
 * What `search` found, before a word of it is written.
 *
 * The text answer is one rendering of this and `--format json` is the other,
 * so the two cannot disagree about a count or a row: both read the same value.
 * What was not determined is absent, never empty. A start point that did not
 * resolve carries `refused` and no sections, because nothing was searched; the
 * loose section is absent when the substring answered, because it was not run,
 * and present with a total of zero when it ran and found nothing.
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

/** How wrong a word may be and still be looked up: one character, capped in `loose.ts`. */
const FUZZY = 0.2;

/** What a question to `search` says. */
export interface SearchQuestion {
  /** A substring of a name or its documentation, matched case-insensitively. */
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
}

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
 * Sections are present when they ran. `loose` runs only when `published` and
 * `exported` are both empty, and none of the three runs when `refused` is set.
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
  /** Present only when both sections above are empty, which is when it runs. */
  readonly loose?: Matches<PublishedMatch | ExportedMatch>;
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

/** The first `count` of `items` under `before`, a total order, without sorting the rest. */
function first<T>(items: readonly T[], count: number, before: (a: T, b: T) => number): T[] {
  const best: T[] = [];
  if (count <= 0) return best;
  for (const item of items) {
    const last = best[best.length - 1];
    if (best.length === count && last !== undefined && before(item, last) >= 0) continue;
    let low = 0;
    let high = best.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (before(best[middle] as T, item) <= 0) low = middle + 1;
      else high = middle;
    }
    best.splice(low, 0, item);
    if (best.length > count) best.pop();
  }
  return best;
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
 * Exported names given by id, nearest thing to a ranking.
 *
 * Grouped by name because one name exported from a barrel and from the file that
 * declares it is one thing to go and look at, and ordered by how many files
 * export it — which is the only count this half has. Source before tests and
 * stories within a name, so the place shown first is the implementation rather
 * than something exercising it.
 */
function exported(
  index: SearchIndex,
  names: Iterable<number>,
  shown: ReadonlySet<number>,
  within: ReadonlySet<number> | undefined,
): { readonly total: number; head(count: number): readonly ExportedMatch[] } {
  const found: { name: number; rank: number; count: number }[] = [];
  // The file that exports it, against the closure. A name exported from a
  // barrel inside the area and declared outside it arrives here twice, under
  // two paths, and the one in the area is the one a reader can open.
  const rowsOf = (name: number): readonly number[] => {
    const all = index.exportedOf(name);
    return within === undefined ? [...all] : [...all].filter((row) => within.has(index.exportedFile(row)));
  };

  for (const name of names) {
    if (shown.has(name)) continue;
    const count = within === undefined ? index.exportedOf(name).length : rowsOf(name).length;
    if (count > 0) found.push({ name, rank: index.rank(name), count });
  }

  return {
    total: found.length,
    head: (count) =>
      first(found, count, (a, b) => b.count - a.count || a.rank - b.rank).flatMap(({ name, count: files }) => {
        // Source before tests before stories, and the first written within a
        // kind: the kind column orders the rows, and only the one shown is read.
        // `count` is the number of these rows, so one is always chosen.
        let chosen: number | undefined;
        for (const row of rowsOf(name)) {
          if (chosen === undefined || index.exportedKind(row) < index.exportedKind(chosen)) chosen = row;
          if (index.exportedKind(chosen) === 0) break;
        }
        if (chosen === undefined) return [];
        const row = index.exported(chosen);
        const match: ExportedMatch = {
          source: 'exported',
          name: row.name,
          ...(row.by === '' ? {} : { package: row.by }),
          at: row.at,
          line: row.line,
          files,
        };
        return [match];
      }),
  };
}

/** The search over an opened index, and the area the text answer names. */
export function searched(index: SearchIndex, question: SearchQuestion, tree?: Tree): Searched {
  const query = question.query.toLowerCase();
  const area =
    question.from === undefined && question.to === undefined ? undefined : areaOf(question.from, question.to, tree);

  // A start point that could not be resolved is refused whole. Answering the
  // unscoped question instead would hand back four hundred names under a
  // header the caller has every reason to read as *in your area*.
  if (area?.refused !== undefined) return { answer: { query, refused: area.refused }, area };

  const counted: SearchArea | undefined =
    area === undefined
      ? undefined
      : { from: area.from, to: area.to, files: area.files.size, entries: area.entries, unresolved: area.unresolved.length };
  const within = area === undefined ? undefined : index.fileIds(area.files);

  const named = index.namesContaining(query);
  const hits = surface(index, [...publishedOf(index, named), ...index.docsContaining(query)], area, within);
  const answered = new Set(hits.map((hit) => hit.name));
  const rest = exported(index, named, answered, within);

  const answer: SearchAnswer = {
    query,
    ...(counted === undefined ? {} : { area: counted }),
    published: published(index, hits, CAP),
    exported: { total: rest.total, shown: rest.head(ELSEWHERE_CAP) },
  };
  if (hits.length > 0 || rest.total > 0) return { answer, area };

  // The loose pass — names the words reach when they are allowed apart and
  // allowed one character off — runs only on an empty answer. The names the
  // substring answered are kept out: a name the caller can already see must
  // not be offered back to them as something else. Whether a name is in the
  // answer is the dictionary's to say; where it sits is not.
  const loose = looseNames(index, query, FUZZY, within, new Set([...named, ...answered]));
  const alsoHits = loose.size === 0 ? [] : surface(index, publishedOf(index, loose), area, within);
  const alsoFound = published(index, alsoHits, LOOSE_CAP);
  const alsoRest = exported(index, loose, new Set(alsoHits.map((hit) => hit.name)), within);
  const shown = [...alsoFound.shown, ...alsoRest.head(LOOSE_CAP - alsoFound.shown.length)];
  return { answer: { ...answer, loose: { total: alsoFound.total + alsoRest.total, shown } }, area };
}

/**
 * The names `search` answers with, as data.
 *
 * The same answer `variance ask search` prints, before it is written as text:
 * published names first, then the names the source exports without
 * publishing, then — only when both are empty — the names a looser reading
 * finds.
 */
export function searchNames(index: SearchIndex, question: SearchQuestion, tree?: Tree): SearchAnswer {
  return searched(index, question, tree).answer;
}
