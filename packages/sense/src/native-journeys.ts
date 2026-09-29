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

/** A function at one end of a placed call. */
export interface NativeJourneysPlace {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly end: number;
}

/** One call some of the cases placed, counted among them. */
export interface NativeJourneysPlaced {
  /** Absent when the test itself made the call. */
  readonly from?: NativeJourneysPlace | null;
  readonly to: NativeJourneysPlace;
  /** Asked cases that placed it. */
  readonly cases: number;
  /** Every case that placed it, asked or not. */
  readonly all: number;
  /** `observed`, `static`, the way an inferred call was found, or `test`. */
  readonly known: string;
}

/** Every call the asked cases placed, untruncated, most asked cases first. */
export interface NativeJourneysAmong {
  /** Why the prepared file cannot answer; every other field is empty then. */
  readonly notPrepared?: string | null;
  /** Cases the recording holds. */
  readonly cases: number;
  /** Asked cases the recording does not hold. */
  readonly outside: readonly number[];
  readonly commit?: string | null;
  readonly tree?: string | null;
  readonly calls: readonly NativeJourneysPlaced[];
}

/** A recorded function. */
export interface NativeJourneyFunction {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly end: number;
}

/** A region written in a function. */
export interface NativeJourneyBlock {
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly end: number;
  /** The name of the function it is written in, when one is recorded. */
  readonly function?: string | null;
}

/** One case, numbered by its position in the recording. */
export interface NativeJourneyCase {
  readonly case: number;
  readonly file: string;
  readonly name: string;
  /** The regions its journey entered. */
  readonly blocks: number;
  /** Other cases whose journey entered exactly the same regions; absent when the answer did not compare whole journeys. */
  readonly alike?: number | null;
}

/** One way through a function: the regions written in it that its cases entered. */
export interface NativeJourneyPath {
  readonly cases: number;
  readonly files: number;
  readonly entered: readonly NativeJourneyBlock[];
  /** The median journey size of its cases. */
  readonly median: number;
  readonly smallest: NativeJourneyCase;
  /** Whether more than half the function's cases take it. */
  readonly passage: boolean;
}

/** Every path through one function, most cases first. */
export interface NativePathsThrough {
  /** Why the recording cannot answer; every other field is empty then. */
  readonly notRecorded?: string | null;
  readonly function?: NativeJourneyFunction | null;
  readonly cases: number;
  readonly paths: readonly NativeJourneyPath[];
}

/** One end of a connection, by a line its innermost function spans. */
export interface NativeJourneyEnd {
  readonly file: string;
  readonly line: number;
}

/** A region that separates the connecting journeys from the near misses. */
export interface NativeJourneyFork {
  readonly block: NativeJourneyBlock;
  /** Positive when it is the way through, negative when it turns away. */
  readonly separation: number;
}

/** The journeys that reached one end and not the other. */
export interface NativeJourneySide {
  readonly end: 'a' | 'b';
  readonly only: number;
  readonly near: number;
  /** The most any of them shares with a connecting journey, when none nearly connected. */
  readonly best?: number | null;
  /** Strongest first; absent when nothing nearly connected or the connection is thin. */
  readonly forks?: readonly NativeJourneyFork[] | null;
  readonly nearly?: NativeJourneyCase | null;
}

/** How one function is connected to another, read off the cases alone. */
export interface NativeForksBetween {
  readonly notRecorded?: string | null;
  readonly a?: NativeJourneyFunction | null;
  readonly b?: NativeJourneyFunction | null;
  readonly reachedA: number;
  readonly reachedB: number;
  readonly both: number;
  readonly journeys: number;
  readonly connection?: NativeJourneyCase | null;
  readonly thin: boolean;
  readonly sides?: readonly NativeJourneySide[] | null;
}

/** A function of the mapped file, read through the kept cases. */
export interface NativeJourneyMapFunction {
  readonly function: NativeJourneyFunction;
  readonly cases: number;
  readonly paths: readonly NativeJourneyPath[];
}

/** A function beyond the file that most kept cases entered. */
export interface NativeJourneyMapPlace {
  readonly function: NativeJourneyFunction;
  readonly cases: number;
  /** The smallest kept journey that reached it. */
  readonly nearest: NativeJourneyCase;
}

/** The functions beyond the file that exactly the same few kept cases entered. */
export interface NativeJourneyMapBranch {
  readonly cases: number;
  readonly places: readonly NativeJourneyFunction[];
  readonly smallest: NativeJourneyCase;
}

/** The map of the code around one file, drawn from the journeys of the tests kept. */
export interface NativeJourneyMap {
  readonly notRecorded?: string | null;
  readonly file: string;
  /** Cases in the recording: the denominator of structure. */
  readonly suite: number;
  readonly entered: number;
  readonly kept: number;
  /** The kept cases, smallest journey first. */
  readonly tests: readonly NativeJourneyCase[];
  readonly functions: readonly NativeJourneyMapFunction[];
  /** Beyond the file, entered by most kept cases, nearest first. */
  readonly spine: readonly NativeJourneyMapPlace[];
  /** Beyond the file, entered by fewer, most cases first. */
  readonly branches: readonly NativeJourneyMapBranch[];
  /** Functions beyond the file the kept cases entered and at least half the suite did too. */
  readonly structure: number;
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
  /** Every call the cases numbered `cases`, by their position in the recording, placed in the journeys kept at `out`. */
  journeysAmong?(index: string, recording: string, out: string, cases: number[]): NativeJourneysAmong;
  /** Every path through the innermost function the recording holds at `file:line`. */
  pathsThrough?(recording: string, file: string, line: number): NativePathsThrough;
  /** How the function at `a` is connected to the one at `b`. */
  forksBetween?(recording: string, a: NativeJourneyEnd, b: NativeJourneyEnd): NativeForksBetween;
  /** The map around `file`, kept to the cases whose test file or name holds any of `terms`. */
  journeyMap?(recording: string, file: string, terms?: string[] | null): NativeJourneyMap;
}
