/**
 * Each case's duration, as the runner that ran it reported it.
 *
 * Nothing here reads a clock. A runner times every case it runs and hands the
 * time over when the run ends; a second clock around the same body would
 * measure the seam as well as the case, and disagree with the runner's own
 * report by exactly that much. So the case index carries the runner's number,
 * joined to the case the scope recorded, and a case the runner did not time is
 * left untimed.
 *
 * The join is by the runner's id where the case scope carries it — Vitest hands
 * both sides the same `test.id` — and by the declaration path under the file
 * otherwise, which is the spelling the case scope records: Jest's
 * `currentTestName`, Rstest's names joined with ` > `, and the names a caller
 * of `observeTestFile` passed. A name one file declares twice cannot say which
 * of the two it is, so neither is timed: fall back, never fake.
 */

import { observedAttempt, type Failure, type ObservedAttempt } from './attempts-record.js';
import { limitAcross } from './execution-set-columns.js';
import type { ReportedModule, RunnerTask } from './finished-files.js';
import { projectPath } from './instrumented-modules.js';

/** One case a runner reported at the end of a run. */
export interface FinishedCase {
  /** The declaration path under the file, as the case scope spells it for this runner. */
  readonly name: string;
  /** The runner's own id for the case, where the case scope records the same one. */
  readonly id?: string;
  /** Milliseconds the runner reported for the case; absent when it reported none. */
  readonly duration?: number;
  /** Milliseconds the runner held the case to, for a runner that says so only outside the case. */
  readonly limit?: number;
  /** How each attempt of the case ended, as the runner's seam reads its report; absent when it counts none. */
  readonly attempts?: readonly ObservedAttempt[];
}

/** The runner's duration for one recorded case, or `undefined` when no runner timed it. */
export type CaseDurations = (file: string, name: string, id: string) => number | undefined;

/** A lookup that times no case, for a run whose runner reported none. */
export const UNTIMED: CaseDurations = () => undefined;

/** The limit a runner reported for one recorded case, or `undefined` when it reported none. */
export type CaseLimits = (file: string, name: string) => number | undefined;

/** A lookup that limits no case, for a run whose cases carry their own limit. */
export const UNLIMITED: CaseLimits = () => undefined;

/**
 * The limits every announcement of a finished file reported, by the declaration
 * path. Two projects' copies of a case keep the longer limit, as the record's
 * join does, and a name one file declares twice says neither.
 */
export function caseLimits(files: readonly FinishedFile[], root: string): CaseLimits {
  const limits = new Map<string, number>();
  for (const file of files) {
    const once = declaredOnce(file.cases);
    for (const held of file.cases ?? []) {
      const key = `${projectPath(root, file.filepath)}\0${held.name}`;
      if (held.limit !== undefined && once(held.name)) limits.set(key, limitAcross(held.limit, limits.get(key)).limit!);
    }
  }
  return (file, name) => limits.get(`${file}\0${name}`);
}

/** Whether one announcement declares a name once, so the name alone says which case is meant. */
function declaredOnce(cases: readonly FinishedCase[] = []): (name: string) => boolean {
  const declared = new Map<string, number>();
  for (const held of cases) declared.set(held.name, (declared.get(held.name) ?? 0) + 1);
  return (name) => declared.get(name) === 1;
}

/**
 * The durations every announcement of a finished file reported, keyed the way
 * a recorded case is.
 *
 * A file two projects both ran is announced twice, and a case in it cost what
 * each project spent on it: the durations are summed, and a project that did
 * not time the case — or announced the file with no cases at all — leaves the
 * sum unknown rather than short.
 */
export function caseDurations(files: readonly FinishedFile[], root: string): CaseDurations {
  const untimed = new Set(files.filter((file) => file.cases === undefined).map((file) => projectPath(root, file.filepath)));
  // `null` is a case somebody ran and nobody timed, which no later sum repairs.
  const spent = reportedByCase(files, root, (held) => timed(held.duration), (seen, next) => (seen === null || next === null ? null : seen + next));
  return (file, name, id) => (untimed.has(file) ? undefined : spent(file, name, id));
}

/** One announcement of a finished file: its path and the cases it reported, if it reported any. */
export interface FinishedFile {
  readonly filepath: string;
  readonly cases?: readonly FinishedCase[];
}

/**
 * What every announced case `said`, found the way a recorded case is named:
 * by the runner's id, else by a name its file declares once. `null` is a case
 * nobody can answer for, as a name declared twice is; `undefined` from `said`
 * leaves the case out; `both` folds two announcements of one case.
 */
export function reportedByCase<T>(
  files: readonly FinishedFile[],
  root: string,
  said: (held: FinishedCase) => T | null | undefined,
  both: (seen: T | null, next: T | null) => T | null,
): (file: string, name: string, id: string) => T | undefined {
  const byId = new Map<string, T | null>();
  const byName = new Map<string, T | null>();
  const add = (map: Map<string, T | null>, key: string, value: T | null): void =>
    void map.set(key, map.has(key) ? both(map.get(key)!, value) : value);
  for (const file of files) {
    const path = projectPath(root, file.filepath);
    const once = declaredOnce(file.cases);
    for (const held of file.cases ?? []) {
      const value = said(held);
      if (value === undefined) continue;
      if (held.id !== undefined) add(byId, `${path}\0${held.id}`, value);
      add(byName, `${path}\0${held.name}`, once(held.name) ? value : null);
    }
  }
  return (file, name, id) => {
    const key = `${file}\0${id}`;
    return (byId.has(key) ? byId.get(key) : byName.get(`${file}\0${name}`)) ?? undefined;
  };
}

function timed(duration: number | undefined): number | null {
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/**
 * The cases under a file of Vitest's task tree: every leaf below it, named by
 * the suites between, as the case runner's `getNames(test).slice(1)` names it.
 */
export function taskCases(file: RunnerTask): Pick<{ cases?: readonly FinishedCase[] }, 'cases'> {
  return { cases: namedTasks(file).map(({ task, name }) => finishedCase(name, task.id, task.result?.duration)) };
}

/** Every leaf under a Vitest 2 file task, with the name the record knows it by. */
export function namedTasks(file: RunnerTask): { readonly task: RunnerTask; readonly name: string }[] {
  const named: { task: RunnerTask; name: string }[] = [];
  const walk = (task: RunnerTask, names: readonly string[]): void => {
    for (const child of task.tasks ?? []) {
      const path = [...names, child.name ?? ''];
      if (child.tasks !== undefined) walk(child, path);
      else named.push({ task: child, name: path.join(' > ') });
    }
  };
  walk(file, []);
  return named;
}

/** Vitest's own attempt, structurally: `TestCase.attempts()`, which Vitest before 4.1 does not have. */
export interface VitestAttempt {
  readonly state: string;
  readonly errors?: readonly Failure[] | undefined;
  readonly duration?: number;
}

/**
 * Vitest reports every attempt whole: its state, its errors and its own
 * duration, a repeat counted as an attempt like a retry. An attempt its limit
 * stopped is `failed`, told apart only by its message. Absent from a Vitest
 * whose test case has no `attempts()`.
 */
export function vitestAttempts(reported: Iterable<VitestAttempt> | undefined): readonly ObservedAttempt[] | undefined {
  return reported === undefined
    ? undefined
    : [...reported].map((one, at) => observedAttempt(at + 1, one.state, one.errors?.[0], one.duration));
}

/** The cases of a module Vitest 3 or 4 reported, by the id its task carried. */
export function reportedCases(module: ReportedModule): Pick<{ cases?: readonly FinishedCase[] }, 'cases'> {
  return {
    cases: [...module.children.allTests()].map((test) =>
      finishedCase(test.fullName ?? '', test.id, test.diagnostic?.()?.duration, undefined, vitestAttempts(test.attempts?.()))),
  };
}

export function finishedCase(
  name: string,
  id: string | undefined,
  duration: unknown,
  limit?: number,
  attempts?: readonly ObservedAttempt[],
): FinishedCase {
  return {
    name,
    ...(id === undefined ? {} : { id }),
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(attempts === undefined ? {} : { attempts }),
  };
}
