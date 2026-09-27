/**
 * What the native scanner's orientation calls take and answer: the packages a
 * handful of files belong to, the names that pass between those packages and
 * every other one, and the recorded cases that ran each file.
 *
 * Declared apart from `native.ts` for the reason `native-journey.ts` is: the
 * scanner's contract is long, and each family of calls is read on its own.
 * `native/src/package_graph.rs` and `native/src/journey_query.rs` say how the
 * numbers are made.
 */

/**
 * One name another package takes. Its share is of every use the package
 * exporting it gets from outside, so it says what part of that package the
 * name is, whichever side it is printed on.
 */
export interface NativeOrientShare {
  readonly name: string;
  readonly share: number;
}

/** One other package on one side of an asked package, largest share first. */
export interface NativeOrientFlow {
  /** The other package; absent for files no named manifest sits above. */
  readonly package?: string | null;
  readonly directory?: string | null;
  /** Of the side's uses. */
  readonly share: number;
  readonly names: readonly NativeOrientShare[];
  /** Names past the limit. */
  readonly moreNames: number;
}

/** One side of an asked package: what it takes, or what is taken from it. */
export interface NativeOrientFlows {
  readonly rows: readonly NativeOrientFlow[];
  /** Packages past the limit, and their share together. */
  readonly more: number;
  readonly moreShare: number;
  /** One unit is one file importing one name across the package's edge. */
  readonly units: number;
  /** Importing files on this side whose parse the index does not hold, so their names are in no total. */
  readonly unread: number;
}

/** One package an asked file is in: what it imports from other packages, and what they import from it. */
export interface NativeOrientPackage {
  readonly package: string;
  /** The manifest's directory from the root; empty for the root's own manifest. */
  readonly directory: string;
  /** How many of its files the index holds a record for; with none, neither side was read. */
  readonly indexed: number;
  readonly takes: NativeOrientFlows;
  readonly taken: NativeOrientFlows;
}

/**
 * The package graph around a handful of asked files, folded from one source
 * index: which package each file is in, and for each of those packages the
 * names that cross its edge in both directions, as shares of that side.
 *
 * The state of the index is part of the answer, because a share read from an
 * index with stale or unread records is a share of what was read, and the
 * reader has to be told how much that is.
 */
export interface NativeOrientation {
  /**
   * Each asked file's package, in the order asked; both fields absent when none.
   * `indexed` says whether the index holds a record for the file, which is what
   * makes it a start point a question with `--from` can walk imports from.
   */
  readonly owners: readonly {
    readonly package?: string | null;
    readonly directory?: string | null;
    readonly indexed: boolean;
  }[];
  /** The distinct packages of the asked files, in the order first asked. */
  readonly packages: readonly NativeOrientPackage[];
  /** Records the folded index holds. */
  readonly records: number;
  /** Records whose file is gone or whose text changed since the index was published. */
  readonly stale: number;
  /**
   * Records the answer reads — into or out of an asked package, or into a
   * package one takes from — whose parse the index does not hold, so their
   * names are not counted.
   */
  readonly unread: number;
  /** Segments past the first one that failed its digest. */
  readonly dropped: number;
}

/** One asked file's row in a recording. */
export interface NativeCasesEntered {
  readonly file: string;
  /** Recorded cases that entered any region of the file; absent when the recording has no row for it. */
  readonly cases?: number | null;
  /**
   * Whether a region of the file ran while its module evaluated. The recording
   * credits that to no case — the cases whose files import the module ran it,
   * and the file graph names them — so `cases` is then not every case that ran
   * the file. Absent with no row.
   */
  readonly loaded?: boolean | null;
  /** The first of those cases, in code-unit order of test file and then name. */
  readonly titles: readonly { readonly file: string; readonly name: string }[];
  /** Recorded cases the file declares, when it is a test file the recording ran; absent when it declares none. */
  readonly declared?: number | null;
  /** The first of their names, in code-unit order. */
  readonly declaredNames: readonly string[];
}
