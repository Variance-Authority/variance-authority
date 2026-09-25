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

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import {
  anyStopped,
  caseLayerFiles,
  caseMotion,
  recordedCommit,
  type CaseMotion,
  type ExecutionIndex,
  type LastCaseRun,
  type MovedRegion,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedCovering } from '../covering-args.js';
import { keepCases, type CoveringScope } from './covering-scope.js';
import { readExecutionIndex } from './execution-input.js';
import { relationsFor } from './source-graph.js';

/** Which record the answer was compared with, and what of it was left out. */
export interface MotionBase {
  /** The base's case index. */
  readonly from: string;
  /** `before` for the layer the last run retired, `record` for one named by `--against`. */
  readonly kind: 'before' | 'record';
  /** The commit the base was recorded at, when it said. */
  readonly at?: string;
  /** Where the diff's ref and `HEAD` part, when the base was compared under `--since`. */
  readonly mergeBase?: string;
  /**
   * Files the base's branch changed between the base's commit and the merge
   * base. Their motion is that branch's, so they are not compared. Absent when
   * it could not be told, which is not the same as none.
   */
  readonly leftOut?: readonly string[];
}

export interface CoveringMotion {
  readonly base: MotionBase;
  /** Absent when the base holds none of the cases asked about, so there was nothing to compare. */
  readonly moved?: CaseMotion;
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

/** The last run's cases against the layer it retired, narrowed to one module when one was asked. */
export async function motionOfLast(
  full: ExecutionIndex,
  from: string,
  cases: readonly string[],
  root: string,
  file?: string,
): Promise<CoveringMotion> {
  const before = caseLayerFiles(from).before;
  const base = { from: before, kind: 'before' as const };
  let held: ExecutionIndex;
  try {
    held = await readExecutionIndex(before);
  } catch {
    return { base };
  }
  const now = keepCases(full, new Set(cases));
  const moved = caseMotion(held, now, await graphFor(now, root));
  return { base, moved: file === undefined ? moved : within(moved, file) };
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
        'In a pipeline the base is the recording the base branch made: restore it from the cache into a ' +
        'directory of its own before this run writes, and name its case index here.',
    );
  }
  const now = await readExecutionIndex(from);
  const at = await baseCommit(against);
  const parting = at === undefined ? undefined : await movedOnBase(at, since, root);
  const base: MotionBase = {
    from: against,
    kind: 'record',
    ...(at === undefined ? {} : { at }),
    ...(parting === undefined ? {} : { mergeBase: parting.mergeBase, leftOut: parting.files }),
  };
  const exclude = new Set(parting?.files ?? []);
  return { base, moved: caseMotion(held, now, { ...(await graphFor(now, root)), exclude }) };
}

/** The motion, in words, after the answer it was compared for. */
export function motionText(motion: CoveringMotion | undefined): readonly string[] {
  if (motion === undefined) return [];
  const { base, moved } = motion;
  const against = base.kind === 'before'
    ? 'the run before it'
    : `${base.from}${base.at === undefined ? '' : ` at ${base.at.slice(0, 12)}`}`;
  if (moved === undefined) return ['', `Nothing to compare: ${base.from} holds none of these cases.`];
  const lines = [''];
  if (base.kind === 'record' && base.at === undefined) {
    lines.push('The base names no commit, so what its branch moved since cannot be told apart from this change.');
  } else if (base.kind === 'record' && base.leftOut === undefined) {
    lines.push(`Could not tell what the base's branch changed after ${base.at!.slice(0, 12)}, so nothing was left out.`);
  } else if (base.leftOut !== undefined && base.leftOut.length > 0) {
    lines.push(
      `Left out, changed on the base's branch between ${base.at!.slice(0, 12)} and the merge base ${
        base.mergeBase!.slice(0, 12)
      }: ${base.leftOut.join(', ')}.`,
    );
  }
  const { counts } = moved;
  if (moved.regions.length === 0) lines.push(`Against ${against}, no region moved.`);
  else {
    lines.push(
      `Against ${against}: ${counts.lost} lost, ${counts.hidden} hidden, ${counts.thinned} thinned, ${counts.gained} gained.`,
    );
    for (const region of moved.regions) {
      const why = region.motion === 'gained'
        ? `now ${region.now.join(', ')}`
        : region.motion === 'thinned'
          ? `was ${region.before.length} cases, now only ${region.now[0]}`
          : region.motion === 'lost'
            ? `was ${region.before.join(', ')}`
            : region.stopped === undefined
              ? `was ${region.before.join(', ')}; a case that could have reached it stopped, and the record cannot say which`
              : `was ${region.before.join(', ')}; stopped: ${region.stopped.map((test) => test.id).join(', ')}`;
      lines.push(`  ${region.motion.padEnd(8)} ${place(region)} — ${why}`);
    }
  }
  for (const test of moved.testFiles) {
    lines.push(`${test.file} now enters ${test.entered.length} region${
      test.entered.length === 1 ? '' : 's'
    } it did not, and no longer enters ${test.left.length}.`);
  }
  if (moved.unread.length > 0) lines.push(`Not compared, the current record has no row for: ${moved.unread.join(', ')}.`);
  return lines;
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
  return { regions, counts, testFiles, unread: moved.unread.filter((unread) => unread === file) };
}

/** The file graph when a case stopped, which is when a hidden region can name the case. */
async function graphFor(now: ExecutionIndex, root: string) {
  if (!anyStopped(now)) return {};
  return {
    relations: await relationsFor(root, ['.'], [], [], {
      why: 'a region no case walks any more is told lost or hidden by the file graph when a case stopped',
      fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
    }),
  };
}

/** The commit a base was recorded at: its last run's, or its snapshot's. */
async function baseCommit(against: string): Promise<string | undefined> {
  try {
    const last = JSON.parse(await readFile(caseLayerFiles(against).last, 'utf8')) as LastCaseRun;
    if (last.commit !== undefined) return last.commit;
  } catch {
    // No last run beside it: the snapshot it sits beside may still say.
  }
  return against.endsWith('.cases.bin') ? recordedCommit(against.slice(0, -'.cases.bin'.length)) : undefined;
}

/**
 * Where `since` and `HEAD` part, and the files the base's branch changed
 * between the base's commit and there, named the way the run names files.
 * Absent when git could not say.
 */
async function movedOnBase(
  at: string,
  since: string,
  root: string,
): Promise<{ readonly mergeBase: string; readonly files: readonly string[] } | undefined> {
  const run = promisify(execFile);
  try {
    const top = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: root })).stdout.trim();
    const mergeBase = (await run('git', ['merge-base', since, 'HEAD'], { cwd: top })).stdout.trim();
    const base = (await run('git', ['rev-parse', `${at}^{commit}`], { cwd: top })).stdout.trim();
    if (base === mergeBase) return { mergeBase, files: [] };
    const { stdout } = await run('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', base, mergeBase], {
      cwd: top,
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = stdout.split('\0').filter((file) => file !== '').map((file) => relative(root, join(top, file)));
    return { mergeBase, files: files.sort() };
  } catch {
    return undefined;
  }
}
