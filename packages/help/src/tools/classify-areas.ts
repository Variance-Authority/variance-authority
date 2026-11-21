// compass: variance-authority.report.agent-surface

import { rarity } from '@variance-authority/mcp/tools';
import { describedWordsNative } from '@variance-authority/sense';

/**
 * The areas of a checkout a request's words point to.
 *
 * A request is written in the words people use for a change, and most of them
 * are no declared name. What they point to is a part of the tree: the area is a
 * directory of at most {@link AREA_FILES} tracked files, a larger one split
 * into its children, and its words are its path's, its files' names and the
 * names its files declare. Each of the request's stems counts by how few areas
 * hold it, through the shared {@link rarity}, saturated the way BM25 saturates
 * a term's count and in integers, so one request ranks the same on every run.
 */

/** The most tracked files one area holds: a directory holding more is read as its children. */
export const AREA_FILES = 500;

/** How many areas an answer ranks. */
export const AREAS_SHOWN = 10;

/** What the source index says the files declare. */
export interface Declared {
  /** For each stem, the files declaring a name that holds it, and how many such names each declares. */
  readonly holding: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** For each file, how many words the names it declares hold together. */
  readonly words: ReadonlyMap<string, number>;
}

/** One area the request's words point to. */
export interface RankedArea {
  /** The directory, repository-relative; `.` for the root. */
  readonly path: string;
  /** How many tracked files it holds. */
  readonly files: number;
  /** The request's words it holds, as the request wrote them, the one weighing most there first. */
  readonly words: readonly string[];
  readonly score: number;
}

/** How much a path's own words count against one file's name: its words name everything under it. */
const PATH_WEIGHT = 3;

/** One directory and what the request's stems count in it. */
interface Area {
  files: number;
  /** How many words it holds, the request's or not: BM25's document length. */
  length: number;
  readonly held: Map<string, number>;
}

/**
 * The areas of `paths`, every tracked file of a checkout, that `query`'s words
 * point to, best first and at most `shown`; ties in code-unit order of the
 * path. `declared` adds the names the files declare.
 */
export function rankedAreas(
  query: string,
  paths: readonly string[],
  declared: Declared,
  { most = AREA_FILES, shown = AREAS_SHOWN }: { readonly most?: number; readonly shown?: number } = {},
): readonly RankedArea[] {
  const asked = describedWordsNative(query) as readonly (readonly [string, string])[];
  if (asked.length === 0) return [];
  const stems = new Set(asked.map(([stem]) => stem));
  const stemsOf = memoizedStems(stems);
  const under = filesUnder(paths);
  const areas = new Map<string, Area>();
  const areaOf = (path: string): Area => {
    const directory = areaDirectory(path, under, most);
    let area = areas.get(directory);
    if (area === undefined) {
      area = { files: 0, length: 0, held: new Map() };
      for (const segment of directory.split('/')) {
        const cut = stemsOf(segment);
        area.length += cut.words * PATH_WEIGHT;
        for (const stem of cut.stems) count(area.held, stem, PATH_WEIGHT);
      }
      areas.set(directory, area);
    }
    return area;
  };
  const fileOf = new Map<string, Area>();
  for (const path of paths) {
    const area = areaOf(path);
    area.files += 1;
    fileOf.set(path, area);
    const cut = stemsOf(baseName(path));
    area.length += cut.words + (declared.words.get(path) ?? 0);
    for (const stem of cut.stems) count(area.held, stem, 1);
  }
  for (const [stem, files] of declared.holding) {
    if (!stems.has(stem)) continue;
    for (const [file, names] of files) {
      const area = fileOf.get(file);
      if (area !== undefined) count(area.held, stem, names);
    }
  }
  const holders = new Map<string, number>();
  for (const area of areas.values()) for (const stem of area.held.keys()) count(holders, stem, 1);
  const population = areas.size;
  let length = 0;
  for (const area of areas.values()) length += area.length;
  const ranked: RankedArea[] = [];
  for (const [directory, area] of areas) {
    if (area.held.size === 0) continue;
    // BM25's length norm: 0.25 + 0.75 × the area's words / the mean area's words.
    const norm = 250 + Math.floor((750 * area.length * population) / Math.max(1, length));
    const weighs = new Map<string, number>();
    for (const [stem, held] of area.held) {
      weighs.set(stem, Math.floor((rarity(population, holders.get(stem) ?? 0) * held * 2200) / (held * 1000 + Math.floor((1200 * norm) / 1000))));
    }
    let score = 0;
    for (const weight of weighs.values()) score += weight;
    ranked.push({
      path: directory === '' ? '.' : directory,
      files: area.files,
      // `asked` is in stem order, and the sort is stable, so equal weights keep it.
      words: asked.filter(([stem]) => weighs.has(stem)).sort(([one], [other]) => (weighs.get(other) ?? 0) - (weighs.get(one) ?? 0)).map(([, word]) => word),
      score,
    });
  }
  return ranked.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, shown);
}

function count(counts: Map<string, number>, key: string, by: number): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

/** How many of `paths` each directory holds, at any depth; the root is `''`. */
function filesUnder(paths: readonly string[]): Map<string, number> {
  const under = new Map<string, number>();
  for (const path of paths) {
    count(under, '', 1);
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) count(under, path.slice(0, at), 1);
  }
  return under;
}

/** The outermost directory over `path` holding at most `most` files, or the file's own directory when none does. */
function areaDirectory(path: string, under: ReadonlyMap<string, number>, most: number): string {
  if ((under.get('') ?? 0) <= most) return '';
  let at = path.indexOf('/');
  for (; at !== -1; at = path.indexOf('/', at + 1)) {
    if ((under.get(path.slice(0, at)) ?? 0) <= most) return path.slice(0, at);
  }
  const last = path.lastIndexOf('/');
  return last === -1 ? '' : path.slice(0, last);
}

/** A file's name without its directory and its last extension. */
function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** What one path segment holds: the asked stems among its words, and how many words it holds. */
interface Cut {
  readonly stems: readonly string[];
  readonly words: number;
}

/** The {@link Cut} of a path segment, cut once per distinct segment. */
function memoizedStems(asked: ReadonlySet<string>): (segment: string) => Cut {
  const cuts = new Map<string, Cut>();
  return (segment) => {
    let cut = cuts.get(segment);
    if (cut === undefined) {
      const words = describedWordsNative(segment) as readonly (readonly [string, string])[];
      cut = { stems: words.map(([stem]) => stem).filter((stem) => asked.has(stem)), words: words.length };
      cuts.set(segment, cut);
    }
    return cut;
  };
}
