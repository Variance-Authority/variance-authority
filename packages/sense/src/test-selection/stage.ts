/**
 * Where a process that is one of several puts what it recorded, until the one
 * that saw the whole run folds it.
 *
 * Kept apart from the join it feeds: what is here is a directory, a name no
 * other process will choose, and the order the contributions are read in. What
 * the fold means — one row per owner, one case per coordinate — is
 * `observed.ts`, and a seam that stages reaches for both.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { heardAcross, heardOf } from './case-precondition-column.js';
import { packCase, settledAcross, timedAcross, unpackCase } from './cases.js';
import { codeUnitOrder, isMissing } from './instrumented-modules.js';
import { joinObservations, type ObservedCase, type ObservedSubject } from './observed.js';

/**
 * Where a process that is one of several puts what it recorded.
 *
 * Playwright runs its specs in worker processes and Jest runs its test files in
 * sandboxes, and each of them can reach the index. Letting each one merge would
 * be wrong in a way that reads as success: the merge retires the previous
 * crossings of every file whose incoming row says it finished, so two workers
 * that both ran part of one spec file each write a whole-looking row and the
 * later one drops the earlier one's regions. The file is then recorded as fully
 * observed with half its crossings, and the next `--since` skips it over a line
 * the other worker walked.
 *
 * So a process that is one of several stages instead: it writes what it saw
 * into a directory the run owns, and whoever sees the whole run folds it and
 * merges once. The variable is how a worker finds the directory without a
 * channel to the parent — a forked or spawned worker inherits the environment
 * as it stood when it started, which is after {@link openStage}.
 */
export const STAGE_VARIABLE = 'VARIANCE_AUTHORITY_EXECUTION_STAGE';

/** What one process contributed, before any of it has been merged. */
export interface StagedExecution {
  readonly subjects: readonly ObservedSubject[];
  readonly heads?: readonly string[];
  readonly cases?: readonly ObservedCase[];
}

/** The run's staging directory, or nothing where this process merges for itself. */
export function stagingDirectory(): string | undefined {
  const named = process.env[STAGE_VARIABLE];
  return named === undefined || named === '' ? undefined : named;
}

/**
 * Name the directory this run stages into, and empty it.
 *
 * Emptied rather than trusted: a run killed between its workers and its fold
 * leaves its contributions behind, and read by the next run they are evidence
 * of executions that did not happen at a commit nobody recorded.
 *
 * Synchronous because of when it is called. The whole mechanism rests on the
 * variable being set before the first worker is forked, and the hook a runner
 * gives its reporter for *before the run* is not always one that can be waited
 * on — Playwright's `onBegin` returns nothing. A few milliseconds once per run
 * buys the guarantee.
 */
export function openStage(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  process.env[STAGE_VARIABLE] = directory;
}

/**
 * Write one process's contribution under a name no other process will choose,
 * led by when it was written.
 *
 * The fold reads contributions in name order, and that order reaches what it
 * computes: a retry is folded after the attempt it retried, and the heads are
 * listed as they arrived. A name that is only unique folds one run's
 * contributions in a different order from the next's. The monotonic clock is
 * one clock for every process on the machine, and the workers that share a
 * stage share a machine, so its reading at the write orders the names as the
 * writes happened; padded to the width of its largest value, code-unit order
 * is numeric order.
 */
export async function stageExecution(
  directory: string,
  staged: StagedExecution,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const written = process.hrtime.bigint().toString().padStart(20, '0');
  const temporary = resolve(directory, `.${written}-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(staged));
  // Named last, so the fold never reads a contribution that is still arriving.
  await rename(temporary, `${temporary.slice(0, -4)}.json`);
}

/**
 * Every contribution this run staged, as one.
 *
 * Subjects are folded by {@link joinObservations} for the reason it exists: two
 * rows for one owner is a duplicate the encoder refuses, and two processes that
 * each ran part of a spec file are one observation of that file. Cases are
 * folded the same way through their coordinate, so a case retried in a fresh
 * worker is read twice and recorded once.
 */
export async function foldStage(directory: string): Promise<StagedExecution> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return { subjects: [] };
    throw error;
  }
  // In the order the contributions were written, which their names carry.
  const staged: StagedExecution[] = [];
  for (const name of names.filter((name) => name.endsWith('.json')).sort(codeUnitOrder)) {
    staged.push(JSON.parse(await readFile(resolve(directory, name), 'utf8')) as StagedExecution);
  }
  // How each case settled and what it cost ride beside the join, which knows
  // neither: a case retried in another worker settled once it finished once,
  // and cost both attempts.
  const settled = new Map<string, { stopped?: boolean; duration?: number; said?: ObservedCase['said'] }>();
  const staging = staged.flatMap((one) =>
    (one.cases ?? []).map((observed) => {
      const owner = packCase(observed.file, observed.name, observed.id);
      const held = settled.get(owner) ?? {};
      settled.set(owner, {
        ...settledAcross(held.stopped, observed.stopped),
        ...timedAcross(held.duration, observed.duration),
        ...heardOf(heardAcross(held.said, observed.said)),
      });
      return { owner, journal: observed.journal };
    }),
  );
  const cases = joinObservations([staging]).map((subject): ObservedCase => ({
    ...unpackCase(subject.owner),
    ...settled.get(subject.owner),
    journal: subject.journal,
  }));
  return {
    subjects: joinObservations(staged.map((one) => one.subjects)),
    heads: [...new Set(staged.flatMap((one) => one.heads ?? []))],
    cases,
  };
}

/** Stop staging and take the directory back down. */
export async function closeStage(directory: string): Promise<void> {
  delete process.env[STAGE_VARIABLE];
  await rm(directory, { recursive: true, force: true });
}
