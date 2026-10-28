import type { SearchAnswer } from './search-answer.js';
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
  /**
   * Packages other than its own that import it by a specifier it is published
   * from: the order the index picks the rows shown by. The rows shown sort on
   * {@link importedIn} when it is counted.
   */
  readonly otherPackages: number;
  /** The imports those packages write by such a specifier. */
  readonly otherImports: number;
  /** Absent when no start point was said. */
  readonly inArea?: InArea;
}

/** {@link ImportingOf}, and the first reason it gave that imports within a package were not read. */
export interface Counting {
  readonly of: ImportingOf;
  readonly unread: () => string | undefined;
}

/** `importingOf`, keeping the first reason it gives for imports it did not read: an answer says it once, as `uses` does. */
export function counting(importingOf: ImportingOf): Counting {
  let unread: string | undefined;
  return {
    of: (name, at) => {
      const one = importingOf(name, at);
      unread ??= one.unread;
      return one;
    },
    unread: () => unread,
  };
}

/**
 * Whether `answer` shows a row a search counts: a published row in a section
 * that shows one. Only then is the value those counts are read from worth
 * opening.
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
