import type { DescribedMatch, ExportedMatch, DeclaredMatch, SearchAnswer } from './search-answer.js';
import type { Help } from '@variance-authority/package/help';
import { type ImportedIn, importingIn } from './uses-count.js';
import { publishedSitesOf } from './uses-of.js';

// compass: variance-authority.report.agent-surface

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
  /**
   * The places that import it and the packages they sit in, as `uses` counts
   * them for its name and its file. Absent when the answer was given without
   * the Help value those are read from.
   */
  readonly importedIn?: ImportedIn;
  /** Packages other than its own that import it by a specifier it is published from: the order rows sort on. */
  readonly otherPackages: number;
  /** The imports those packages write by such a specifier. */
  readonly otherImports: number;
  /** Absent when no start point was said. */
  readonly inArea?: InArea;
}

/**
 * The answer with each published row it shows counted as `uses` counts it, in
 * every section that shows one; unchanged when there is nothing to count it
 * with. Only the rows shown are counted, never every row a question matched.
 */
export function withImporting(answer: SearchAnswer, importingOf: ImportingOf | undefined): SearchAnswer {
  if (importingOf === undefined) return answer;
  let unread: string | undefined;
  const counted = <T extends PublishedMatch | ExportedMatch | DeclaredMatch | DescribedMatch>(match: T): T => {
    if (match.source !== 'published') return match;
    const one = importingOf(match.name, match.at);
    unread ??= one.unread;
    return { ...match, importedIn: one.importing };
  };
  const { published, loose, described } = answer;
  const shown = {
    ...(published === undefined ? {} : { published: { ...published, shown: published.shown.map(counted) } }),
    ...(loose === undefined ? {} : { loose: { ...loose, shown: loose.shown.map(counted) } }),
    ...(described === undefined ? {} : { described: { ...described, shown: described.shown.map(counted) } }),
  };
  return { ...answer, ...shown, ...(unread === undefined ? {} : { importsUnread: unread }) };
}

/**
 * Whether `answer` shows a row {@link withImporting} would count: a published
 * row in a section it counts. Only then is the value those counts are read
 * from worth opening.
 */
export function showsPublished(answer: SearchAnswer): boolean {
  const { published, loose, described } = answer;
  return [published?.shown, loose?.shown, described?.shown].some((shown) => shown?.some((match) => match.source === 'published') === true);
}

/** What imports one published declaration, and why the imports within its package were not read, when they were not. */
export interface ImportingOne {
  readonly importing: ImportedIn;
  readonly unread?: string;
}

/** The count for the published declaration of `name` in the file `at`. */
export type ImportingOf = (name: string, at: string) => ImportingOne;

/**
 * The count `uses` gives for a published declaration when asked for its name
 * and its file, read for each declaration the first time it is asked for: a
 * question reads it for the rows it shows, not for every name it holds.
 */
export function importingOf(help: Help, root: string | undefined): ImportingOf {
  const read = new Map<string, ImportingOne>();
  return (name, at) => {
    const key = `${at}\0${name}`;
    let one = read.get(key);
    if (one === undefined) {
      const { sites, unread } = publishedSitesOf(help, root, name, at);
      read.set(key, (one = { importing: importingIn(sites), ...(unread === undefined ? {} : { unread }) }));
    }
    return one;
  };
}
