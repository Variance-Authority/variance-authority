// compass: variance-authority.reach
import type { ImporterReason } from './importers.js';
import type { FileReading } from './reading.js';

/**
 * What one snapshot can say about one diff: who it speaks for, and who the diff
 * reached.
 *
 * `selectTestFilesFromView` answers the second half alone, and an empty answer
 * from it has two readings that are opposite facts — *this diff reached nobody*,
 * and *this snapshot recorded nobody*. A caller that narrows a suite on the
 * first while holding the second skips every subject it has, silently, because a
 * subject that was never run is not in the report to be missing from.
 *
 * So `whole` is returned beside it. It is the tests whose observation was
 * complete, and only those: an upper-bound contribution cannot justify excluding
 * anything, and a test absent from the snapshot entirely is unknown rather than
 * untouched.
 */
export interface ExecutionNarrowing {
  /** Recorded tests whose observation was whole, so absence from `entered` is evidence. */
  readonly whole: readonly string[];
  /**
   * Recorded tests whose observation was not whole: a run that skipped every
   * case, or one whose probes fired where nothing could place them. Absence
   * from `entered` is no evidence for them, but they are named, so a caller
   * that cuts the selection into legs can place them by the import path each
   * ran to a changed file it loaded (`distanceFromView`), or run them in the
   * open leg when they ran none.
   * Absent when the reader names no such list, which is not the same as none.
   */
  readonly incomplete?: readonly string[];
  /** Recorded tests that entered a region this diff changed. */
  readonly entered: readonly string[];

  /**
   * Changed paths the record and the graph hold nothing about: no row under
   * any name the file may be held by, no precondition, and no place in the
   * graph when the caller handed one over.
   *
   * The record decides what a change reaches. A module with no row is answered
   * by the nearest importers that have one, and selects nobody when no chain
   * of imports reaches a row; so does a stylesheet nothing recorded imports.
   * What is listed here is different: a file the sense database has never
   * heard of — a README, a fixture the tests read with `fs`, a script they
   * spawn, a file outside the directories the scan was pointed at. It is a
   * report, not a widening, and no caller widens on it: a suite that depends
   * on such a file declares it as a precondition, and it stops appearing here.
   * A moved package is never here; its measured importers answer for it.
   *
   * Empty is the ordinary state, and always empty in a suite that declines
   * relations, which never asks the graph (`declined`).
   */
  readonly unread: readonly string[];

  /**
   * Changed paths the record did not measure, in a suite that declines
   * relations (`ExecutionNarrowingOptions.unmeasured`): no row under any name
   * and no test declaring it. Each selects nothing, because the suite said the
   * import graph does not name its audience. Absent when the suite asks the
   * graph; empty when it declines and every changed path was measured.
   */
  readonly declined?: readonly string[];

  /** Changed paths the suite's `ignore` matched, read by nothing. Absent when it ignores nothing. */
  readonly ignored?: readonly string[];

  /**
   * Changed modules whose recording was cut from a different text than the one
   * the diff is written against, so their line ranges were not read.
   *
   * A snapshot's ranges are coordinates in the text the suite ran over, and its
   * label is the commit `git rev-parse HEAD` named at that moment. A suite is
   * recorded *by being run*, so in a developer's loop or an agent's the tree is
   * dirty every time and the two are different texts — the ranges number lines
   * the commit never had. A hunk then lands on whichever region occupies those
   * numbers now, which answers with other tests, or with none, and the run is
   * green over a change nothing watched.
   *
   * A landing keeps the text of every module it recorded over an edit
   * (`kept-texts.ts`), and a caller that supplies `keptText` has the change
   * read from that text instead. What is left here is a module whose recorded
   * text was not kept — a run landed by a build that did not keep texts, a
   * text edited again while the suite ran, a cache cleared since — or whose
   * diff does not apply to the commit's text. Each is charged whole, which is
   * what the snapshot can still say honestly about it, and the next run that
   * loads it records it again. Empty is the ordinary state. It is listed
   * because the widening is a fact about the *recording*, not about the diff.
   *
   * Populated only when the caller supplies `sourceAt`. Without it nothing is
   * checked and this is empty because nothing looked — which is not the same
   * fact, and is why the option is named on the query rather than assumed.
   */
  readonly stale: readonly string[];

  /**
   * Why each test in `entered` is there: one entry per selected test, in the
   * same order, naming every region, precondition, and import chain that
   * selected it.
   *
   * A test that keeps running after a change is a question with three answers —
   * a probe placed wider than the edit, a precondition declared wider than it
   * needs to be, or a real dependency — and they are fixed in three different
   * places. `entered` alone cannot tell them apart. The reasons are the facts
   * the inner loop already held when it selected the test, kept rather than
   * discarded, so what a run prints about itself is what it did.
   *
   * Absent from a reading that names the tests it reached and not why: a
   * journey file's, read in the addon or here.
   */
  readonly because?: readonly SelectionCause[];

  /**
   * What the parser made of each changed file whose frame was proved: which
   * verdict charged it, or why it was charged by its lines alone. Without
   * `sourceAt` every file is `unread: 'source'`: the old text is only ever held
   * through it. Absent from an answer that never read a diff: one asked at a
   * point, or of a recording that selects by journeys.
   */
  readonly readings?: readonly FileReading[];
}

/** One selected test and everything that selected it. */
export interface SelectionCause {
  readonly test: string;
  readonly via: readonly SelectionReason[];
}

/**
 * One fact that put a test in `entered`.
 *
 * A `region` is a recorded block a changed line landed in, named the way the
 * journal names it — the enclosing declaration and the path to the block inside
 * it — with the source lines it spans, under the name the snapshot holds the
 * module by. A `precondition` is a changed file the test declared as governing
 * it: its own source, a setup file, a configuration. An `importer` is the chain
 * of imports from a changed file with no instrumented row to the file whose row
 * answered for it, which is how `ExecutionNarrowingOptions.relations` answers a
 * stylesheet, and a module the recording did not instrument.
 */
export type SelectionReason =
  | {
      readonly kind: 'region';
      readonly file: string;
      readonly name: string;
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: 'precondition'; readonly name: string }
  | {
      /** A place that reads a value the change moved: `file` declares `name`, `reader` reads it. */
      readonly kind: 'reader';
      readonly name: string;
      readonly file: string;
      readonly reader: string;
      readonly region?: Extract<SelectionReason, { kind: 'region' }>;
    }
  | ImporterReason;
