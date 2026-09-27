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

/** The code map as folded, or as kept when nothing it is folded from moved. */
export interface NativeOrientMapMade {
  readonly packages: number;
  readonly areas: number;
  /** How many areas deep the deepest package sits. */
  readonly levels: number;
  /** Dependency layers: 0 takes nothing, and each layer takes only from those below it. */
  readonly layers: number;
  /**
   * Counted files whose requests could not be read against their parse. Their
   * edges are on the map; the names they take are not, and a request the index
   * left unresolved is not answered by its bare specifier.
   */
  readonly unread: number;
}

/** What preparing the code map made of the checkout. */
export interface NativeOrientMapPrepared {
  /** Absent when no map was folded, and `unmade` says why. */
  readonly map?: NativeOrientMapMade | null;
  /** Why no map was folded, as a clause: `the root's is the only named manifest`, `no manifest names a package`, or `the source index holds no file records`. */
  readonly unmade?: string | null;
  /** Git could not list the checkout: the files are the ones the index holds, and the manifests the ones found beside them. */
  readonly walked: boolean;
  /** Git listed the checkout but could not say which files are generated or vendored, so none were set aside. */
  readonly unmarked: boolean;
  /** No scan's listing was carried to the map, so git listed the checkout again for it. */
  readonly relisted: boolean;
}

/** A package or an area on one row, and how many importing files the share counts. */
export interface NativeOrientMapShare {
  readonly name: string;
  readonly files: number;
}

/** One area on a page of the code map. */
export interface NativeOrientMapRow {
  /** `1`, `4.1`: its place among its siblings, largest first, under its parent's. */
  readonly id: string;
  readonly name: string;
  readonly packages: number;
  /** Source files, not the tests' side. */
  readonly files: number;
  readonly low: number;
  readonly high: number;
  readonly median: number;
  /** Files outside the area importing into it, and the packages the first of them land on. */
  readonly incoming: number;
  readonly front: readonly NativeOrientMapShare[];
  /** Packages past the front. */
  readonly more: number;
  /** Files of the area importing out of it, and the two areas most of them land in. */
  readonly outgoing: number;
  readonly uses: readonly NativeOrientMapShare[];
}

/** One page of the code map: the top of the checkout, or one area. */
export interface NativeOrientMapPage {
  /** Empty for the top page. */
  readonly id: string;
  readonly name: string;
  readonly packages: number;
  readonly files: number;
  readonly low: number;
  readonly high: number;
  /** Packages on this page that none of its areas took. */
  readonly alone: number;
  readonly rows: readonly NativeOrientMapRow[];
  /** The packages no area inside this one took, listed after the rows: all of them in an area with no areas inside it. */
  readonly list: readonly string[];
}

/**
 * One page of the code map, as the addon read it back: the page asked for, the
 * dependency layers of the whole map, and whether the map was folded from the
 * source index as it stands now.
 */
export interface NativeOrientMapAnswer {
  /** Whether the map was folded from the source index as it stands now. */
  readonly current: boolean;
  /** Absent when there was nothing to fold, and `unmade` says why. */
  readonly layers?: number | null;
  /** Absent when the map has no area by the id asked. */
  readonly page?: NativeOrientMapPage | null;
  /** Why no map was folded from this index, as a clause `NativeOrientMapPrepared.unmade` names. */
  readonly unmade?: string | null;
}

/** The code-map call on a git listing the addon holds. */
export interface NativeOrientMapListing {
  /** Fold the source index at `index` into the code map, carrying this listing rather than asking git again; `null` when there is no index. */
  prepareOrientMap?(root: string, index: string): NativeOrientMapPrepared | null;
}

/** The addon's code-map calls, kept apart from the scanner's other calls. */
export interface NativeOrientMaps {
  /**
   * Fold the source index at `index` into the code map kept beside it, with no
   * scan's listing to carry: git lists the checkout for the map. `scanned` is a
   * scan that ran and git could not list, so none is asked for. `null` when
   * there is no index.
   */
  prepareOrientMap?(root: string, index: string, scanned?: boolean | null): NativeOrientMapPrepared | null;
  /** One page of the code map kept beside the index at `index`, the top one without `area`; `null` when none is kept, or one of a format this reader does not know. */
  orientMapPage?(index: string, area?: string | null): NativeOrientMapAnswer | null;
}
