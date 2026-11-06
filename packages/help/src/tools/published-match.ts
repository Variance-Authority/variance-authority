import type { SearchAnswer } from './search-matches.js';
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
   * The sentence of its documentation holding most of the question, or its
   * first paragraph when none holds a word of it, on one line; absent when
   * nothing documents it. The whole comment is `symbol`'s answer, not this one's: forty
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

/** {@link ImportingOf}, the first reason it gave that imports within a package were not read, and the files that publish what it counted. */
export interface Counting {
  readonly of: ImportingOf;
  readonly unread: () => string | undefined;
  readonly publishing: () => ReadonlySet<string>;
}

/** `importingOf`, keeping the first reason it gives for imports it did not read: an answer says it once, as `uses` does. */
export function counting(importingOf: ImportingOf): Counting {
  let unread: string | undefined;
  const publishing = new Set<string>();
  return {
    of: (name, at, specifier) => {
      const one = importingOf(name, at, specifier);
      unread ??= one.unread;
      for (const file of one.publishing) publishing.add(file);
      return one;
    },
    unread: () => unread,
    publishing: () => publishing,
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
  /** The entries and barrels that publish it, which the walk that counts it finds. */
  readonly publishing: readonly string[];
}

/** The count for the published declaration of `name` in the file `at`. */
export type ImportingOf = (name: string, at: string, specifier: string) => ImportingOne;

/**
 * The count `uses` gives for a published declaration when asked for its name
 * and its file, read for each declaration the first time it is asked for: a
 * question reads it for the rows it shows, not for every name it holds.
 */
export function importingOf(help: Help, root: string | undefined): ImportingOf {
  const read = new Map<string, ImportingOne>();
  return (name, at, specifier) => {
    const key = `${specifier}\0${name}`;
    let one = read.get(key);
    if (one === undefined) {
      const { sites, unread, publishing } = publishedSitesOf(help, root, name, at, specifier);
      read.set(key, (one = { importing: importingIn(sites), publishing, ...(unread === undefined ? {} : { unread }) }));
    }
    return one;
  };
}
