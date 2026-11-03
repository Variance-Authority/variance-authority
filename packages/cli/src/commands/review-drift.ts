// compass: variance-authority/runtime/attention
/**
 * Where this change's run drifted from the walk against where the mainline's
 * did (spec 0105).
 *
 * Drift is the loads of a test file its imports and the suite's `before` files
 * do not reach. It is an observed difference, not a defect: a mapper, a setup
 * file, a lazy `import()` or an environment variable each make one, so the
 * review names each row that grew or shrank and never fails on one. The
 * baseline is the mainline's record read against the merge base's walk, which
 * is the checkout's with the change's edges undone (`baseEdgesOf`) and walked
 * from the `before` the merge base's config declares; a record at another
 * mainline commit stands in for it only when the commits between move nothing
 * the walk reads, nothing the suite rests on and no package.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  CACHE_CONFIG,
  baseEdgesOf,
  beforeIn,
  beforeOf,
  driftChange,
  driftFromWalk,
  readCommitRuns,
  readTestCoverage,
  rootConfig,
  rootConfigOf,
  whatLanded,
  undone,
  type BaseEdges,
  type ChangedText,
  type CommitRuns,
  type DeclaredSuite,
  type DriftChange,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { idOf, type Relations } from '@variance-authority/core/relate';
import { filesBetween } from './base-diff.js';
import { installDiffBetween, type DiffPoint, type InstallDiff } from './installed.js';
import { mainlineMissed, type MainlineBase } from './mainline-base.js';
import { restsUnder } from './select-before.js';
import { commitPoint } from './since.js';

/** The drift a review reports: the shape change against the baseline, or why the first inclusion was not checked. */
export type ReviewDrift =
  | ({ readonly baseline: string; readonly cause?: string } & DriftChange)
  | { readonly unchecked: string };

/** One side of the comparison: its record and the test files its runs observed whole at its commit. */
export interface DriftRecord {
  readonly commit: string;
  readonly coverage: TestCoverage;
  readonly observed: ReadonlySet<string>;
}

export interface DriftInput {
  readonly relations: Relations;
  /** The source files the checkout's index holds. */
  readonly sources: ReadonlySet<string>;
  /** The `before` files the suite rests on, its own and the repository's, as the checkout declares them. */
  readonly before: readonly string[];
  /** The same, as the merge base's config declared them, which the baseline is walked from; or why it is not known. */
  readonly baseBefore: readonly string[] | { readonly missing: string };
  /** The suite declares `relations: false`: it has no walk. */
  readonly unrelated: boolean;
  /** The mainline's record, or why there is none. */
  readonly baseline: DriftRecord | { readonly missing: string };
  /** This checkout's record, or why there is none. */
  readonly head: DriftRecord | { readonly missing: string };
  /** The files that differ between the baseline's commit and the merge base; absent when they are one commit. */
  readonly between?: readonly string[];
  /** What the change moved that the walk or the run rests on, its `before`, a file under it or an install: compared all the same, and named as the cause of its rows. */
  readonly moved?: string;
  /** The same, for the commits between the baseline's commit and the merge base. */
  readonly movedBetween?: string;
  /** Commits between the baseline's commit and the merge base, when this clone can count them. */
  readonly distance?: number;
  /** The edges the change moved, undone to walk the merge base (`baseEdgesOf`). */
  readonly base: BaseEdges;
  /** Whether the checkout holds this test file. */
  readonly present: (test: string) => boolean;
}

/** The pull request's drift against the baseline's, or why it was not compared. */
export function reviewDrift(input: DriftInput): ReviewDrift {
  const { relations, before, baseline, head } = input;
  if (input.unrelated) return { unchecked: 'the suite declares `relations: false`, so it has no walk to drift from' };
  if ('missing' in baseline) return { unchecked: baseline.missing };
  if ('missing' in head) return { unchecked: head.missing };
  if ('missing' in input.baseBefore) return { unchecked: input.baseBefore.missing };
  if (baseline.coverage.instrumentation !== head.coverage.instrumentation) {
    return { unchecked: `the mainline's record was cut by probes \`${baseline.coverage.instrumentation}\` and this one by \`${head.coverage.instrumentation}\`` };
  }
  const recorded = new Set(baseline.coverage.modules.map((module) => module.file));
  const walked = (file: string) => idOf(relations, 'file', file) !== undefined || input.sources.has(file) || recorded.has(file);
  const moved = input.movedBetween ?? input.between?.find(walked);
  if (moved !== undefined) {
    const away = input.distance === undefined ? '' : `, ${Math.abs(input.distance)} commit${Math.abs(input.distance) === 1 ? '' : 's'} ${input.distance < 0 ? 'past' : 'before'} the merge base`;
    const what = input.movedBetween ?? `moved \`${moved}\`, which the walk reads`;
    return { unchecked: `the mainline's record stands at ${baseline.commit.slice(0, 12)}${away}, and the commits between them ${what}, so it is not a baseline for this change` };
  }

  const base = driftFromWalk(relations, baseline.coverage.modules, input.baseBefore, { base: input.base });
  const now = driftFromWalk(relations, head.coverage.modules, before);
  const held = (coverage: TestCoverage) => new Set(coverage.tests.map((test) => test.file));
  return {
    baseline: baseline.commit,
    ...(input.moved === undefined ? {} : { cause: `the change ${input.moved}` }),
    ...driftChange(
      { rows: base.rows, observed: baseline.observed, held: held(baseline.coverage) },
      { rows: now.rows, observed: head.observed, held: held(head.coverage) },
      { present: input.present, unread: new Map(base.unread.map(({ test, file }) => [test, file])) },
    ),
  };
}

/**
 * What moved between two commits that the walk or the run rests on, said as
 * what it did, or `undefined` when nothing did: the `before` each declares,
 * one of `files` under either, or the install `install` reads.
 */
async function movedUnder(relations: Relations, lists: readonly (readonly string[])[], files: readonly string[], install: () => Promise<InstallDiff | undefined>): Promise<string | undefined> {
  if (lists.some((list) => list.join('\0') !== lists[0]!.join('\0'))) return 'declared `before` differently';
  if (files.length === 0) return undefined;
  const rests = [...new Set(lists.flatMap((list) => restsUnder(relations, list, files)))].sort();
  if (rests[0] !== undefined) return `moved \`${rests[0]}\`, which the suite rests on before reach`;
  return installed(await install());
}

/** The `before` the root config at `point` declares for `suite`, or why it is not known. */
async function beforeAt(root: string, point: DiffPoint | undefined, suite: string | undefined, whose: string): Promise<readonly string[] | { readonly missing: string }> {
  if (point === undefined) return { missing: `${whose} could not be resolved here, so the \`before\` it declared is not known` };
  const file = rootConfig(root)?.file ?? resolve(point.repository, CACHE_CONFIG);
  try {
    const text = await point.at(relative(point.repository, file));
    if (text === undefined) return [];
    return beforeIn(rootConfigOf(file, text), suite);
  } catch (error) {
    return { missing: `${whose}'s ${CACHE_CONFIG} could not be read, so the \`before\` it declared is not known: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** An install that moved, said as what it did. */
function installed(diff: InstallDiff | undefined): string | undefined {
  if (diff === undefined) return undefined;
  if ('whole' in diff) return `may have installed any package differently: ${diff.whole}`;
  return diff.packages[0] === undefined ? undefined : `installed \`${diff.packages[0]}\` differently`;
}

/** What `review` already holds that the drift is read from. */
export interface DriftSources {
  readonly root: string;
  readonly declared: DeclaredSuite | undefined;
  /** This checkout's record and the runs that wrote it. */
  readonly record: string;
  readonly runs: CommitRuns | undefined;
  /** The mainline's record as `mainlineBase` fetched it, or its miss; absent when the suite is not shared. */
  readonly mainline: MainlineBase | undefined;
  readonly point: DiffPoint;
  /** A root-relative name as the repository names it. */
  readonly named: (file: string) => string;
  /** The root-relative files the change touched. */
  readonly changed: readonly string[];
  readonly relations: Relations;
  readonly sources: ReadonlySet<string>;
  /** What the change installed differently, as `review` read it. */
  readonly installed: InstallDiff | undefined;
}

/** {@link reviewDrift} over the records and texts `review` holds. */
export async function readReviewDrift(from: DriftSources): Promise<ReviewDrift> {
  const { root, declared, mainline, point } = from;
  const baseline = mainline === undefined
    ? { missing: 'the suite does not share its record, so there is no mainline record to read a baseline from' }
    : 'miss' in mainline
      ? { missing: `the mainline gave no ${mainlineMissed(mainline)}` }
      : await observedAt(mainline.commit, mainline.coverage, "the mainline's record");
  const head = from.runs?.commit === undefined
    ? { missing: 'no run here listed itself, so which test files this change observed whole is not known' }
    : await observedAt(from.runs.commit, from.record, 'this record');
  const between = 'missing' in baseline || baseline.commit === point.base ? undefined : await filesBetween(baseline.commit, point.base, root).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  const suite = declared?.name;
  const changes = await Promise.all(from.changed.filter((file) => from.sources.has(file) || !existsSync(resolve(root, file))).map(async (file) => textsOf(from, file)));
  const base = baseEdgesOf(root, from.relations, changes);
  const before = beforeOf(root, suite);
  const baseBefore = await beforeAt(root, point, suite, 'the merge base');
  const moved = await movedUnder(from.relations, 'missing' in baseBefore ? [before] : [before, baseBefore], from.changed, async () => from.installed);
  // Measured from the baseline's commit to the merge base on their own, whatever the change itself moved.
  const movedBetween = between === undefined || typeof between === 'string' || 'missing' in baseline || 'missing' in baseBefore
    ? undefined
    : await movedBetweenOf(root, suite, from.relations, base, baseline.commit, point.base, baseBefore, between);
  return reviewDrift({
    relations: from.relations,
    sources: from.sources,
    before,
    baseBefore,
    unrelated: declared?.relations === false,
    baseline: typeof between === 'string' ? { missing: `the commits between the mainline's record and ${point.base.slice(0, 12)} could not be compared: ${between.trim()}` } : baseline,
    head,
    ...(between === undefined || typeof between === 'string' ? {} : { between }),
    ...(moved === undefined ? {} : { moved }),
    ...(movedBetween === undefined ? {} : { movedBetween }),
    ...(mainline === undefined || 'miss' in mainline || mainline.distance === undefined ? {} : { distance: mainline.distance }),
    base,
    present: (test) => existsSync(resolve(root, test)),
  });
}

/**
 * What the commits from the baseline's `commit` to the merge base `base` moved
 * that the walk or the run rests on, read over the merge base's graph: the
 * checkout's with the change's `edges` undone.
 */
export async function movedBetweenOf(root: string, suite: string | undefined, relations: Relations, edges: BaseEdges, commit: string, base: string, baseBefore: readonly string[], between: readonly string[]): Promise<string | undefined> {
  const then = await beforeAt(root, await commitPoint(commit, [], root), suite, "the mainline record's commit");
  if ('missing' in then) return `may have declared \`before\` differently: ${then.missing}`;
  return await movedUnder({ ...relations, depends: undone(relations, edges) }, [then, baseBefore], between, async () => installDiffBetween(commit, base, between, root));
}

/** The record at `file`, with the test files the runs beside it observed whole at `commit`. */
async function observedAt(commit: string, file: string, whose: string): Promise<DriftRecord | { readonly missing: string }> {
  const runs = await readCommitRuns(file).catch(() => undefined);
  if (runs?.commit !== commit) return { missing: `${whose} carries no runs at ${commit.slice(0, 12)}, so which test files it observed whole is not known` };
  const coverage = await readTestCoverage(file).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  if (typeof coverage === 'string') return { missing: `${whose} holds no file use to read: ${coverage}` };
  return { commit, coverage, observed: new Set(whatLanded(runs.landings).files) };
}

async function textsOf({ root, point, named }: DriftSources, file: string): Promise<ChangedText> {
  const before = await point.at(named(file));
  const after = existsSync(resolve(root, file)) ? await readFile(resolve(root, file), 'utf8') : undefined;
  return { file, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) };
}

/** The drift in words: a sentence, then each list it names, its rows in test-file order. */
export interface DriftWords {
  readonly sentence: string;
  /** Whether a row grew or shrank, which the comment says on its first screen. */
  readonly changed: boolean;
  readonly lists: readonly { readonly label: string; readonly items: readonly string[] }[];
}

/** {@link ReviewDrift} as the review's text and comment say it, each name through `code`. */
export function driftWords(drift: ReviewDrift, code: (value: string) => string): DriftWords {
  if ('unchecked' in drift) return { sentence: `Drift from the walk was not checked: ${drift.unchecked}.`, changed: false, lists: [] };
  const loads = (rows: readonly { readonly test: string; readonly file: string }[]) => rows.map(({ test, file }) => `${code(test)} loaded ${code(file)}`);
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const changed = drift.grown.length + drift.shrunk.length > 0;
  const lists = [
    { label: 'Grown: loads the walk does not reach, which the baseline lacks', items: loads(drift.grown) },
    { label: 'Shrunk: baseline loads the walk does not reach, which this run lacks', items: loads(drift.shrunk) },
    { label: 'First: the drift of test files the baseline does not hold', items: loads(drift.first) },
    { label: 'Removed: baseline test files the checkout no longer holds', items: drift.removed.map(code) },
    ...drift.notCompared.map(({ reason, tests }) => ({ label: `Not compared, ${reason}`, items: tests.map(code) })),
  ].filter(({ items }) => items.length > 0);
  const shape = changed ? `${count(drift.grown.length, 'row')} grew and ${drift.shrunk.length} shrank` : 'no shape change';
  const cause = drift.cause === undefined ? '' : ` ${drift.cause[0]!.toUpperCase()}${drift.cause.slice(1)}, so the walk itself moved.`;
  return {
    sentence: `Drift from the walk against the mainline's record at ${code(drift.baseline.slice(0, 12))}: ${count(drift.compared, 'test file')} compared, ${shape}.${cause} A row is an observed load, not a defect.`,
    changed,
    lists,
  };
}
