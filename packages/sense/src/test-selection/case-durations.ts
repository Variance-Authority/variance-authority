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
  /** The name of the project that ran it, as the configuration wrote it; absent when the runner named none. */
  readonly project?: string;
}

/** The runner's duration for one recorded case, or `undefined` when no runner timed it. */
export type CaseDurations = (file: string, name: string, id: string) => number | undefined;

/** A lookup that times no case, for a run whose runner reported none. */
export const UNTIMED: CaseDurations = () => undefined;

/**
 * The durations every announcement of a finished file reported, keyed the way
 * a recorded case is.
 *
 * A file two projects both ran is announced twice, and a case in it cost what
 * each project spent on it: the durations are summed, and a project that did
 * not time the case — or announced the file with no cases at all — leaves the
 * sum unknown rather than short.
 */
export function caseDurations(
  files: readonly { readonly filepath: string; readonly cases?: readonly FinishedCase[] }[],
  root: string,
): CaseDurations {
  // `null` is a case somebody ran and nobody timed, which no later sum repairs.
  const byId = new Map<string, number | null>();
  const byName = new Map<string, number | null>();
  const untimed = new Set<string>();
  const add = (map: Map<string, number | null>, key: string, duration: number | null): void => {
    const seen = map.get(key);
    map.set(key, seen === undefined ? duration : seen === null || duration === null ? null : seen + duration);
  };
  for (const file of files) {
    const path = projectPath(root, file.filepath);
    if (file.cases === undefined) {
      untimed.add(path);
      continue;
    }
    const declared = new Map<string, number>();
    for (const held of file.cases) declared.set(held.name, (declared.get(held.name) ?? 0) + 1);
    for (const held of file.cases) {
      const duration = timed(held.duration);
      if (held.id !== undefined) add(byId, `${path}\0${held.id}`, duration);
      add(byName, `${path}\0${held.name}`, declared.get(held.name) === 1 ? duration : null);
    }
  }
  return (file, name, id) => {
    if (untimed.has(file)) return undefined;
    const key = `${file}\0${id}`;
    const found = byId.has(key) ? byId.get(key) : byName.get(`${file}\0${name}`);
    return found ?? undefined;
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
  const cases: FinishedCase[] = [];
  const project = named(file.projectName);
  const walk = (task: RunnerTask, names: readonly string[]): void => {
    for (const child of task.tasks ?? []) {
      const path = [...names, child.name ?? ''];
      if (child.tasks !== undefined) walk(child, path);
      else cases.push(finishedCase(path.join(' > '), child.id, child.result?.duration, project));
    }
  };
  walk(file, []);
  return { cases };
}

/** The cases of a module Vitest 3 or 4 reported, by the id its task carried. */
export function reportedCases(module: ReportedModule): Pick<{ cases?: readonly FinishedCase[] }, 'cases'> {
  const project = named(module.project?.name ?? module.project?.getName?.());
  return {
    cases: [...module.children.allTests()].map((test) =>
      finishedCase(test.fullName ?? '', test.id, test.diagnostic?.()?.duration, project)),
  };
}

export function finishedCase(name: string, id: string | undefined, duration: unknown, project?: string): FinishedCase {
  return {
    name,
    ...(id === undefined ? {} : { id }),
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
    ...(project === undefined ? {} : { project }),
  };
}

/** A project's name, or nothing for the one a configuration left unnamed. */
function named(project: string | undefined): string | undefined {
  return project === undefined || project === '' ? undefined : project;
}
