/** The evidence returned by a change review. */
// compass: variance-authority/runtime/attention
import type { CasePrecondition, CommitRuns, LineRange, Misuse, WhatLanded } from '@variance-authority/sense/test-selection';
import type { CoveringMotion } from './covering-motion.js';
import type { InstallDiff } from './installed.js';
import type { PackageReach } from './review-install.js';
import type { ReviewCoverage } from './review-coverage.js';
import type { ReviewDrift } from './review-drift.js';

/**
 * How a changed region was reached, first match wins: `near` when a case from a
 * test file importing the file, or whose source it is, called into it, `far`
 * when every one came through another module, and `unplaced` when one came
 * from a test the import graph does not hold. The rest are the record's own
 * `Reach` (`@variance-authority/sense/test-selection`) of a region no case
 * called into.
 */
export type Reach = 'near' | 'far' | 'unplaced' | 'loaded' | 'overwritten' | 'hole' | 'unwalked' | 'unknown';

export const REACHES: readonly Reach[] = ['near', 'far', 'unplaced', 'loaded', 'overwritten', 'hole', 'unwalked', 'unknown'];

export interface ReviewRegion {
  readonly kind: string;
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly reach: Reach;
  /**
   * `new` when the change wrote every line of words in it, `moved` when those
   * lines are also text the change removed, and `modified` otherwise. A
   * function renamed or declared again over its old body is `modified`.
   */
  readonly edit: 'new' | 'moved' | 'modified';
  /** The file the text of a `moved` region was removed from: its own, when it moved within the file. */
  readonly movedFrom?: string;
  /** How many cases called into it. */
  readonly cases: number;
  /**
   * How many of the cases that entered it ran a line of it the change wrote,
   * as `variance covering --line` names them for each such line. A case can
   * enter a function and take the branch the change left alone.
   */
  readonly changedLineCases: number;
  /** The test files those cases are declared in, in code-unit order. */
  readonly tests: readonly string[];
  /** Those cases by test file, title and id, in code-unit order: what a reader asks the count about. */
  readonly called: readonly ReviewCase[];
}

export interface ReviewCase {
  /** The id its producer gave it: two cases may share a file and a title, never an id. */
  readonly id: string;
  readonly file: string;
  /** The title with every `describe` it sits in, joined by ` > `. */
  readonly name: string;
  /** What it said it arranged, as `covering` reads it: empty is heard-nothing, absent is a record that did not listen. */
  readonly preconditions?: readonly CasePrecondition[];
  /** What the code it ran read, as `covering` reads it: empty is read-nothing, absent is a record that did not listen. */
  readonly reads?: readonly CasePrecondition[];
  /** Each `varianceBreadcrumb` call in it that made no `dimension:key`, empty where none did; absent where the run did not listen to reads. */
  readonly misused?: readonly Misuse[];
}

export interface ReviewFile {
  readonly file: string;
  /** The reading of the edit. Absent for a file the module reader does not claim. */
  readonly verdict?: 'none' | 'bodies' | 'values' | 'load';
  /** Top-level bindings whose value moved, under `values`. */
  readonly names?: readonly string[];
  /** Why the edit could not be read, when it could not. A file the change created has no edit to read. */
  readonly unread?: string;
  /** The change created the file: there is no base text to read the edit against. */
  readonly created?: true;
  /** The source index read the file: it holds code, in a language the module reader may not claim. */
  readonly indexed?: true;
  /** The record holds cases declared in the file: a test file it ran, which no case enters as a module. */
  readonly holdsCases?: true;
  /** Whether the record holds a row for this file. Absent when coverage was not asked: an edit that changes nothing that runs. */
  readonly recorded?: boolean;
  /** A suite the review read ran the file as the tree holds it, so its regions say what the change did. */
  readonly ran?: true;
  readonly regions?: readonly ReviewRegion[];
  /** The lines of the file the change wrote, beside `regions`: what a diff shows of a function. */
  readonly written?: readonly LineRange[];
  /** Case names the file declares now and did not, and the reverse. Absent when there is no base to compare with. */
  readonly cases?: { readonly added: readonly string[]; readonly removed: readonly string[] };
}
/** One package holding changed functions: what `review` calls where the change lands. */
export interface ChangedPackage {
  /** The manifest's `name`, or its directory when it declares none. */
  readonly package: string;
  /** The directory of its manifest inside the root; `.` for the root, and for files under no manifest. */
  readonly path: string;
  /** Its changed functions, a branch counted under the function holding it. */
  readonly functions: number;
  /**
   * Those functions by their own region's reach, the mark the table of what ran gives each; code outside any function
   * by its worst region's.
   */
  readonly reaches: Partial<Record<Reach, number>>;
  /** How many of those functions hold changed code no case ran: the ones no case entered, and the ones a case entered that left a branch in them unrun. */
  readonly uncovered: number;
  /** How many of the rest hold changed code no case is known to have run, a case having run it in a text an edit wrote over; absent, not none, from a review.json written by a build that did not count them. */
  readonly overwritten?: number;
  /** Whether a test file in its own directory entered them. */
  readonly own: boolean;
  /** The other packages whose test files entered them, by name, in code-unit order. */
  readonly tests: readonly string[];
  /**
   * How many other packages hold a file that imports its changed files, through any number of imports, a type-only
   * import included. A count, not the names: next to a hub, the names run into the thousands for every package the
   * change touches. Absent when the import graph holds none of its changed files.
   */
  readonly importers?: number;
}

/** A changed file one or more tests declare as a precondition: before the reach of any import. */
export interface BeforeReach {
  readonly file: string;
  readonly tests: number;
}

export interface Review {
  /**
   * The checkout's commit and its parents, as git lists them, and `pull`, the
   * pull request's head when the CI event names one: on a pull request, CI
   * checks out the merge GitHub made, whose second parent is that head.
   * `dirty` when the tree had edits or new files on top of it, and `blob`,
   * where the host shows the files at it, only when it did not. Absent when
   * git could not say.
   */
  readonly head?: {
    readonly commit: string;
    readonly parents: readonly string[];
    readonly pull?: string;
    readonly dirty?: true;
    readonly blob?: string;
  };
  /** Optional per-suite evidence carried in the uploaded artifact. */
  readonly coverage?: readonly ReviewCoverage[];
  /** The suite whose runs and freshness the summary describes. Under `--coverage` the changed regions are every declared suite's. */
  readonly recordedSuite?: string;
  /** The commit the change is read from. */
  readonly from: string;
  /**
   * Whether the record holds this change. `ran` when every changed module it
   * recorded ran as the tree holds it now, so it says what the change did;
   * `before` when one ran as other text, or as a text not known
   * ({@link Review.notUpdated}), so it names the cases that stood on
   * the changed lines — the ones the change might move — and code written
   * since has no row yet.
   */
  readonly record: 'ran' | 'before';
  /**
   * What `from` came from: `--since`, the commit the recording stood at before
   * these runs, or, when there was no recording before them, the record the
   * suite's mainline published — `from` is its commit, or that commit's merge
   * base with this checkout when it was published past it.
   */
  readonly base: 'since' | 'recording' | 'mainline';
  /** The mainline record the base was read from, when `base` is `mainline`. */
  readonly mainline?: {
    readonly name: string;
    readonly suite: string;
    readonly commit: string;
    /** Absent when this clone cannot count it. */
    readonly distance?: number;
    /** Where the record is kept in the cache. */
    readonly kept: string;
    /** Why the cases it published were not compared with, when it published cases that do not read. */
    readonly casesUnread?: string;
  };
  /** The runs recorded at this commit, when they listed themselves. */
  readonly runs?: ReviewRuns;
  /** The commits every suite's runs name, under `--coverage`, which reads every suite. */
  readonly ranCommits?: readonly string[];
  readonly files: readonly ReviewFile[];
  /** The packages holding changed functions, by directory. Absent when no changed function was located. */
  readonly changedPackages?: readonly ChangedPackage[];
  /** How many test files the snapshot holds, the scale `before` is read on. Absent with `before` when the snapshot could not be read. */
  readonly suite?: number;
  readonly before?: readonly BeforeReach[];
  /** Absent when there is no install to compare. */
  readonly beyond?: InstallDiff;
  /** Each package `beyond` names, followed to the files here that depend on it. Absent with `beyond`, or when it could not be compared. */
  readonly packages?: readonly PackageReach[];
  readonly motion?: CoveringMotion;
  /** What a record cut under probes this build does not place leaves open, said beside the answer read from it (`probes-gap.ts`). */
  readonly probes?: string;
  /** Why no case is said to have moved, when the runs record could not be read and `--since` named the base. */
  readonly runsUnread?: string;
  /** Why which text the record ran over is not known, when the source index could not be brought up to the checkout to name the tree's. */
  readonly notUpdated?: string;
  /** Where the run's loads drifted from the walk against the mainline's, or why that was not checked (spec 0105). */
  readonly drift?: ReviewDrift;
}

/** The runs at this commit as a review reports them: where and when they ran, how many, and what their landings say together. */
export interface ReviewRuns extends Pick<CommitRuns, 'commit' | 'over' | 'latest' | 'runs'>, WhatLanded {}
