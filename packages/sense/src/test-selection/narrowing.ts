// compass: variance-authority.reach
import type { Relations } from '@variance-authority/core/relate';
import type { ImporterReason } from './importers.js';
import type { Precision } from './precision.js';
import type { Unmeasured } from './route.js';
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
   * What the reader made of each changed file: which verdict charged it, why
   * it was charged by its lines alone, or why no reader was asked of it. Every
   * changed file has one. Without `sourceAt` every file read is
   * `unread: 'source'`: the old text is only ever held through it. Absent from
   * an answer that never read a diff: one asked at a point, or of a recording
   * that selects by journeys.
   */
  readonly readings?: readonly FileReading[];
}

/**
 * Why no reader was asked of a changed file, which has a reading all the same:
 * the record and the file graph hold nothing about it (`nothing`), it was
 * recorded from a text nobody kept (`stale`), the suite declines relations and
 * its record did not measure it (`declined`), the suite's `ignore` matches it
 * (`ignored`), or its rows, preconditions or importers answered for it
 * (`answered`). None of them says the change reaches a test through the file.
 */
export type Unasked = 'nothing' | 'stale' | 'declined' | 'ignored' | 'answered';

const UNASKED: ReadonlySet<string> = new Set<Unasked>(['nothing', 'stale', 'declined', 'ignored', 'answered']);

/** Whether an `unread` reason says no reader was asked of the file. */
export const isUnasked = (unread: string): unread is Unasked => UNASKED.has(unread);

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

export interface ExecutionNarrowingOptions {
  /**
   * The file graph a scan produced, so a changed file with no instrumented row
   * is answered by the nearest files that import it and have one.
   */
  readonly relations?: Relations;
  /**
   * What a changed file with no instrumented row goes to: the graph's nearest
   * measured importers, or nothing (`route.ts`). Absent is `relations`. A suite
   * that declines them names such a file in `ExecutionNarrowing.declined`; the
   * tests that declare it still select themselves, since that is the record
   * speaking and not the graph.
   */
  readonly unmeasured?: Unmeasured;
  /**
   * The suite's `ignore` globs (`route.ts`): a changed file one matches loses
   * its rows, its import and asset edges and its place in `unread`, and keeps
   * what a test declared — a precondition, a `/// <depends>` — since no glob
   * undoes a declaration. It is named in `ExecutionNarrowing.ignored`. Absent
   * ignores nothing.
   */
  readonly ignore?: readonly string[];
  /**
   * The suite's precision (`precision.ts`): the import graph alone
   * (`file`, `symbol`), the files, functions or regions a test entered. Absent
   * is `region-use`.
   */
  readonly precision?: Precision;
  /**
   * Per changed file, the exports its change moved, which narrows the walk at
   * `symbol`. Absent reads them from the file's two texts where `root` names
   * the repository; a file it does not name is walked whole.
   */
  readonly moved?: ReadonlyMap<string, readonly string[]>;
  /**
   * Every name the snapshot may hold a graph file under. When absent, the
   * record's own names that the `tsconfig` under `root` builds from the file,
   * and identity without `root`.
   *
   * A package's own tests load its `src`; every other package loads its built
   * output, and the snapshot records each name as its own row. Both rows are one
   * file to the graph, which knows only the source name, so a changed file and
   * every importer reached from it are looked up under every name given here.
   */
  readonly knownAs?: (file: string) => readonly string[];
  /**
   * A module's source as it stood at the position the snapshot names, so the
   * line ranges the snapshot holds can be checked against the ones the diff is
   * written in.
   *
   * A recording cuts its line ranges from the text on disk at the moment the
   * suite ran, and labels the whole snapshot with `git rev-parse HEAD`. Those
   * two agree only when the tree was clean, and a suite is *recorded by being
   * run*: in the loop this is most wanted in — a developer's, an agent's — the
   * tree is never clean, so the ranges are the working tree's and the label
   * says the commit's. Every hunk a later diff produces is then charged to
   * whatever region happens to occupy those numbers now, which is a different
   * region, belonging to different tests, or to none.
   *
   * Given this, each changed module is asked for its text at the commit on the
   * label and the answer is hashed against `modules.source`, which the recorder
   * already wrote for exactly this text. A module whose two do not agree is
   * charged whole — its own crossings, the widest honest answer — and named in
   * `stale`. Without this the frame is taken on trust, and a caller that skips
   * anything on that trust is trusting a number nobody checked.
   *
   * `undefined` for a file the commit does not hold is the same disagreement:
   * the snapshot has a row for a file that did not exist there.
   *
   * `asking` is every changed path the selection reads a text under, the same
   * list with every ask, complete before the first: a reader that fetches
   * paths together fetches these, and none of the rest of the diff. A path
   * outside it — an unchanged importer — is still asked.
   */
  readonly sourceAt?: (file: string, commit: string | undefined, asking?: readonly string[]) => string | undefined;
  /**
   * The text a landing kept for a digest `modules.source` holds, when the
   * commit on the label does not hold it (`keptTexts`).
   *
   * A module recorded over an edit disagrees with its commit, and with this its
   * rows are read in the text they were cut from: the change is read as the
   * diff from that text to the diff's new side, so the hunks land on the regions
   * they touch. Without it, or when nothing was kept, the module is `stale`.
   */
  readonly keptText?: (digest: string) => string | undefined;
  /**
   * Every digest `keptText` holds a text for (`keptDigests`). With it, a module
   * whose rows were cut from a kept text and that the diff does not name is
   * read too: its edit was undone, and the change is read from the kept text to
   * the commit's. Without it, an undone edit selects nothing.
   */
  readonly keptDigests?: () => readonly string[];
  /**
   * The checkout every name is relative to, so a package's manifest can say
   * that loading a module does something (`sideEffects`). Without it, no
   * manifest is asked, and loading a module is assumed only to declare what it
   * exports.
   */
  readonly root?: string;
}
