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
 * is the checkout's with the change's edges undone (`baseEdgesOf`); a record at
 * another mainline commit stands in for it only when the commits between move
 * nothing the walk reads.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  baseEdgesOf,
  driftChange,
  driftFromWalk,
  readCommitRuns,
  readTestCoverage,
  whatLanded,
  type ChangedText,
  type CommitRuns,
  type DeclaredSuite,
  type DriftChange,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import type { DiffPoint } from './installed.js';
import { mainlineMissed, type MainlineBase } from './mainline-base.js';

/** The drift a review reports: the shape change against the baseline, or why the first inclusion was not checked. */
export type ReviewDrift =
  | ({ readonly baseline: string } & DriftChange)
  | { readonly unchecked: string };

/** One side of the comparison: its record and the test files its runs observed whole at its commit. */
export interface DriftRecord {
  readonly commit: string;
  readonly coverage: TestCoverage;
  readonly observed: ReadonlySet<string>;
}

export interface DriftInput {
  readonly root: string;
  readonly relations: Relations;
  /** The source files the checkout's index holds. */
  readonly sources: ReadonlySet<string>;
  /** The suite's `before` files. */
  readonly before: readonly string[];
  /** The suite declares `relations: false`: it has no walk. */
  readonly unrelated: boolean;
  /** The mainline's record, or why there is none. */
  readonly baseline: DriftRecord | { readonly missing: string };
  /** This checkout's record, or why there is none. */
  readonly head: DriftRecord | { readonly missing: string };
  /** The pull request's merge base. */
  readonly mergeBase: string;
  /** The files that differ between the baseline's commit and the merge base; absent when they are one commit. */
  readonly between?: readonly string[];
  /** Commits between the baseline's commit and the merge base, when this clone can count them. */
  readonly distance?: number;
  /** Each file the change touched, in both texts. */
  readonly changes: readonly ChangedText[];
  /** Whether the checkout holds this test file. */
  readonly present: (test: string) => boolean;
}

const CONFIGURING = [
  /^package\.json$/u,
  /^(yarn\.lock|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb?)$/u,
  /^tsconfig(\..+)?\.json$/u,
  /^(jest|vitest|vite)\.config\.[cm]?[jt]s$/u,
  /^variance\.config\.json$/u,
];

/** Whether `file` configures the walk or the run, by its name, or because the suite runs it before every test. */
function configures(file: string, before: readonly string[]): boolean {
  return before.includes(file) || CONFIGURING.some((pattern) => pattern.test(basename(file)));
}

/** The pull request's drift against the baseline's, or why it was not compared. */
export function reviewDrift(input: DriftInput): ReviewDrift {
  const { relations, before, baseline, head } = input;
  if (input.unrelated) return { unchecked: 'the suite declares `relations: false`, so it has no walk to drift from' };
  if ('missing' in baseline) return { unchecked: baseline.missing };
  if ('missing' in head) return { unchecked: head.missing };
  if (baseline.coverage.instrumentation !== head.coverage.instrumentation) {
    return { unchecked: `the mainline's record was cut by probes \`${baseline.coverage.instrumentation}\` and this one by \`${head.coverage.instrumentation}\`` };
  }
  const configuring = input.changes.find(({ file }) => configures(file, before));
  if (configuring !== undefined) return { unchecked: `the change edits \`${configuring.file}\`, which configures the walk, so the merge base's walk is not this one undone` };
  const moved = input.between?.find((file) => configures(file, before) || walked(input, baseline.coverage, file));
  if (moved !== undefined) {
    const away = input.distance === undefined ? '' : `, ${Math.abs(input.distance)} commit${Math.abs(input.distance) === 1 ? '' : 's'} ${input.distance < 0 ? 'past' : 'before'} the merge base`;
    return { unchecked: `the mainline's record stands at ${baseline.commit.slice(0, 12)}${away}, and \`${moved}\` moved the walk between them, so it is not a baseline for this change` };
  }

  const base = driftFromWalk(relations, baseline.coverage.modules, before, { base: baseEdgesOf(input.root, relations, input.changes) });
  const now = driftFromWalk(relations, head.coverage.modules, before);
  const held = (coverage: TestCoverage) => new Set(coverage.tests.map((test) => test.file));
  return {
    baseline: baseline.commit,
    ...driftChange(
      { rows: base.rows, observed: baseline.observed, held: held(baseline.coverage) },
      { rows: now.rows, observed: head.observed, held: held(head.coverage) },
      { present: input.present, unread: new Map(base.unread.map(({ test, file }) => [test, file])) },
    ),
  };
}

/** Whether the walk reads `file`: a node of its graph, a source the index holds, or a module the baseline recorded. */
function walked({ relations, sources }: DriftInput, coverage: TestCoverage, file: string): boolean {
  return relations.index.has(`file:${file}`) || sources.has(file) || coverage.modules.some((module) => module.file === file);
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
  const between = 'missing' in baseline || baseline.commit === point.base ? undefined : await filesBetween(root, baseline.commit, point.base);
  return reviewDrift({
    root,
    relations: from.relations,
    sources: from.sources,
    before: declared?.before ?? [],
    unrelated: declared?.relations === false,
    baseline: between === null ? { missing: `the commits between the mainline's record and ${point.base.slice(0, 12)} could not be compared` } : baseline,
    head,
    mergeBase: point.base,
    ...(between === undefined || between === null ? {} : { between }),
    ...(mainline === undefined || 'miss' in mainline || mainline.distance === undefined ? {} : { distance: mainline.distance }),
    changes: await Promise.all(from.changed.filter((file) => from.sources.has(file) || !existsSync(resolve(root, file))).map(async (file) => textsOf(from, file))),
    present: (test) => existsSync(resolve(root, test)),
  });
}

/** The record at `file`, with the test files the runs beside it observed whole at `commit`. */
async function observedAt(commit: string, file: string, whose: string): Promise<DriftRecord | { readonly missing: string }> {
  const runs = await readCommitRuns(file).catch(() => undefined);
  if (runs?.commit !== commit) return { missing: `${whose} carries no runs at ${commit.slice(0, 12)}, so which test files it observed whole is not known` };
  const coverage = await readTestCoverage(file).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  if (typeof coverage === 'string') return { missing: `${whose} holds no file use to read: ${coverage}` };
  return { commit, coverage, observed: new Set(whatLanded(runs.landings).files) };
}

/** The root-relative files that differ between two commits, or `null` when git could not say. */
async function filesBetween(root: string, from: string, to: string): Promise<readonly string[] | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['diff', '--name-only', '--relative', from, to], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\n').filter((line) => line !== '');
  } catch {
    return null;
  }
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
  return {
    sentence: `Drift from the walk against the mainline's record at ${code(drift.baseline.slice(0, 12))}: ${count(drift.compared, 'test file')} compared, ${shape}. A row is an observed load, not a defect.`,
    changed,
    lists,
  };
}
