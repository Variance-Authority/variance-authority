/**
 * The mainline records kept for a checkout, as the addon's `mainline_kept.rs`
 * orders them, and the one walk behind a commit that orders them.
 */

// compass: variance-authority.reach

/** One kept record: the read root it is under, and the commit directory that names it. */
export interface NativeKeptMainline {
  readRoot: string;
  commit: string;
}

export interface NativeMainlineKept {
  /** The records named in `readRoots`' commit directories, of `selected` when named, in the order every reader takes them. */
  keptMainlines?(checkout: string, readRoots: string[], selected: string | null): NativeKeptMainline[];
  /** The commits of `kept` that `from` contains, nearest first; `landedAfter` in seconds. */
  keptBehind?(checkout: string, from: string, kept: string[], firstParent: boolean, landedAfter: number | null): string[];
}
