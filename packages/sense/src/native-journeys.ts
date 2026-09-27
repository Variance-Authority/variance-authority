/**
 * What the native scanner's layer-2 journey calls take and answer: every
 * recorded case walked once over the static call graph and kept beside the
 * source index, then asked about a file or a line.
 *
 * Declared apart from `native.ts` for the reason `native-journey.ts` is: the
 * scanner's contract is long, and each family of calls is read on its own.
 * `native/src/journeys.rs` prepares and `native/src/journeys_read.rs` answers.
 */

/** What preparing the journeys walked and kept. */
export interface NativeJourneysPrepared {
  /** The file was already stamped with this recording, this index and this runner table. */
  readonly kept: boolean;
  readonly cases: number;
  /** Functions outside the test files the cases entered, summed per case. */
  readonly functionsEntered: number;
  /** Of those, the ones a walk placed on a route. */
  readonly placed: number;
  readonly calls: number;
  readonly flows: number;
  /** Specifiers the index did not answer, which the walk resolved itself. */
  readonly fellBack: number;
  /** Specifiers the runner's alias table answered. */
  readonly aliased: number;
  /** Runner configs that did not load and aliases that were not read, each with why. */
  readonly runnerUnread: readonly string[];
  /** The commit the recording ran at, when it names one. */
  readonly commit?: string | null;
  /** Why the call graph was parsed from the working tree rather than from the recorded commit. */
  readonly tree?: string | null;
}

/** The recording's commit as the caller read it, or why there is none. */
export interface NativeJourneysCommit {
  readonly commit?: string | null;
  /** Why the recording names no commit. */
  readonly unread?: string | null;
}

/** One question: a file, or a line in it. */
export interface NativeJourneysAsk {
  /** From the checkout's root. */
  readonly file: string;
  readonly line?: number | null;
}

/** A function or branch the recording holds, with the cases that ran it. */
export interface NativeJourneysBlock {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly end: number;
  readonly cases: number;
}

/** One placed call, named by its far end. */
export interface NativeJourneysCall {
  /** Absent for the test itself. */
  readonly name?: string | null;
  readonly file?: string | null;
  readonly line?: number | null;
  /** The asked file's own function the call lands on or leaves from, when the question was the whole file. */
  readonly at?: string | null;
  readonly cases: number;
  /** `observed`, `static`, the way an inferred call was found, or `test`. */
  readonly known: string;
}

/** The function holding an asked line: who calls it, what it calls, and what is written inside it. */
export interface NativeJourneysRegion extends NativeJourneysBlock {
  /** It ran while its module loaded. */
  readonly loaded: boolean;
  /** Cases that placed a caller for it, summed over its callers. */
  readonly placedIn: number;
  readonly callers: readonly NativeJourneysCall[];
  readonly moreCallers: number;
  readonly goes: readonly NativeJourneysCall[];
  readonly moreGoes: number;
  /** Functions written directly inside it that cases entered; listed only when it goes nowhere. */
  readonly inner: readonly NativeJourneysBlock[];
  readonly moreInner: number;
}

export interface NativeJourneysFlow {
  readonly cases: number;
  /** In the order the flow reached them; `null` for files no named manifest sits above. */
  readonly packages: readonly (string | null)[];
  readonly exampleFile: string;
  readonly exampleName: string;
}

/** The package flows through the asked file's package: each case's test file's package, then the packages its placed calls reach, in order. */
export interface NativeJourneysFlows {
  /** The asked file's package; absent when no named manifest sits above it. */
  readonly package?: string | null;
  /** Cases that entered a function of the package, as the recording has it. */
  readonly through: number;
  /** Cases whose package flow passes through the package, the package their test file sits in counted. */
  readonly placed: number;
  /** Distinct package flows among those. */
  readonly distinct: number;
  readonly top: readonly NativeJourneysFlow[];
}

/** The answer for one ask. */
export interface NativeJourneysFile {
  readonly file: string;
  readonly line?: number | null;
  /** The recording has functions in this file. */
  readonly recorded: boolean;
  /** Cases that entered a function of this file, as the recording has it. */
  readonly cases: number;
  /** The file differs from the recorded commit; absent when no line was asked, or git could not say. */
  readonly changed?: boolean | null;
  /** The asked line was written after the recording. */
  readonly writtenSince: boolean;
  /** The asked line's number at the recorded commit, when the file changed. */
  readonly atCommit?: number | null;
  /** Why the asked line is read as the number it has today rather than carried back to the recorded commit. */
  readonly unplaced?: string | null;
  /** Without a line: the file's most-entered blocks, and what crosses its edge. */
  readonly blocks: readonly NativeJourneysBlock[];
  readonly moreBlocks: number;
  readonly callers: readonly NativeJourneysCall[];
  readonly moreCallers: number;
  readonly goes: readonly NativeJourneysCall[];
  readonly moreGoes: number;
  /** With a line: the innermost function holding it. */
  readonly focus?: NativeJourneysRegion | null;
  /** The innermost block holding the line, when it is not the focus. */
  readonly holding?: NativeJourneysBlock | null;
  readonly flows: NativeJourneysFlows;
}

export interface NativeJourneysAnswer {
  /** Why the prepared file cannot answer; every other field is empty then. */
  readonly notPrepared?: string | null;
  readonly cases: number;
  readonly commit?: string | null;
  /** Why the call graph was parsed from the working tree rather than from the recorded commit. */
  readonly tree?: string | null;
  readonly files: readonly NativeJourneysFile[];
}

/** The journey calls on a git listing the addon holds, carrying it rather than asking git again. */
export interface NativeJourneysListing {
  /** The Vite and Vitest configs this listing holds, not counting ones a fixture, template or example ships. */
  runnerConfigs?(): string[];
  /** Walk every case of the recording and keep the journeys at `out`; `null` when there is no source index. */
  prepareJourneys?(
    root: string,
    index: string,
    recording: string,
    at: NativeJourneysCommit,
    out: string,
    runner: string | null,
  ): NativeJourneysPrepared | null;
}

/** The addon's layer-2 journey calls. */
export interface NativeJourneys {
  /** The Vite and Vitest configs git lists under `root`; `null` when git cannot list. */
  runnerConfigs?(root: string): string[] | null;
  /** The journeys kept at `out`, when this walk prepared them from this recording, this index and a runner table under `runnerDigest`. */
  journeysKept?(index: string, recording: string, out: string, runnerDigest?: string | null): NativeJourneysPrepared | null;
  /** Walk every case of the recording and keep the journeys at `out`, with git listing the checkout; `null` when there is no source index. */
  prepareJourneys?(
    root: string,
    index: string,
    recording: string,
    at: NativeJourneysCommit,
    out: string,
    runner: string | null,
  ): NativeJourneysPrepared | null;
  /** Answer each ask from the journeys kept at `out`. */
  journeysFor?(root: string, index: string, recording: string, out: string, asks: NativeJourneysAsk[]): NativeJourneysAnswer;
}
