/**
 * The reporter a Vitest run folds through: the end of the run, as whichever
 * major announces it, narrowed to which files finished and how.
 */

import type { Reporter } from 'vitest/reporters';
import {
  carriedJournal,
  reportedComplete,
  reportedDuration,
  runnerSkipped,
  taskComplete,
  type FinishedFile,
  type ReportedModule,
  type RunnerTask,
} from './finished-files.js';
import { reportedCases, taskCases } from './case-durations.js';
import { noteRunner, projectConfig, type RunnerContext } from './governing-config.js';
import { reopenRun, type SelectionRun } from './selection-run.js';

export function selectionReporter(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
): Reporter {
  // Vitest 2 announces the end of a run as `onFinished(files)`, where a file is
  // a runner task. Vitest 3 replaced that with `onTestRunEnd(testModules)` over
  // a reported-task API, and Vitest 4 stopped calling `onFinished` on reporters
  // altogether — silently, because a reporter with no hook a runner recognises
  // is a reporter that never objects. A suite would go green and write no
  // snapshot. Both hooks are declared, both narrow to the same two facts, and
  // whichever the runner calls first is the one that counts.
  //
  // Each file also carries the configuration it ran under, as the runner
  // resolved it: Vitest 3 and 4 hand the project over, and Vitest 2 hands its
  // name, which `onInit` has already mapped to the project.
  let byName = new Map<string, string>();
  // Held, not copied: a name filter and a cancel are both set on the runner
  // after `onInit`, and each run's end asks it afresh.
  let runner: RunnerContext | undefined;
  const configsOf = (config: string | undefined) => (config === undefined ? {} : { configs: [config] });
  // A rerun starts as `onWatcherRerun` in every major and as `onTestRunStart`
  // from Vitest 3, both after the last run's end was awaited: the fold reopens
  // there, and the rerun's end folds the files the rerun ran.
  return {
    onInit: (context: RunnerContext) => {
      runner = context;
      byName = noteRunner(run, context);
      run.watching = context.config?.watch === true;
    },
    onWatcherRerun: () => reopenRun(run),
    onTestRunStart: () => reopenRun(run),
    onFinished: (files: readonly RunnerTask[]) => settle(
      files.flatMap((file) => file.filepath === undefined
        ? []
        : [{
          filepath: file.filepath,
          complete: taskComplete(file, runnerSkipped(runner)),
          ...reportedDuration(file.result?.duration),
          ...taskCases(file),
          ...carriedJournal(file.filepath, file.meta),
          ...configsOf(byName.get(file.projectName ?? '')),
        }]),
    ),
    onTestRunEnd: (reported: readonly ReportedModule[], _errors?: unknown, reason?: string) => settle(
      reported.map((module) => ({
        filepath: module.moduleId,
        complete: reportedComplete(module, runnerSkipped(runner, reason)),
        ...reportedDuration(module.diagnostic?.()?.duration),
        ...reportedCases(module),
        ...carriedJournal(module.moduleId, module.meta?.()),
        ...configsOf(projectConfig(module.project)),
      })),
    ),
  } as Reporter;
}
