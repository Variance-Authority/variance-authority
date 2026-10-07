// compass: variance-authority/runtime/attention
/**
 * What a change moved, read as two records rather than one.
 *
 * `covering --since` says which cases walk the lines a change touched. A change
 * to a test does its work on lines it did not touch: the function a test stops
 * calling is in a file the diff never names. That is only visible against a
 * base, so this reads two case indexes and reports the regions whose cases
 * moved. The base is `--against <record>` on a pull request, and under
 * `--cases last` the layer the last run retired, which is the same test before
 * the edit you just ran.
 */

import {
  anyStopped,
  caseMotion,
  caseSectionsAt,
  decodeExecutionIndex,
  lastCaseRunOf,
  recordedCommit,
  type CaseMotion,
  type CommitRuns,
  type ExecutionIndex,
  type ExecutionTest,
  type LastCaseRun,
  type MovedRegion,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedCovering } from '../covering-args.js';
import { keepCases, type CoveringScope } from './covering-scope.js';
import { readExecutionIndex } from './execution-input.js';
import { diffFromBase, movedOnBase } from './base-diff.js';
import { cutElsewhere } from './before-texts.js';
import { relationsFor } from './source-graph.js';

/** Which record the answer was compared with, and what of it was left out. */
export interface MotionBase {
  /** The base's case index. */
  readonly from: string;
  /** `before` for the layer the last run retired, `record` for one named by `--against`. */
  readonly kind: 'before' | 'record';
  /** The commit the base was recorded at: always, once it is compared, because its regions are paired through the diff from it. */
  readonly at?: string;
  /** Where the diff's ref and `HEAD` part, when the base was compared under `--since`. */
  readonly mergeBase?: string;
  /**
   * Files the base's branch changed between the base's commit and the merge
   * base. Their motion is that branch's, so they are not compared. Absent when
   * the base was not compared under `--since`.
   */
  readonly leftOut?: readonly string[];
}

export interface CoveringMotion {
  readonly base: MotionBase;
  /** Absent when the base holds none of the cases asked about, so there was nothing to compare. */
  readonly moved?: CaseMotion;
  /**
   * Test files the runs at this commit ran that no case index written at this
   * commit names, so the base layer holds no cases they replaced and they are
   * not compared. Only a file the index holds a case of is one: a file with no
   * case anywhere had nothing to compare. Empty when every one is named; absent when this was not
   * asked, as against a record `--against` names, or when no run named itself
   * beside the case index.
   */
  readonly unwritten?: readonly string[];
  /**
   * Test files a run at this commit laid over no index, and none has run since:
   * no case of them came before, so they are not compared. Absent when there
   * are none.
   */
  readonly unbased?: readonly string[];
  /**
   * Modules whose cases before were recorded over another text than the
   * commit they are compared from holds, so their regions stand on lines that
   * commit does not have. They are not compared, and nothing in them is lost
   * or gained. Absent when there are none, and when the layer names no texts.
   */
  readonly unmeasured?: readonly string[];
  /**
   * The file naming the run that wrote the case index last, when it is there
   * and could not be read. Which files a run at this commit wrote is then not
   * known, so nothing is compared.
   */
  readonly lastRunUnread?: string;
}

/**
 * Which test files' cases the before layer holds for the runs at one commit,
 * read from the run that wrote the case index last. That run names its commit
 * and every file the runs at that commit announced; the layer beside it is
 * this commit's only when the commits agree.
 *
 * - `compared`: the files whose cases are compared. The last run's own list
 *   when it was made at this commit, none when it was not, and the runs' own
 *   list when no run named itself, as before a run wrote one.
 * - `unwritten`: the files the runs named that `compared` leaves out; absent
 *   when no run named itself, because then it is not known.
 * - `lastRunUnread`: the last run's file could not be read, so neither is known.
 */
export type RunsWrote =
  | {
    readonly compared: ReadonlySet<string>;
    readonly at?: string;
    readonly unwritten?: readonly string[];
    readonly unbased?: readonly string[];
  }
  | { readonly lastRunUnread: string };

export async function runsWrote(from: string, runs: CommitRuns): Promise<RunsWrote> {
  const last = lastRun(from);
  if (last === 'unreadable') return { lastRunUnread: from };
  if (last === undefined) return { compared: new Set(runs.files) };
  if (last.commit === undefined || last.commit !== runs.commit) return { compared: new Set(), unwritten: [...runs.files] };
  const written = new Set(last.files);
  const unbased = new Set(last.unbased ?? []);
  const compared = new Set(last.files.filter((test) => !unbased.has(test)));
  return {
    compared,
    ...(last.before === undefined ? {} : { at: last.before }),
    unwritten: runs.files.filter((test) => !written.has(test)),
    ...(unbased.size === 0 ? {} : { unbased: [...unbased] }),
  };
}

/** The motion a request asks for: against `--against`, or under `--cases last` against the run before. */
export async function motionFor(
  request: ParsedCovering,
  from: string,
  scope: CoveringScope | undefined,
  full: ExecutionIndex | undefined,
): Promise<CoveringMotion | undefined> {
  if (request.since !== undefined && request.against !== undefined) {
    return motionAgainst(from, request.against, request.since, request.root);
  }
  if (scope?.cases !== 'last' || full === undefined) return undefined;
  return motionOfLast(full, from, scope.tests, request.root, request.file);
}

/**
 * The last run's cases against the layer it retired, narrowed to one module
 * when one was asked. Under `since`, what the base's branch moved between the
 * layer's commit and where the branches part is left out, as it is for a
 * record `--against` names.
 */
export async function motionOfLast(
  full: ExecutionIndex,
  from: string,
  cases: readonly string[],
  root: string,
  file?: string,
  since?: string,
): Promise<CoveringMotion> {
  const last = lastRun(from);
  const at = last === 'unreadable' ? undefined : last?.before;
  const asked = new Set(cases);
  const ran = new Set(last === 'unreadable' || last === undefined ? full.tests.filter((test) => asked.has(test.id)).map((test) => test.file) : last.files);
  return againstBefore(full, from, cases, root, { at, file, since, ran });
}

/**
 * Cases against the before layer the record keeps. Given `files`, only
 * those test files' cases are read on either side, so a file the layer holds
 * and the cases asked about leave out is not read as lost. `ran` is every test
 * file the runs at this commit ran; any other file's cases retain earlier ones.
 */
async function againstBefore(
  full: ExecutionIndex,
  from: string,
  cases: readonly string[],
  root: string,
  { at, file, since, files, ran }: {
    readonly at: string | undefined;
    readonly file?: string | undefined;
    readonly since?: string | undefined;
    readonly files?: ReadonlySet<string>;
    readonly ran: ReadonlySet<string>;
  },
): Promise<CoveringMotion> {
  const unread: MotionBase = { from, kind: 'before', ...(at === undefined ? {} : { at }) };
  const sections = caseSectionsAt(from);
  const before = sections.before;
  if (before === undefined) return { base: unread }; // kept no before layer: nothing to compare, unlike one that does not read
  let held: ExecutionIndex;
  try {
    held = decodeExecutionIndex(before);
  } catch (error) {
    throw new OperatorError(`the cases the last run retired in ${from} do not read (${error instanceof Error ? error.message : String(error)}), so what the run moved cannot be compared.`);
  }
  const { commit, diff } = await diffFromBase(at, root, BEFORE_LAYER);
  const parting = since === undefined ? undefined : await movedOnBase(commit, since, root);
  const base: MotionBase = { ...unread, ...(parting === undefined ? {} : { mergeBase: parting.mergeBase, leftOut: parting.files }) };
  if (files !== undefined) held = keepFiles(held, files);
  const cased = held.modules
    .filter((module) => (file === undefined || module.file === file) && module.blocks.some((block) => block.crossings.length > 0))
    .map((module) => module.file);
  const elsewhere = cutElsewhere(cased, lastCaseRunOf(sections)?.beforeTexts, commit, root);
  const asked = new Set(cases);
  const now = keepCases(full, asked);
  // A case of a file no run here ran retains an earlier recording, which stands
  // at both ends. A case a run here recorded says nothing of what came before.
  const retained = keepCases(full, new Set(full.tests.filter((test) => !asked.has(test.id) && !ran.has(test.file)).map((test) => test.id)));
  const exclude = new Set([...(parting?.files ?? []), ...elsewhere]);
  const moved = caseMotion(held, now, { ...(await graphFor(now, root)), exclude, retained, diff });
  return { base, moved: file === undefined ? moved : within(moved, file), ...(elsewhere.length === 0 ? {} : { unmeasured: elsewhere }) };
}

/** The before layer, as a refusal names it, and why it can name no commit. */
const BEFORE_LAYER = {
  name: 'The run before the last one',
  unnamed: 'That is so when that run named no commit, and when a run at the same commit ran one of its test files again, ' +
    'which mixes this commit\'s cases into the ones it replaced. The first run after a commit compares with the last run at the commit before.',
};

/** An index narrowed to the cases of some test files. */
export function keepFiles(index: ExecutionIndex, files: ReadonlySet<string>): ExecutionIndex {
  return keepCases(index, new Set(index.tests.filter((test) => files.has(test.file)).map((test) => test.id)));
}

/**
 * The runs at one commit against the cases they replaced. Only a run that
 * wrote the case index laid a before layer in the record, so only the files
 * {@link runsWrote} found written are compared, and the rest are said.
 */
export async function motionOfRuns(
  full: ExecutionIndex,
  from: string,
  wrote: RunsWrote,
  root: string,
  since?: string,
): Promise<CoveringMotion> {
  const base: MotionBase = { from, kind: 'before' };
  if ('lastRunUnread' in wrote) return { base, lastRunUnread: wrote.lastRunUnread };
  // A file the index holds no case of had nothing to compare: its run wrote no
  // case because it recorded none, and no earlier run left one either. A suite
  // whose every case skips on this machine, as a browser suite does where no
  // browser is installed, is that file on every run, and saying it was not
  // compared would name a comparison that was never there to make.
  const cased = new Set(full.tests.map((test) => test.file));
  const unbased = wrote.unbased?.filter((test) => cased.has(test)) ?? [];
  const said = {
    ...(wrote.unwritten === undefined ? {} : { unwritten: wrote.unwritten.filter((test) => cased.has(test)) }),
    ...(unbased.length === 0 ? {} : { unbased }),
  };
  if (wrote.compared.size === 0) return { base, ...said };
  const cases = full.tests.filter((test) => wrote.compared.has(test.file)).map((test) => test.id);
  const ran = new Set([...wrote.compared, ...(wrote.unwritten ?? []), ...(wrote.unbased ?? [])]);
  return { ...(await againstBefore(full, from, cases, root, { at: wrote.at, since, files: wrote.compared, ran })), ...said };
}

/** The current record against the base `--against` names, with what the base's branch moved left out. */
export async function motionAgainst(
  from: string,
  against: string,
  since: string,
  root: string,
): Promise<CoveringMotion> {
  let held: ExecutionIndex;
  try {
    held = await readExecutionIndex(against);
  } catch (error) {
    throw new OperatorError(
      `\`--against ${against}\` could not be read (${error instanceof Error ? error.message : String(error)}). ` +
        'A pipeline that restores the base branch\'s recording before the suite runs needs no `--against`: ' +
        'the run keeps the cases it replaced beside its index, and `review` reads them.',
    );
  }
  const now = await readExecutionIndex(from);
  const { commit, diff } = await diffFromBase(await baseCommit(against), root, { name: `The base \`${against}\`` });
  const parting = await movedOnBase(commit, since, root);
  const base: MotionBase = { from: against, kind: 'record', at: commit, mergeBase: parting.mergeBase, leftOut: parting.files };
  const exclude = new Set(parting.files);
  return { base, moved: caseMotion(held, now, { ...(await graphFor(now, root)), exclude, diff }) };
}

/**
 * The motion, in words, after the answer it was compared for. Cases are named
 * by id unless the caller numbers them. Given `listed`, no more than that many
 * regions and that many test files are listed, and the rest are counted.
 */
export function motionText(
  motion: CoveringMotion | undefined,
  named: (tests: readonly ExecutionTest[]) => string = casesByFile,
  listed = Infinity,
): readonly string[] {
  if (motion === undefined) return [];
  const { base, moved } = motion;
  const at = base.at === undefined ? '' : ` at ${base.at.slice(0, 12)}`;
  const against = base.kind === 'before' ? `the run before it${at}` : `${base.from}${at}`;
  const unwritten: string[] = motion.unwritten === undefined || motion.unwritten.length === 0
    ? []
    : [`Not compared, no case index was written at this commit for: ${listedOf(motion.unwritten, listed, 'test file')}.`];
  if (motion.unbased !== undefined && motion.unbased.length > 0) {
    unwritten.push(`Not compared, no case of these was recorded before this commit's first run: ${listedOf(motion.unbased, listed, 'test file')}.`);
  }
  if (motion.lastRunUnread !== undefined) {
    return ['', `Not compared: ${motion.lastRunUnread} could not be read, so which test files a run at this commit wrote to the case index is not known.`];
  }
  if (moved === undefined) {
    if (unwritten.length > 0) return ['', ...unwritten];
    // The runs at this commit were asked, and every file they ran either wrote
    // nothing to compare or has no case at all: there is no motion to report.
    return motion.unwritten === undefined ? ['', `Nothing to compare: ${base.from} holds none of these cases.`] : [];
  }
  const lines = [''];
  if (base.leftOut !== undefined && base.leftOut.length > 0) {
    lines.push(
      `Left out, changed on the base's branch between ${base.at!.slice(0, 12)} and the merge base ${
        base.mergeBase!.slice(0, 12)
      }: ${base.leftOut.join(', ')}.`,
    );
  }
  const { counts } = moved;
  if (moved.regions.length === 0) lines.push(`Against ${against}, no region moved.`);
  else {
    const said = (['lost', 'hidden', 'thinned', 'gained'] as const)
      .filter((motion) => counts[motion] > 0)
      .map((motion) => `${counts[motion]} ${motion}`);
    lines.push(`Against ${against}: ${said.join(', ')}.`);
    for (const region of moved.regions.slice(0, listed)) {
      const why = region.motion === 'gained'
        ? `now ${named(region.now)}`
        : region.motion === 'thinned'
          ? `was ${region.before.length} cases, now only ${named(region.now)}`
          : region.motion === 'lost'
            ? `was ${named(region.before)}`
            : region.stopped === undefined
              ? `was ${named(region.before)}; a case that could have reached it stopped, and the record cannot say which`
              : `was ${named(region.before)}; stopped: ${named(region.stopped)}`;
      lines.push(`  ${region.motion.padEnd(8)} ${place(region)} — ${why}`);
    }
    lines.push(...notListed(moved.regions.length - listed, 'region'));
  }
  for (const test of moved.testFiles.slice(0, listed)) {
    const reach = [
      ...(test.entered.length === 0 ? [] : [`now enters ${functionsIn(test.entered)}`]),
      ...(test.left.length === 0 ? [] : [`no longer enters ${functionsIn(test.left)}`]),
    ];
    lines.push(`${test.file} ${reach.join(', and ')}.`);
  }
  lines.push(...notListed(moved.testFiles.length - listed, 'test file'));
  const renumbered = moved.renumbered?.length ?? 0;
  if (renumbered > 0) {
    lines.push(`${renumbered} region${renumbered === 1 ? '' : 's'} renumbered by an edit beside ${
      renumbered === 1 ? 'it' : 'them'
    } kept the same cases, so ${renumbered === 1 ? 'it is' : 'they are'} not counted as moved.`);
  }
  const mismatched = moved.mismatched ?? [];
  if (mismatched.length > 0) {
    lines.push(`Not compared, ${mismatched.length} base row${mismatched.length === 1 ? '' : 's'} the diff put on a region of another path that no edit explains:`);
    for (const row of mismatched.slice(0, listed)) {
      lines.push(`  ${place(row)} ${row.path} — now on ${row.now.startLine}-${row.now.endLine} ${row.now.path}`);
    }
    lines.push(...notListed(mismatched.length - listed, 'row'));
  }
  if (moved.unread.length > 0) lines.push(`Not compared, the current record has no row for: ${listedOf(moved.unread, listed, 'file')}.`);
  if (motion.unmeasured !== undefined && motion.unmeasured.length > 0) {
    lines.push(`Not compared, the cases before were recorded over another text than ${base.at!.slice(0, 12)} holds: ${
      listedOf(motion.unmeasured, listed, 'file')
    }.`);
  }
  lines.push(...unwritten);
  return lines;
}

/**
 * The line that counts what a bounded list left out, and says where it is
 * listed. Plain text, because the markdown sets these lines in a code block.
 */
function notListed(more: number, noun: string): readonly string[] {
  if (more <= 0) return [];
  return [`... and ${more} more ${noun}${more === 1 ? '' : 's'}, not listed here; --format json lists every one.`];
}

/** Names in one line, no more than `listed` of them, and the rest counted. */
function listedOf(names: readonly string[], listed: number, noun: string): string {
  const more = names.length - listed;
  if (more <= 0) return names.join(', ');
  return `${names.slice(0, listed).join(', ')}, and ${more} more ${noun}${more === 1 ? '' : 's'}, which --format json lists`;
}

/** How many functions a list of regions sits in: a function counts once however many of its branches are listed. */
const NAMED_FUNCTIONS = 4;

/**
 * The regions a test file's reach gained or lost, said as the functions they
 * sit in, file by file: `native` and its branches are one function, and the
 * region count follows in brackets. A module's own top level is named so.
 */
export function functionsIn(regions: readonly MovedRegion[]): string {
  if (regions.length === 0) return 'nothing';
  const byFile = new Map<string, Set<string>>();
  for (const region of regions) {
    const name = region.kind === 'module' || region.name === '' ? 'the top level' : region.name.split('/')[0]!;
    const held = byFile.get(region.file);
    if (held === undefined) byFile.set(region.file, new Set([name]));
    else held.add(name);
  }
  const functions = [...byFile.values()].reduce((sum, names) => sum + names.size, 0);
  const count = `${regions.length} region${regions.length === 1 ? '' : 's'}`;
  if (functions > NAMED_FUNCTIONS) return `${functions} functions in ${byFile.size} files (${count})`;
  const said = [...byFile].map(([file, names]) => `${[...names].join(', ')} in ${file}`).join('; ');
  return `${said} (${count})`;
}

/** Cases by id when there are two or fewer, and otherwise counted by the test file they are in. */
function casesByFile(tests: readonly ExecutionTest[]): string {
  if (tests.length <= 2) return tests.map((test) => test.id).join(', ');
  const files = new Map<string, number>();
  for (const test of tests) files.set(test.file, (files.get(test.file) ?? 0) + 1);
  return `${tests.length} cases in ${files.size} test file${files.size === 1 ? '' : 's'}: ${
    [...files].map(([file, cases]) => `${file} (${cases})`).join(', ')
  }`;
}

function place(region: MovedRegion): string {
  return `${region.file} ${region.startLine}-${region.endLine} ${region.kind} ${region.name}`;
}

/** The motion of one module, and each test file's reach into it. */
function within(moved: CaseMotion, file: string): CaseMotion {
  const regions = moved.regions.filter((region) => region.file === file);
  const counts = { lost: 0, hidden: 0, thinned: 0, gained: 0 };
  for (const region of regions) counts[region.motion] += 1;
  const testFiles = moved.testFiles
    .map((test) => ({
      file: test.file,
      entered: test.entered.filter((region) => region.file === file),
      left: test.left.filter((region) => region.file === file),
    }))
    .filter((test) => test.entered.length + test.left.length > 0);
  return {
    regions,
    counts,
    testFiles,
    unread: moved.unread.filter((unread) => unread === file),
    ...(moved.renumbered === undefined ? {} : { renumbered: moved.renumbered.filter((region) => region.file === file) }),
    ...(moved.mismatched === undefined ? {} : { mismatched: moved.mismatched.filter((row) => row.file === file) }),
  };
}

/** The file graph when a case stopped, which is when a hidden region can name the case. */
async function graphFor(now: ExecutionIndex, root: string) {
  if (!anyStopped(now)) return {};
  return {
    relations: await relationsFor(root, ['.'], [], []),
  };
}

/** The commit a base was recorded at: its last run's, or its snapshot's. */
export async function baseCommit(against: string): Promise<string | undefined> {
  // No last run in it: the record may still say.
  const last = lastRun(against);
  if (last !== undefined && last !== 'unreadable' && last.commit !== undefined) return last.commit;
  return recordedCommit(against);
}

/**
 * The run that wrote a record's case index last: `undefined` when no run
 * named itself there, and `unreadable` when the record or its name does not
 * read.
 */
function lastRun(record: string): LastCaseRun | 'unreadable' | undefined {
  let last: Uint8Array | undefined;
  try {
    last = caseSectionsAt(record).last;
  } catch {
    return 'unreadable';
  }
  if (last === undefined) return undefined;
  try {
    const run = JSON.parse(Buffer.from(last).toString('utf8')) as Partial<LastCaseRun> | null;
    return typeof run === 'object' && run !== null && Array.isArray(run.files) ? run as LastCaseRun : 'unreadable';
  } catch {
    return 'unreadable';
  }
}
